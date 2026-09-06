/**
 * Protocol-fee reads and previews for the funding UI.
 *
 * Two pool generations are live at once:
 *   - V1 (frozen artifact): no ProtocolConfig, no protocol fee. The whole gross reaches the pool.
 *   - V2 (Phase 2.8 onwards): every contribution pays `floor(gross * feeBps / 10_000)` to the
 *     treasury out of the gross, and the rate is read live from the shared ProtocolConfig.
 *
 * Detection is a deterministic on-chain capability probe, not a timestamp or database flag: the
 * pool's own runtime bytecode either contains the V2-only function selectors or it does not.
 * Solidity's dispatcher embeds each selector as a PUSH4 operand, so a compiled-in function is
 * literally present in the code. This mirrors `poolSupportsPartialWithdraw`, which the app has
 * used for the same purpose since the partial-withdraw rollout.
 *
 * Why not `eth_call protocolConfig()` with a try/catch: V1's `fallback()` routes unknown selectors
 * into `fund()`, so a V1 pool answers that probe with a revert that is indistinguishable from an
 * RPC failure. Reading code once separates "this is V1" from "the network call failed", which
 * matters because a failed read must never be rendered as "no fee".
 */

import {
  Contract,
  formatUnits,
  id,
  type BrowserProvider,
  type JsonRpcProvider,
  type JsonRpcSigner,
} from "ethers";
import {
  PROTOCOL_BPS_DENOMINATOR,
  PROTOCOL_MAX_FEE_BPS,
  protocolFeeFor,
  type ProtocolFeeConfig,
} from "./community-pool-v2";

export { PROTOCOL_BPS_DENOMINATOR, PROTOCOL_MAX_FEE_BPS, protocolFeeFor };
export type { ProtocolFeeConfig };

export type PoolContractVersion = "v1" | "v2";

type AnyProvider = BrowserProvider | JsonRpcProvider | NonNullable<JsonRpcSigner["provider"]>;

/** 4-byte selectors of the two V2-only views, without the leading `0x`. */
export const V2_ONLY_SELECTORS = {
  protocolConfig: id("protocolConfig()").slice(2, 10),
  getProtocolFeeConfig: id("getProtocolFeeConfig()").slice(2, 10),
} as const;

const FEE_ABI = ["function getProtocolFeeConfig() view returns (uint256 feeBps, address recipient)"] as const;
const PROTOCOL_CONFIG_ABI = ["function protocolFeeBps() view returns (uint256)"] as const;

/**
 * The chain's current protocol fee, read straight from the shared ProtocolConfig. Used before a
 * pool exists (the deploy flow's initial contribution pays this rate too). Returns null on a read
 * failure so the caller can fall back to fee-free wording rather than inventing a number.
 */
export async function readChainProtocolFeeBps(
  provider: AnyProvider,
  protocolConfigAddress: string,
): Promise<bigint | null> {
  try {
    const cfg = new Contract(protocolConfigAddress, PROTOCOL_CONFIG_ABI, provider);
    const bps = BigInt(await cfg.protocolFeeBps());
    return bps > PROTOCOL_MAX_FEE_BPS ? null : bps;
  } catch {
    return null;
  }
}

/**
 * Classify already-fetched runtime bytecode. Both selectors must be present: requiring two
 * independent 4-byte matches makes an accidental collision with unrelated bytecode implausible,
 * and a V2 pool always compiles in both.
 */
export function classifyPoolCode(runtimeCode: string): PoolContractVersion {
  const code = runtimeCode.toLowerCase();
  const hasConfig = code.includes(V2_ONLY_SELECTORS.protocolConfig);
  const hasFeeView = code.includes(V2_ONLY_SELECTORS.getProtocolFeeConfig);
  return hasConfig && hasFeeView ? "v2" : "v1";
}

/**
 * Which generation a deployed pool belongs to. Throws when the address has no code at all —
 * that is a wrong-address or wrong-network mistake, not a V1 pool, and must not be silently
 * treated as "no fee".
 */
export async function detectPoolContractVersion(
  provider: AnyProvider,
  poolAddress: string,
): Promise<PoolContractVersion> {
  const code = await provider.getCode(poolAddress);
  if (!code || code === "0x") {
    throw new Error("No contract found at that address on this network.");
  }
  return classifyPoolCode(code);
}

/**
 * Live fee parameters straight from the pool, which reads them from its immutable ProtocolConfig
 * reference. Never cached and never defaulted: an admin fee change takes effect for the next
 * contribution with no frontend deploy, so a stale or invented number would misstate the economics.
 */
export async function readLiveProtocolFee(
  provider: AnyProvider,
  poolAddress: string,
): Promise<ProtocolFeeConfig> {
  const pool = new Contract(poolAddress, FEE_ABI, provider);
  const [feeBps, recipient] = await pool.getProtocolFeeConfig();
  const bps = BigInt(feeBps);
  if (bps > PROTOCOL_MAX_FEE_BPS) {
    // The contract caps this at 300 bps and re-checks on every contribution, so a larger value
    // means we are not talking to the contract we think we are.
    throw new Error("Pool reported a protocol fee above the 3% maximum; refusing to show it.");
  }
  return { feeBps: bps, recipient: String(recipient) };
}

export type FundingSplit = {
  /** What leaves the funder's wallet for the contribution (excludes network gas). */
  grossAmount: bigint;
  /** Deducted from the gross and forwarded to the treasury. */
  feeAmount: bigint;
  /** What the pool ends up holding. */
  netAmount: bigint;
  feeBps: bigint;
};

/**
 * The fee is taken OUT OF the gross, never added on top: the funder is debited exactly
 * `grossAmount`. Uses the contract's integer floor arithmetic so the preview matches settlement
 * exactly, including the case where a small amount rounds the fee down to zero.
 */
export function previewFundingSplit(grossAmount: bigint, feeBps: bigint): FundingSplit {
  const { feeAmount, netAmount } = protocolFeeFor(grossAmount, feeBps);
  return { grossAmount, feeAmount, netAmount, feeBps };
}

/**
 * Token-native display for a preview row. Trims trailing zeros but always keeps at least the
 * first significant digit, so a small fee is shown as a real number rather than rounded to 0.
 */
export function formatTokenAmount(raw: bigint, decimals: number): string {
  const full = formatUnits(raw, decimals);
  if (!full.includes(".")) return full;
  const [whole, frac] = full.split(".");
  const trimmed = frac.replace(/0+$/, "");
  if (trimmed === "") return whole;
  const firstSig = trimmed.search(/[1-9]/);
  const keep = Math.max(4, firstSig + 1);
  return `${whole}.${trimmed.slice(0, keep)}`;
}

/** "1%", "0.75%", "0%" — trailing zeros trimmed, for UI labels. */
export function formatFeeBpsPercent(feeBps: bigint): string {
  const pct = (Number(feeBps) / Number(PROTOCOL_BPS_DENOMINATOR)) * 100;
  return `${Number(pct.toFixed(4))}%`;
}

export type FundingPreview =
  /** Legacy V1 pool: the contract has no protocol fee, so the UI must not imply one. */
  | { kind: "no-fee"; version: "v1" }
  /** V2 pool with the live rate read successfully. `feeAmount` may be 0 (0 bps, or rounding). */
  | { kind: "split"; version: "v2"; symbol: string; decimals: number; split: FundingSplit }
  /** The chain read failed. Show the reason; never substitute a default rate. */
  | { kind: "unavailable"; message: string };

/**
 * Fee preview for one prospective contribution.
 *
 * `grossAmount` must be the exact amount the funding transaction will use, so the preview and the
 * settlement agree to the wei. A read failure returns `unavailable` rather than a zero fee: for a
 * V2 pool the contract will still charge the live rate, and quietly showing "no fee" would
 * misstate the economics.
 */
export async function buildFundingPreview(args: {
  provider: AnyProvider;
  poolAddress: string;
  grossAmount: bigint;
  symbol: string;
  decimals: number;
}): Promise<FundingPreview> {
  const { provider, poolAddress, grossAmount, symbol, decimals } = args;
  let version: PoolContractVersion;
  try {
    version = await detectPoolContractVersion(provider, poolAddress);
  } catch (e) {
    return { kind: "unavailable", message: readErrorMessage(e) };
  }
  if (version === "v1") return { kind: "no-fee", version };
  try {
    const { feeBps } = await readLiveProtocolFee(provider, poolAddress);
    return { kind: "split", version, symbol, decimals, split: previewFundingSplit(grossAmount, feeBps) };
  } catch (e) {
    return { kind: "unavailable", message: readErrorMessage(e) };
  }
}

function readErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.includes("No contract found")
    ? raw
    : "Could not read this pool's current protocol fee from the network.";
}
