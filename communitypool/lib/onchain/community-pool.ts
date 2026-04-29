import {
  BaseContract,
  BrowserProvider,
  Contract,
  ContractFactory,
  ContractTransactionResponse,
  JsonRpcProvider,
  JsonRpcSigner,
  parseUnits,
  getAddress,
  isAddress,
} from "ethers";
import artifact from "./community-pool-artifact.json";
import { getDefaultErc20TokenConfigs, getPoolChainConfig } from "./pool-chain-config";
import { weiForUsdContribution } from "./price-math";
import { getExpectedChainId, networkLabelForChainId } from "@/lib/wallet/expected-chain";

export { weiForUsdContribution };

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address account) view returns (uint256)",
] as const;

export type DeployPoolParams = {
  name: string;
  description: string;
  /** Minimum contribution in USD (human, e.g. 5.5) — stored as 18-decimal fixed point on-chain. */
  minimumUsdHuman: string;
  coOwnerAddresses: string[];
  /** `YYYY-MM-DD` from `<input type="date" />`; interpreted as end of that UTC day. */
  expirationDateYmd: string;
};

export function dateInputToExpiresAtUnix(expirationDateYmd: string): bigint {
  const d = new Date(`${expirationDateYmd}T23:59:59.999Z`);
  const ms = d.getTime();
  if (Number.isNaN(ms)) throw new Error("Invalid expiration date.");
  return BigInt(Math.floor(ms / 1000));
}

function formatLocalYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function getLocalTodayYmd(now: Date = new Date()): string {
  return formatLocalYmd(now);
}

export function getMinExpirationYmd(now: Date = new Date()): string {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return formatLocalYmd(tomorrow);
}

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRealCalendarYmd(ymd: string): boolean {
  const match = YMD_RE.exec(ymd);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const utcMs = Date.UTC(year, month - 1, day);
  const roundTrip = new Date(utcMs);
  return (
    roundTrip.getUTCFullYear() === year &&
    roundTrip.getUTCMonth() === month - 1 &&
    roundTrip.getUTCDate() === day
  );
}

/**
 * Validates a pool-expiration `YYYY-MM-DD` string from the Deploy flow.
 * Returns `null` when valid, otherwise a human-readable error message.
 *
 * Rule: the date must be tomorrow or later in the user's local timezone.
 * Comparison is done lexicographically on the ymd string to avoid timezone
 * drift from constructing a Date from the input.
 */
export function validateExpirationDateYmd(
  input: string,
  now: Date = new Date(),
): string | null {
  const trimmed = input.trim();
  if (!trimmed) return "Pool expiration date is required";
  if (!isRealCalendarYmd(trimmed)) return "Enter a valid date (YYYY-MM-DD)";
  const min = getMinExpirationYmd(now);
  if (trimmed < min) return "Pool expiration must be tomorrow or later";
  return null;
}

export function parseMinimumUsdHuman(human: string): bigint {
  const t = human.trim();
  if (!t) throw new Error("Minimum USD amount is required.");
  return parseUnits(t, 18);
}

export function normalizeCoOwners(raw: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of raw) {
    const a = s.trim();
    if (!a) continue;
    if (!isAddress(a)) throw new Error(`Invalid owner address: ${a}`);
    const chk = getAddress(a);
    if (seen.has(chk)) continue;
    seen.add(chk);
    out.push(chk);
  }
  return out;
}

/**
 * Refuses to broadcast if the wallet is on a chain that doesn't match the build's
 * `NEXT_PUBLIC_EXPECTED_CHAIN_ID`. Catches the case where a mainnet build is connected to
 * Sepolia (or vice versa), which would otherwise deploy a pool with the wrong-chain token
 * addresses baked into its allowlist.
 */
export function assertChainMatchesExpected(connected: bigint, expected: bigint = getExpectedChainId()): void {
  if (connected === expected) return;
  throw new Error(
    `Wrong network: this build expects ${networkLabelForChainId(expected)} (chain ${expected.toString()}), ` +
      `but the wallet is on ${networkLabelForChainId(connected)} (chain ${connected.toString()}). ` +
      `Switch networks before deploying.`,
  );
}

export async function deployCommunityPool(
  signer: JsonRpcSigner,
  params: DeployPoolParams,
): Promise<{ contract: BaseContract; deployTx: ContractTransactionResponse }> {
  const network = await signer.provider!.getNetwork();
  const chainId = network.chainId;
  assertChainMatchesExpected(chainId);
  const cfg = getPoolChainConfig(chainId);

  const minimumUsd = parseMinimumUsdHuman(params.minimumUsdHuman);
  const coOwners = normalizeCoOwners(params.coOwnerAddresses);
  const expiresAt = dateInputToExpiresAtUnix(params.expirationDateYmd);
  if (expiresAt <= BigInt(Math.floor(Date.now() / 1000))) {
    throw new Error("Pool expiration must be in the future.");
  }

  const tokenConfigs = getDefaultErc20TokenConfigs(chainId).map((t) => ({
    token: getAddress(t.token),
    usdFeed: getAddress(t.usdFeed),
    decimals: t.decimals,
  }));

  const factory = new ContractFactory(artifact.abi, artifact.bytecode, signer);
  const contract = await factory.deploy(
    params.name.trim(),
    params.description.trim(),
    minimumUsd,
    coOwners,
    expiresAt,
    cfg.ethUsdPriceFeed,
    tokenConfigs,
  );
  const deployTx = contract.deploymentTransaction();
  if (!deployTx) throw new Error("Missing deployment transaction.");
  return { contract, deployTx };
}

export async function fundPoolEth(
  signer: JsonRpcSigner,
  poolAddress: string,
  ethUsdFeed: string,
  fundUsdHuman: string,
): Promise<ContractTransactionResponse> {
  const pool = new Contract(getAddress(poolAddress), artifact.abi, signer);
  const value = await weiForUsdContribution(signer, ethUsdFeed, fundUsdHuman);
  return pool.fund({ value }) as Promise<ContractTransactionResponse>;
}

export async function fundPoolErc20(
  signer: JsonRpcSigner,
  poolAddress: string,
  tokenAddress: string,
  amount: bigint,
): Promise<ContractTransactionResponse> {
  const poolAddr = getAddress(poolAddress);
  const token = getAddress(tokenAddress);
  const erc20 = new Contract(token, ERC20_ABI, signer);
  const pool = new Contract(poolAddr, artifact.abi, signer);
  const cur = await erc20.allowance(await signer.getAddress(), poolAddr);
  if (cur < amount) {
    const approveTx = await erc20.approve(poolAddr, amount);
    await approveTx.wait();
  }
  return pool.fundERC20(token, amount) as Promise<ContractTransactionResponse>;
}

export async function fundPoolErc20Human(
  signer: JsonRpcSigner,
  poolAddress: string,
  tokenAddress: string,
  humanAmount: string,
): Promise<ContractTransactionResponse> {
  const token = new Contract(getAddress(tokenAddress), ERC20_ABI, signer);
  const decimals = Number(await token.decimals());
  const amount = parseUnits(humanAmount.trim(), decimals);
  return fundPoolErc20(signer, poolAddress, tokenAddress, amount);
}

export async function withdrawPoolEth(
  signer: JsonRpcSigner,
  poolAddress: string,
): Promise<ContractTransactionResponse> {
  const pool = new Contract(getAddress(poolAddress), artifact.abi, signer);
  return pool.cheaperWithdraw() as Promise<ContractTransactionResponse>;
}

export async function withdrawPoolEthAmount(
  signer: JsonRpcSigner,
  poolAddress: string,
  amountWei: bigint,
): Promise<ContractTransactionResponse> {
  if (amountWei <= 0n) throw new Error("Withdraw amount must be greater than zero.");
  const pool = new Contract(getAddress(poolAddress), artifact.abi, signer);
  return pool.withdraw(amountWei) as Promise<ContractTransactionResponse>;
}

export async function withdrawPoolToken(
  signer: JsonRpcSigner,
  poolAddress: string,
  tokenAddress: string,
): Promise<ContractTransactionResponse> {
  const pool = new Contract(getAddress(poolAddress), artifact.abi, signer);
  return pool.withdrawToken(getAddress(tokenAddress)) as Promise<ContractTransactionResponse>;
}

export async function withdrawPoolTokenAmount(
  signer: JsonRpcSigner,
  poolAddress: string,
  tokenAddress: string,
  amount: bigint,
): Promise<ContractTransactionResponse> {
  if (amount <= 0n) throw new Error("Withdraw amount must be greater than zero.");
  const pool = new Contract(getAddress(poolAddress), artifact.abi, signer);
  return pool.withdrawTokenAmount(
    getAddress(tokenAddress),
    amount,
  ) as Promise<ContractTransactionResponse>;
}

/** After pool `expiresAt`, sends all ETH and whitelisted ERC20 balances to the immutable deployer. */
export async function releaseExpiredFundsToDeployer(
  signer: JsonRpcSigner,
  poolAddress: string,
): Promise<ContractTransactionResponse> {
  const pool = new Contract(getAddress(poolAddress), artifact.abi, signer);
  return pool.releaseExpiredFundsToDeployer() as Promise<ContractTransactionResponse>;
}

/**
 * Feature-detect whether the deployed pool bytecode includes `withdraw(uint256)`
 * and `withdrawTokenAmount(address,uint256)`. Pools deployed before these
 * functions were added to the contract are immutable and expose only
 * `cheaperWithdraw()` / `withdrawToken(address)` (full balance). Callers use
 * this to route to the correct withdraw path.
 */
export async function poolSupportsPartialWithdraw(
  provider: BrowserProvider | JsonRpcProvider,
  poolAddress: string,
): Promise<boolean> {
  const code = await provider.getCode(getAddress(poolAddress));
  // Solidity's function dispatcher embeds each selector as a PUSH4 operand,
  // so these 4-byte sequences appear literally in the runtime bytecode when
  // the function exists and not otherwise. A chance collision would only
  // downgrade to the normal revert path at submit time.
  const hasPartialEth = code.includes("2e1a7d4d"); // withdraw(uint256)
  const hasPartialErc20 = code.includes("b354a5b7"); // withdrawTokenAmount(address,uint256)
  return hasPartialEth && hasPartialErc20;
}

export async function getPoolWhitelistedTokenAddresses(
  provider: NonNullable<JsonRpcSigner["provider"]>,
  poolAddress: string,
): Promise<string[]> {
  const pool = new Contract(getAddress(poolAddress), artifact.abi, provider);
  const addrs: string[] = await pool.getWhitelistedTokens();
  return addrs.map((a: string) => getAddress(a));
}
