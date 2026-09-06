/**
 * Chain-specific addresses for CommunityPool deployment and funding UX.
 *
 * New pools receive a fixed **platform default** ERC20 whitelist per chain (not chosen by the user
 * at deploy time). On Ethereum mainnet that whitelist is WBTC, PAXG, and XAU₮ (Tether Gold),
 * plus native ETH funding via the ETH/USD feed.
 */

import { getExpectedChainId } from "@/lib/wallet/expected-chain";

export type TokenConfigArg = {
  token: string;
  usdFeed: string;
  decimals: number;
  /**
   * Immutable maximum accepted age (seconds) of this token's USD price, fixed at pool
   * construction. Policy is 2x the feed's documented heartbeat; see
   * docs/deployment/phase-2-7-mainnet-canary.md for the per-feed evidence. `null` means the chain
   * has no configured threshold, which blocks V2 deployment there but leaves read/fund UI working
   * for pools that already exist.
   */
  maxPriceAge: number | null;
};

export type Erc20PresetId = "wbtc" | "paxg" | "xaut";

export type Erc20Preset = {
  id: Erc20PresetId;
  symbol: string;
  label: string;
  token: string;
  usdFeed: string;
  decimals: number;
  maxPriceAge: number | null;
};

export type PoolChainConfig = {
  chainId: bigint;
  ethUsdPriceFeed: string;
  /** Immutable maximum accepted age (seconds) of the ETH/USD price for new pools; null if unset. */
  ethUsdMaxPriceAge: number | null;
  /**
   * The chain's single shared ProtocolConfig deployment (fee rate + treasury). Every V2 pool on
   * the chain points at this one address; it is never chosen or edited by a user, and there is no
   * placeholder — a chain without a real deployment cannot deploy V2 pools, which is expressed as
   * `null` here and enforced at deploy time.
   */
  protocolConfig: string | null;
  /** @deprecated Use getDefaultErc20TokenConfigs / getErc20Presets — kept for callers that only need WBTC. */
  wrappedBtc: TokenConfigArg | null;
  paxGold: TokenConfigArg | null;
  /** Tether Gold (XAU₮ / XAUT), when configured for the chain. */
  tetherGold: TokenConfigArg | null;
};

/** Fixed copy for deploy UI: platform-default assets (not user-configurable). */
export const PLATFORM_DEFAULT_SUPPORTED_ASSETS_DISPLAY =
  "ETH, WBTC, PAXG, XAU₮";

const SEPOLIA_ETH_USD = "0x694AA1769357215DE4FAC081bf1f309aDC325306";
const MAINNET_ETH_USD = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419";

/**
 * Per-feed freshness thresholds (seconds), immutable once a pool is deployed. Policy is 2x the
 * feed's documented Chainlink heartbeat, verified against reference data and on-chain reads in
 * Phase 2.6 (docs/deployment/phase-2-7-mainnet-canary.md). These mirror the Foundry deploy script
 * constants in script/DeployCommunityPool.s.sol; the pool constructor rejects a zero value.
 */
const MAINNET_HOURLY_FEED_MAX_AGE = 7_200; // ETH/USD and BTC/USD: 3600 s heartbeat
const MAINNET_DAILY_FEED_MAX_AGE = 172_800; // PAXG/USD and XAU/USD: 86400 s heartbeat

/**
 * Shared Ethereum-mainnet ProtocolConfig deployed in the Phase 2.7 canary
 * (tx 0x8b3249d41ce0935d9987a388f710aaf65d5e89116bc7bf80be6f3011899ce4d7). Admin and treasury are
 * state inside that contract, deliberately not mirrored here: the app never needs them, and the
 * pool reads the live values on every contribution.
 */
const MAINNET_PROTOCOL_CONFIG = "0x2eD7F089a6C2971B24eA91121aD65f9242F622c0";

/** PAX Gold token (Ethereum mainnet). */
const MAINNET_PAXG_TOKEN = "0x45804880De22913dAFE09f4980848ECE6EcbAf78";
/** PAXG / USD — https://reference-data-directory.vercel.app/feeds-mainnet.json */
const MAINNET_PAXG_USD_FEED = "0x9944D86CEB9160aF5C5feB251FD671923323f8C3";

/** Tether Gold (XAU₮) on Ethereum mainnet. */
const MAINNET_XAUT_TOKEN = "0x68749665FF8D2d112Fa859AA293F07A622782F38";
/** XAU / USD (per troy ounce) — https://data.chain.link/feeds/ethereum/mainnet/xau-usd */
const MAINNET_XAU_USD_FEED = "0x214eD9Da11D2fbe465a6fc601a91E62EbEc1a0D6";

function sepoliaWbtcFromEnv(): TokenConfigArg | null {
  const token = process.env.NEXT_PUBLIC_SEPOLIA_WBTC_TOKEN?.trim();
  const usdFeed = process.env.NEXT_PUBLIC_SEPOLIA_WBTC_USD_FEED?.trim();
  if (!token || !usdFeed) return null;
  const decimals = Number(process.env.NEXT_PUBLIC_SEPOLIA_WBTC_DECIMALS ?? "8");
  return { token, usdFeed, decimals, maxPriceAge: envMaxPriceAge("NEXT_PUBLIC_SEPOLIA_TOKEN_USD_MAX_AGE") };
}

function sepoliaPaxgFromEnv(): TokenConfigArg | null {
  const token = process.env.NEXT_PUBLIC_SEPOLIA_PAXG_TOKEN?.trim();
  const usdFeed = process.env.NEXT_PUBLIC_SEPOLIA_PAXG_USD_FEED?.trim();
  if (!token || !usdFeed) return null;
  const decimals = Number(process.env.NEXT_PUBLIC_SEPOLIA_PAXG_DECIMALS ?? "18");
  return { token, usdFeed, decimals, maxPriceAge: envMaxPriceAge("NEXT_PUBLIC_SEPOLIA_TOKEN_USD_MAX_AGE") };
}

function sepoliaXautFromEnv(): TokenConfigArg | null {
  const token = process.env.NEXT_PUBLIC_SEPOLIA_XAUT_TOKEN?.trim();
  const usdFeed = process.env.NEXT_PUBLIC_SEPOLIA_XAUT_USD_FEED?.trim();
  if (!token || !usdFeed) return null;
  const decimals = Number(process.env.NEXT_PUBLIC_SEPOLIA_XAUT_DECIMALS ?? "6");
  return { token, usdFeed, decimals, maxPriceAge: envMaxPriceAge("NEXT_PUBLIC_SEPOLIA_TOKEN_USD_MAX_AGE") };
}

function mainnetWbtc(): TokenConfigArg {
  return {
    token: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
    usdFeed: "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c",
    decimals: 8,
    maxPriceAge: MAINNET_HOURLY_FEED_MAX_AGE,
  };
}

function mainnetPaxg(): TokenConfigArg {
  return {
    token: MAINNET_PAXG_TOKEN,
    usdFeed: MAINNET_PAXG_USD_FEED,
    decimals: 18,
    maxPriceAge: MAINNET_DAILY_FEED_MAX_AGE,
  };
}

function mainnetTetherGold(): TokenConfigArg {
  return {
    token: MAINNET_XAUT_TOKEN,
    usdFeed: MAINNET_XAU_USD_FEED,
    decimals: 6,
    maxPriceAge: MAINNET_DAILY_FEED_MAX_AGE,
  };
}

/**
 * Deploy-time-only values are read leniently here and validated at the deploy call. Reading a
 * config must never throw: the funding, withdraw and balance screens call it for pools that
 * already exist, and those must keep working on any chain regardless of whether new V2
 * deployments are configured there. There is deliberately no fallback to another chain's
 * ProtocolConfig — an unset value stays null and blocks deployment.
 */
function envAddressOrNull(varName: string): string | null {
  return process.env[varName]?.trim() || null;
}

/** Feeds outside mainnet have looser cadence, so the threshold must be stated explicitly. */
function envMaxPriceAge(varName: string): number | null {
  const raw = process.env[varName]?.trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

/**
 * Anvil / local: set NEXT_PUBLIC_LOCAL_ETH_USD_FEED to your mock aggregator (e.g. from `forge script`).
 */
function localFromEnv(): PoolChainConfig | null {
  const feed = process.env.NEXT_PUBLIC_LOCAL_ETH_USD_FEED?.trim();
  if (!feed) return null;
  return {
    chainId: BigInt(31337),
    ethUsdPriceFeed: feed,
    ethUsdMaxPriceAge: envMaxPriceAge("NEXT_PUBLIC_LOCAL_ETH_USD_MAX_AGE") ?? 86_400,
    protocolConfig: envAddressOrNull("NEXT_PUBLIC_LOCAL_PROTOCOL_CONFIG"),
    wrappedBtc: null,
    paxGold: null,
    tetherGold: null,
  };
}

function toPreset(id: Erc20PresetId, symbol: string, label: string, cfg: TokenConfigArg): Erc20Preset {
  return { id, symbol, label, ...cfg };
}

/** ERC20 presets for funding / withdraw UI (stable order: WBTC, PAXG, XAU₮ when configured). */
export function getErc20Presets(chainId: bigint): Erc20Preset[] {
  const cfg = getPoolChainConfig(chainId);
  const out: Erc20Preset[] = [];
  if (cfg.wrappedBtc) {
    out.push(toPreset("wbtc", "WBTC", "Wrapped Bitcoin (WBTC)", cfg.wrappedBtc));
  }
  if (cfg.paxGold) {
    out.push(toPreset("paxg", "PAXG", "Pax Gold (PAXG)", cfg.paxGold));
  }
  if (cfg.tetherGold) {
    out.push(toPreset("xaut", "XAU₮", "Tether Gold (XAU₮ / XAUT)", cfg.tetherGold));
  }
  return out;
}

/**
 * Human-readable list of assets a new pool accepts by default (deploy step + review).
 * Mainnet and Sepolia use the fixed platform list. Other chains: ETH plus `getErc20Presets` symbols.
 */
export function describePlatformAcceptedAssetsForDeploy(chainId: bigint): string {
  if (chainId === BigInt(1) || chainId === BigInt(11155111)) {
    return PLATFORM_DEFAULT_SUPPORTED_ASSETS_DISPLAY;
  }
  const erc20 = getErc20Presets(chainId);
  if (erc20.length === 0) return "ETH";
  return `ETH, ${erc20.map((p) => p.symbol).join(", ")}`;
}

/**
 * ERC20 rows for the deploy “Fund with” selector. Uses mainnet presets when the wallet is not
 * connected yet. On Sepolia, falls back to the same platform token/feed definitions as mainnet when
 * env overrides are unset (override via `NEXT_PUBLIC_SEPOLIA_*` for Sepolia-native addresses).
 */
export function getErc20PresetsForDeployModal(chainId: bigint | null): Erc20Preset[] {
  if (chainId === null) {
    return getErc20Presets(BigInt(1));
  }
  return getErc20Presets(chainId);
}

/**
 * ERC20 rows for the Fund / Withdraw modals. Pool chain wins when known
 * (Fund/Withdraw is always tied to a specific deployed pool whose chain
 * is fixed at deploy time). Wallet chain is the next-best signal. Falls
 * back to the build's expected chain so the buttons are populated even
 * before MetaMask reports a chain id. Returns [] only if every source
 * is unresolvable.
 */
export function getErc20PresetsForPoolChain(
  poolChainId: number | bigint | null | undefined,
  walletChainId: bigint | null,
): Erc20Preset[] {
  let target: bigint | null = null;
  if (poolChainId !== null && poolChainId !== undefined) {
    target = typeof poolChainId === "bigint" ? poolChainId : BigInt(poolChainId);
  } else if (walletChainId !== null) {
    target = walletChainId;
  } else {
    try {
      target = getExpectedChainId();
    } catch {
      return [];
    }
  }
  try {
    return getErc20Presets(target);
  } catch {
    return [];
  }
}

/** @deprecated Use describePlatformAcceptedAssetsForDeploy */
export function describeDefaultPoolAssets(chainId: bigint): string {
  return describePlatformAcceptedAssetsForDeploy(chainId);
}

/** Constructor `tokenConfigs`: all default ERC20s for this chain (stable order: WBTC, PAXG, XAU₮). */
export function getDefaultErc20TokenConfigs(chainId: bigint): TokenConfigArg[] {
  return getErc20Presets(chainId).map(({ token, usdFeed, decimals, maxPriceAge }) => ({
    token,
    usdFeed,
    decimals,
    maxPriceAge,
  }));
}

export function getPoolChainConfig(chainId: bigint): PoolChainConfig {
  if (chainId === BigInt(31337)) {
    const local = localFromEnv();
    if (local) return local;
    throw new Error(
      "Local chain: set NEXT_PUBLIC_LOCAL_ETH_USD_FEED to your mock ETH/USD aggregator address.",
    );
  }
  if (chainId === BigInt(11155111)) {
    // Sepolia: only enable an ERC20 when its NEXT_PUBLIC_SEPOLIA_* env vars are set. Do NOT
    // fall back to mainnet token addresses — those contracts don't exist on Sepolia and the
    // resulting pool would have a misleading allowlist that fund/withdraw txs cannot satisfy.
    return {
      chainId,
      ethUsdPriceFeed: SEPOLIA_ETH_USD,
      ethUsdMaxPriceAge: envMaxPriceAge("NEXT_PUBLIC_SEPOLIA_ETH_USD_MAX_AGE"),
      protocolConfig: envAddressOrNull("NEXT_PUBLIC_SEPOLIA_PROTOCOL_CONFIG"),
      wrappedBtc: sepoliaWbtcFromEnv(),
      paxGold: sepoliaPaxgFromEnv(),
      tetherGold: sepoliaXautFromEnv(),
    };
  }
  if (chainId === BigInt(1)) {
    return {
      chainId,
      ethUsdPriceFeed: MAINNET_ETH_USD,
      ethUsdMaxPriceAge: MAINNET_HOURLY_FEED_MAX_AGE,
      protocolConfig: MAINNET_PROTOCOL_CONFIG,
      wrappedBtc: mainnetWbtc(),
      paxGold: mainnetPaxg(),
      tetherGold: mainnetTetherGold(),
    };
  }
  throw new Error(`Unsupported chainId ${chainId.toString()} for CommunityPool deployment.`);
}
