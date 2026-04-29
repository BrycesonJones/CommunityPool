/**
 * Source of truth for Open Pools "Amount" and "Balance (USD)".
 *
 * For a given pool contract, read:
 *   - native ETH balance via `provider.getBalance(pool)`
 *   - every whitelisted ERC20's `balanceOf(pool)` / `decimals()`
 *   - Chainlink `latestRoundData()` for each asset's USD feed
 *
 * and return a normalized view. The UI's `fundedAmountHuman` column shows the
 * primary asset's `human` balance; `balanceUsd` shows the sum across all
 * assets (TVL). See `applyOnChainBalancesToCard` in pool-activity-service.
 */

import {
  Contract,
  formatUnits,
  getAddress,
  JsonRpcProvider,
  type BrowserProvider,
} from "ethers";
import { CHAINLINK_AGGREGATOR_V3_ABI } from "./price-math";
import { getErc20Presets, getPoolChainConfig } from "./pool-chain-config";
import { getPoolWhitelistedTokenAddresses } from "./community-pool";
import { CHAIN_METADATA } from "@/lib/wallet/expected-chain";

/**
 * Read-only RPC fallback for chain reads when the user's wallet provider
 * either isn't connected or is on the wrong chain.
 *
 * Precedence per chain:
 *   1. `NEXT_PUBLIC_READ_RPC_URL_<chainId>`  (operator override)
 *   2. First `rpcUrls` from CHAIN_METADATA (public llama / sepolia.org)
 *
 * Public RPCs can be slow/flaky; callers handle per-pool failure gracefully
 * (stale DB values remain the fallback). Feeds like Chainlink are on-chain
 * so any RPC on the correct network serves them.
 */
export function readOnlyProviderForChain(
  chainId: number,
): JsonRpcProvider | null {
  const override =
    process.env[`NEXT_PUBLIC_READ_RPC_URL_${chainId}`]?.trim() ?? "";
  const fallback = CHAIN_METADATA[String(chainId)]?.rpcUrls?.[0];
  const url = override || fallback;
  if (!url) return null;
  return new JsonRpcProvider(url);
}

const ERC20_READ_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
] as const;

export type PoolAssetBalance = {
  /** "ETH" for native; token symbol ("WBTC", "PAXG", "XAU\u20ae", ...) otherwise. */
  symbol: string;
  isNative: boolean;
  /** Checksummed token address, or `null` for native ETH. */
  tokenAddress: string | null;
  decimals: number;
  /** Raw balance in base units (wei or token's smallest unit). */
  raw: bigint;
  /** Human-decimal string from `formatUnits(raw, decimals)`. */
  human: string;
  /** USD per 1 whole unit from Chainlink, or `null` if the feed is missing/unreadable. */
  usdPerUnit: number | null;
  /** `human * usdPerUnit` as a number, or `0` if feed unavailable. */
  usd: number;
};

export type PoolOnChainBalances = {
  /** Checksummed pool contract address. */
  pool: string;
  chainId: number;
  /** Block at which `getBlockNumber()` returned; useful for debug / reconciliation logs. */
  blockNumber: number;
  nativeEth: PoolAssetBalance;
  /** Whitelisted ERC20s held by the pool (may have 0 balance). */
  tokens: PoolAssetBalance[];
  /** Sum of `nativeEth.usd` + every `tokens[i].usd`. */
  totalUsd: number;
  /** Unix ms when the read finished; for debug / staleness checks. */
  readAt: number;
};

async function readChainlinkUsdPerUnit(
  provider: BrowserProvider | JsonRpcProvider,
  feedAddress: string,
): Promise<number | null> {
  try {
    const feed = new Contract(feedAddress, CHAINLINK_AGGREGATOR_V3_ABI, provider);
    const round = await feed.latestRoundData();
    const ans = Number(round.answer);
    if (!Number.isFinite(ans) || ans <= 0) return null;
    return ans / 1e8;
  } catch {
    return null;
  }
}

function safeNumberFromHuman(human: string): number {
  const n = Number(human);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Read and price every asset currently held by `poolAddress`. Never throws for
 * individual missing feeds or unreadable tokens — those contribute `usd: 0`
 * and the remaining assets are still reported. Throws only for fundamental
 * provider errors on the native balance or block-number reads.
 */
export async function readPoolOnChainBalances(
  provider: BrowserProvider | JsonRpcProvider,
  chainId: number,
  poolAddress: string,
): Promise<PoolOnChainBalances> {
  const pool = getAddress(poolAddress);
  const cfg = getPoolChainConfig(BigInt(chainId));
  const presets = getErc20Presets(BigInt(chainId));

  const [rawEthBal, ethUsdPerUnit, blockNumber, whitelistAddrs] =
    await Promise.all([
      provider.getBalance(pool) as Promise<bigint>,
      readChainlinkUsdPerUnit(provider, cfg.ethUsdPriceFeed),
      provider.getBlockNumber(),
      getPoolWhitelistedTokenAddresses(provider, pool).catch(
        () => [] as string[],
      ),
    ]);

  const nativeHuman = formatUnits(rawEthBal, 18);
  const nativeEth: PoolAssetBalance = {
    symbol: "ETH",
    isNative: true,
    tokenAddress: null,
    decimals: 18,
    raw: rawEthBal,
    human: nativeHuman,
    usdPerUnit: ethUsdPerUnit,
    usd:
      ethUsdPerUnit !== null
        ? safeNumberFromHuman(nativeHuman) * ethUsdPerUnit
        : 0,
  };

  const tokens: PoolAssetBalance[] = await Promise.all(
    whitelistAddrs.map(async (tokenAddr): Promise<PoolAssetBalance> => {
      const checksummed = getAddress(tokenAddr);
      const preset = presets.find(
        (p) => getAddress(p.token) === checksummed,
      );
      const token = new Contract(checksummed, ERC20_READ_ABI, provider);

      let balance = BigInt(0);
      try {
        balance = (await token.balanceOf(pool)) as bigint;
      } catch {
        balance = BigInt(0);
      }

      let decimals = preset?.decimals ?? 18;
      let symbol = preset?.symbol ?? "";
      if (!preset) {
        try {
          decimals = Number(await token.decimals());
        } catch {
          /* keep fallback */
        }
        try {
          symbol = (await token.symbol()) as string;
        } catch {
          symbol = checksummed.slice(0, 6);
        }
      }

      const human = formatUnits(balance, decimals);
      const usdPerUnit = preset
        ? await readChainlinkUsdPerUnit(provider, preset.usdFeed)
        : null;
      const usd =
        usdPerUnit !== null ? safeNumberFromHuman(human) * usdPerUnit : 0;

      return {
        symbol,
        isNative: false,
        tokenAddress: checksummed,
        decimals,
        raw: balance,
        human,
        usdPerUnit,
        usd,
      };
    }),
  );

  const totalUsd = nativeEth.usd + tokens.reduce((sum, t) => sum + t.usd, 0);
  return {
    pool,
    chainId,
    blockNumber: Number(blockNumber),
    nativeEth,
    tokens,
    totalUsd,
    readAt: Date.now(),
  };
}

/**
 * Fetch a pool's balances via the server-side API route. Used by the client
 * as a more-reliable fallback than `readOnlyProviderForChain` when the
 * wallet provider isn't usable (wallet disconnected or on a different
 * chain). The server route has access to the app's Alchemy credentials and
 * is not subject to the rate-limits that make public RPCs unreliable.
 *
 * Returns `null` on 5xx / network failure so the caller can fall through to
 * the public RPC fallback.
 */
export async function fetchPoolBalancesViaApi(
  chainId: number,
  poolAddress: string,
): Promise<PoolOnChainBalances | null> {
  const url = `/api/pools/balances?chainId=${encodeURIComponent(
    String(chainId),
  )}&address=${encodeURIComponent(poolAddress)}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      pool: string;
      chainId: number;
      blockNumber: number;
      nativeEth: Omit<PoolAssetBalance, "raw"> & { raw: string };
      tokens: (Omit<PoolAssetBalance, "raw"> & { raw: string })[];
      totalUsd: number;
      readAt: number;
    };
    return {
      pool: json.pool,
      chainId: json.chainId,
      blockNumber: json.blockNumber,
      nativeEth: { ...json.nativeEth, raw: BigInt(json.nativeEth.raw) },
      tokens: json.tokens.map((t) => ({ ...t, raw: BigInt(t.raw) })),
      totalUsd: json.totalUsd,
      readAt: json.readAt,
    };
  } catch {
    return null;
  }
}

/** Case-insensitive match for a pool row's stored `asset_type`. */
export function primaryAssetBalanceFor(
  balances: PoolOnChainBalances,
  assetType: string,
): PoolAssetBalance {
  const at = (assetType ?? "").trim();
  if (!at || at.toUpperCase() === "ETH") return balances.nativeEth;
  const t = balances.tokens.find(
    (x) => x.symbol.toUpperCase() === at.toUpperCase(),
  );
  return t ?? balances.nativeEth;
}
