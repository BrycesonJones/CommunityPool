/**
 * Chain-specific addresses for CommunityPool deployment and funding UX.
 *
 * New pools receive a fixed **platform default** ERC20 whitelist per chain (not chosen by the user
 * at deploy time). On Ethereum mainnet that whitelist is WBTC, PAXG, and XAU₮ (Tether Gold),
 * plus native ETH funding via the ETH/USD feed.
 */

export type TokenConfigArg = {
  token: string;
  usdFeed: string;
  decimals: number;
};

export type Erc20PresetId = "wbtc" | "paxg" | "xaut";

export type Erc20Preset = {
  id: Erc20PresetId;
  symbol: string;
  label: string;
  token: string;
  usdFeed: string;
  decimals: number;
};

export type PoolChainConfig = {
  chainId: bigint;
  ethUsdPriceFeed: string;
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
  return { token, usdFeed, decimals };
}

function sepoliaPaxgFromEnv(): TokenConfigArg | null {
  const token = process.env.NEXT_PUBLIC_SEPOLIA_PAXG_TOKEN?.trim();
  const usdFeed = process.env.NEXT_PUBLIC_SEPOLIA_PAXG_USD_FEED?.trim();
  if (!token || !usdFeed) return null;
  const decimals = Number(process.env.NEXT_PUBLIC_SEPOLIA_PAXG_DECIMALS ?? "18");
  return { token, usdFeed, decimals };
}

function sepoliaXautFromEnv(): TokenConfigArg | null {
  const token = process.env.NEXT_PUBLIC_SEPOLIA_XAUT_TOKEN?.trim();
  const usdFeed = process.env.NEXT_PUBLIC_SEPOLIA_XAUT_USD_FEED?.trim();
  if (!token || !usdFeed) return null;
  const decimals = Number(process.env.NEXT_PUBLIC_SEPOLIA_XAUT_DECIMALS ?? "6");
  return { token, usdFeed, decimals };
}

function mainnetWbtc(): TokenConfigArg {
  return {
    token: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
    usdFeed: "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c",
    decimals: 8,
  };
}

function mainnetPaxg(): TokenConfigArg {
  return {
    token: MAINNET_PAXG_TOKEN,
    usdFeed: MAINNET_PAXG_USD_FEED,
    decimals: 18,
  };
}

function mainnetTetherGold(): TokenConfigArg {
  return {
    token: MAINNET_XAUT_TOKEN,
    usdFeed: MAINNET_XAU_USD_FEED,
    decimals: 6,
  };
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

/** @deprecated Use describePlatformAcceptedAssetsForDeploy */
export function describeDefaultPoolAssets(chainId: bigint): string {
  return describePlatformAcceptedAssetsForDeploy(chainId);
}

/** Constructor `tokenConfigs`: all default ERC20s for this chain (stable order: WBTC, PAXG, XAU₮). */
export function getDefaultErc20TokenConfigs(chainId: bigint): TokenConfigArg[] {
  return getErc20Presets(chainId).map(({ token, usdFeed, decimals }) => ({
    token,
    usdFeed,
    decimals,
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
      wrappedBtc: sepoliaWbtcFromEnv(),
      paxGold: sepoliaPaxgFromEnv(),
      tetherGold: sepoliaXautFromEnv(),
    };
  }
  if (chainId === BigInt(1)) {
    return {
      chainId,
      ethUsdPriceFeed: MAINNET_ETH_USD,
      wrappedBtc: mainnetWbtc(),
      paxGold: mainnetPaxg(),
      tetherGold: mainnetTetherGold(),
    };
  }
  throw new Error(`Unsupported chainId ${chainId.toString()} for CommunityPool deployment.`);
}
