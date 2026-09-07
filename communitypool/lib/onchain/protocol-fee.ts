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
 * Significant digits kept when an amount is too long to print exactly. Six is enough that a 1%
 * fee never collapses into its gross: at 1%, gross and net differ in the third significant digit.
 */
const DISPLAY_SIGNIFICANT_DIGITS = 6;

/** Beyond this many fraction characters an exact value is unreadable, so it is truncated. */
const EXACT_FRACTION_LIMIT = 10;

/**
 * Token-native display for a preview row.
 *
 * Display only — it never touches the bigint the transaction uses. Two rules:
 *
 *  - Print the exact value whenever its fraction is short enough to read. Every WBTC (8 dp) and
 *    XAU₮ (6 dp) amount qualifies, so those assets are always shown to their full on-chain
 *    precision and never beyond it.
 *  - Otherwise keep six significant digits starting at the first non-zero one. A tiny 18-decimal
 *    amount would otherwise truncate to a single significant digit, which is what made a gross of
 *    0.000003984… and a net of 0.000003944… both render as "0.000003" — hiding the very fee this
 *    row exists to disclose.
 *
 * Trailing zeros are dropped, and a whole number prints without a decimal point.
 */
export function formatTokenAmount(raw: bigint, decimals: number): string {
  const full = formatUnits(raw, decimals);
  if (!full.includes(".")) return full;
  const [whole, frac] = full.split(".");
  const trimmed = frac.replace(/0+$/, "");
  if (trimmed === "") return whole;
  if (trimmed.length <= Math.min(decimals, EXACT_FRACTION_LIMIT)) {
    return `${whole}.${trimmed}`;
  }
  const firstSig = trimmed.search(/[1-9]/);
  const keep = Math.min(decimals, firstSig + DISPLAY_SIGNIFICANT_DIGITS);
  const shown = trimmed.slice(0, keep).replace(/0+$/, "");
  return shown === "" ? whole : `${whole}.${shown}`;
}

/**
 * Full-precision token-native display, for values a user may copy or compare.
 *
 * Unlike `formatTokenAmount` this never shortens: it prints every meaningful digit the token can
 * express and only drops trailing zeros. Two amounts that differ by one raw unit always render
 * differently. Use it for a spending cap a user will paste into a wallet, and for explaining a
 * numeric inequality — the readable formatter collapsed an allowance of 2,270,850,000,000 and a
 * requirement of 2,270,857,687,598 into the same "0.00000227085", making the production error
 * message read as though both sides were equal.
 *
 * String/bigint throughout: no floating point, no rounding.
 */
export function formatTokenAmountExact(raw: bigint, decimals: number): string {
  const full = formatUnits(raw, decimals);
  if (!full.includes(".")) return full;
  const [whole, frac] = full.split(".");
  const trimmed = frac.replace(/0+$/, "");
  return trimmed === "" ? whole : `${whole}.${trimmed}`;
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
  | {
      kind: "split";
      version: "v2";
      symbol: string;
      decimals: number;
      /** Checksummed ERC-20 address this amount was priced for; absent for native ETH. */
      tokenAddress?: string;
      split: FundingSplit;
    }
  /**
   * A read failed. `problem` names which one, so a price-feed outage is never reported as a
   * protocol-fee outage. Never substitute a default rate.
   */
  | { kind: "unavailable"; message: string; problem?: PreviewProblemKind };

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
  tokenAddress?: string;
}): Promise<FundingPreview> {
  const { provider, poolAddress, grossAmount, symbol, decimals, tokenAddress } = args;
  let version: PoolContractVersion;
  try {
    version = await detectPoolContractVersion(provider, poolAddress);
  } catch (e) {
    return { kind: "unavailable", message: readErrorMessage(e) };
  }
  if (version === "v1") return { kind: "no-fee", version };
  let feeBps: bigint;
  try {
    ({ feeBps } = await readLiveProtocolFee(provider, poolAddress));
  } catch (e) {
    const raw = e instanceof Error ? e.message : "";
    return raw.includes("3%")
      ? { kind: "unavailable", message: raw, problem: "fee" }
      : { kind: "unavailable", message: describePreviewProblem("fee").message, problem: "fee" };
  }
  try {
    return {
      kind: "split",
      version,
      symbol,
      decimals,
      tokenAddress,
      split: previewFundingSplit(grossAmount, feeBps),
    };
  } catch {
    return {
      kind: "unavailable",
      message: describePreviewProblem("calculation").message,
      problem: "calculation",
    };
  }
}

function readErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.includes("No contract found")
    ? raw
    : "Could not read this pool's current protocol fee from the network.";
}

/**
 * Why a contribution preview could not be produced.
 *
 * Kept distinct because the three causes are operationally different: the fee comes from
 * ProtocolConfig, the price from that asset's Chainlink feed, and the split from local
 * arithmetic. Collapsing them into one message sends people to debug the wrong contract — the
 * Phase 2.8 smoke test hit exactly that, where a price-read failure was reported as
 * "could not read the current protocol fee".
 */
export type PreviewProblemKind = "wallet" | "fee" | "price" | "calculation";

export type PreviewProblem = {
  kind: PreviewProblemKind;
  /** User-facing sentence. Never contains RPC internals. */
  message: string;
};

/** User-facing copy for a preview failure. `assetLabel` names the asset whose price failed. */
export function describePreviewProblem(
  kind: PreviewProblemKind,
  assetLabel?: string,
): PreviewProblem {
  switch (kind) {
    case "wallet":
      return {
        kind,
        message: "Connect your wallet to calculate the initial contribution.",
      };
    case "fee":
      return {
        kind,
        message:
          "Could not read the current protocol fee. This is blocked until the fee can be confirmed.",
      };
    case "price":
      return {
        kind,
        message: assetLabel
          ? `Could not read the current ${assetLabel} price needed to calculate the contribution. This is blocked until it can be confirmed.`
          : "Could not read the current price needed to calculate the contribution. This is blocked until it can be confirmed.",
      };
    case "calculation":
      return {
        kind,
        message: "Could not calculate the initial contribution. Please retry.",
      };
  }
}

/** Label for the price feed behind an asset, for use in `describePreviewProblem`. */
export function priceLabelForAsset(symbol: string): string {
  return symbol === "ETH" ? "ETH/USD" : `${symbol}/USD`;
}

