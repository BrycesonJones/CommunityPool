/**
 * Technical floors (dust / rounding), single-tx USD cap, and fee-vs-deposit hints.
 * Do not surface MAX_SINGLE_TX_USD in static UI; only show errors when input exceeds it.
 */

import {
  Contract,
  formatUnits,
  JsonRpcSigner,
  parseUnits,
  getAddress,
} from "ethers";
import { CHAINLINK_AGGREGATOR_V3_ABI, weiForUsdContribution } from "./price-math";
import type { Erc20Preset } from "./pool-chain-config";
import artifact from "./community-pool-artifact.json";

export const TECHNICAL_MIN_POOL_USD_HUMAN = "0.01";
export const TECHNICAL_MIN_FUND_ETH_USD_HUMAN = "0.01";

/** Format USD notional for `parseMinimumUsdHuman` (no scientific notation). */
export function formatUsdHumanForPoolMinimum(usd: number): string {
  const floor = parseFloat(TECHNICAL_MIN_POOL_USD_HUMAN);
  const v = Math.max(usd, floor);
  if (!Number.isFinite(v)) return TECHNICAL_MIN_POOL_USD_HUMAN;
  const trimmed = v.toFixed(18).replace(/\.?0+$/, "");
  return trimmed === "" || trimmed === "." ? TECHNICAL_MIN_POOL_USD_HUMAN : trimmed;
}

const MAX_SINGLE_TX_USD = 50_000;

const FEE_VS_DEPOSIT_WARN_RATIO = 0.25;
const FEE_WARN_MIN_DEPOSIT_USD = 0.05;

const ASSUMED_FUND_GAS_ETH = BigInt(220_000);
const ASSUMED_ERC20_FUND_GAS = BigInt(320_000);

export function parsePositiveDecimal(s: string): number | null {
  const n = parseFloat(s.trim());
  if (s.trim() === "" || Number.isNaN(n)) return null;
  return n;
}

export function validatePoolMinimumUsdHuman(human: string): string | undefined {
  const n = parsePositiveDecimal(human);
  if (n === null) return "Enter a valid minimum (USD).";
  const floor = parseFloat(TECHNICAL_MIN_POOL_USD_HUMAN);
  if (n < floor) {
    return `Minimum must be at least $${floor} USD (technical floor for dust and rounding).`;
  }
  return undefined;
}

export function validateFundEthUsdHuman(human: string): string | undefined {
  const n = parsePositiveDecimal(human);
  if (n === null) return "Enter a valid USD amount.";
  const floor = parseFloat(TECHNICAL_MIN_FUND_ETH_USD_HUMAN);
  if (n < floor) {
    return `Amount must be at least $${floor} USD (technical floor).`;
  }
  if (n > MAX_SINGLE_TX_USD) {
    return "This amount exceeds the maximum allowed for a single transaction.";
  }
  return undefined;
}

/** Convert a USD notion (human, e.g. "100.50") to token human units using the preset’s Chainlink feed. */
export async function erc20UsdToHumanAmountString(
  signer: JsonRpcSigner,
  preset: Pick<Erc20Preset, "usdFeed" | "decimals">,
  usdHuman: string,
): Promise<string | null> {
  try {
    const raw = usdHuman.trim();
    if (!raw) return null;
    const feed = new Contract(preset.usdFeed, CHAINLINK_AGGREGATOR_V3_ABI, signer);
    const round = await feed.latestRoundData();
    const ans = BigInt(round.answer as bigint);
    if (ans <= BigInt(0)) return null;
    const priceUsd18 = ans * BigInt(10) ** BigInt(10);
    const usd18 = parseUnits(raw, 18);
    const tokenRaw = (usd18 * BigInt(10) ** BigInt(preset.decimals)) / priceUsd18;
    if (tokenRaw <= BigInt(0)) return null;
    return formatUnits(tokenRaw, preset.decimals);
  } catch {
    return null;
  }
}

async function ethUsdSpot(signer: JsonRpcSigner, ethUsdFeed: string): Promise<number | null> {
  try {
    const feed = new Contract(ethUsdFeed, CHAINLINK_AGGREGATOR_V3_ABI, signer);
    const round = await feed.latestRoundData();
    const ans = Number(round.answer);
    if (!Number.isFinite(ans) || ans <= 0) return null;
    return ans / 1e8;
  } catch {
    return null;
  }
}

async function feeUsdFromGas(
  signer: JsonRpcSigner,
  ethUsdFeed: string,
  gasLimit: bigint,
): Promise<number | null> {
  const prov = signer.provider;
  if (!prov) return null;
  const fee = await prov.getFeeData();
  const gasPrice = fee.maxFeePerGas ?? fee.gasPrice;
  if (!gasPrice) return null;
  const feeWei = gasLimit * gasPrice;
  const spot = await ethUsdSpot(signer, ethUsdFeed);
  if (spot === null) return null;
  return parseFloat(formatUnits(feeWei, 18)) * spot;
}

export async function fundEthFeeInefficiencyMessage(
  signer: JsonRpcSigner,
  poolAddress: string,
  ethUsdFeed: string,
  fundUsdHuman: string,
): Promise<string | null> {
  const depositUsd = parsePositiveDecimal(fundUsdHuman);
  if (depositUsd === null || depositUsd < FEE_WARN_MIN_DEPOSIT_USD) return null;
  try {
    const value = await weiForUsdContribution(signer, ethUsdFeed, fundUsdHuman);
    const pool = new Contract(getAddress(poolAddress), artifact.abi, signer);
    const gas = await pool.fund.estimateGas({ value });
    const feeUsd = await feeUsdFromGas(signer, ethUsdFeed, gas);
    if (feeUsd === null) return null;
    if (feeUsd > FEE_VS_DEPOSIT_WARN_RATIO * depositUsd) {
      return "Estimated network fees are high relative to this deposit. For small amounts, testing on a cheaper network, or waiting for lower gas, may be more efficient.";
    }
  } catch {
    return null;
  }
  return null;
}

export async function deployFlowEthFundFeeInefficiencyMessage(
  signer: JsonRpcSigner,
  ethUsdFeed: string,
  fundUsdHuman: string,
): Promise<string | null> {
  const depositUsd = parsePositiveDecimal(fundUsdHuman);
  if (depositUsd === null || depositUsd < FEE_WARN_MIN_DEPOSIT_USD) return null;
  const feeUsd = await feeUsdFromGas(signer, ethUsdFeed, ASSUMED_FUND_GAS_ETH);
  if (feeUsd === null) return null;
  if (feeUsd > FEE_VS_DEPOSIT_WARN_RATIO * depositUsd) {
    return "Estimated network fees are high relative to this deposit. For small amounts or testing, consider a network with lower fees.";
  }
  return null;
}

export async function fundErc20FeeInefficiencyMessage(
  signer: JsonRpcSigner,
  ethUsdFeed: string,
  erc20DepositUsdApprox: number | null,
): Promise<string | null> {
  if (erc20DepositUsdApprox === null || erc20DepositUsdApprox < FEE_WARN_MIN_DEPOSIT_USD) {
    return null;
  }
  const feeUsd = await feeUsdFromGas(signer, ethUsdFeed, ASSUMED_ERC20_FUND_GAS);
  if (feeUsd === null) return null;
  if (feeUsd > FEE_VS_DEPOSIT_WARN_RATIO * erc20DepositUsdApprox) {
    return "ERC20 funding may require an approval plus a transfer; estimated total fees are high relative to the dollar value of this deposit.";
  }
  return null;
}
