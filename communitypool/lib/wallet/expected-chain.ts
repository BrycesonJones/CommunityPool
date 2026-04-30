/**
 * Local development / CI default. In production, NEXT_PUBLIC_EXPECTED_CHAIN_ID
 * MUST be set explicitly — see `resolveExpectedChainId`. We never silently
 * default a production build to a testnet.
 */
const DEFAULT_CHAIN_ID = BigInt(11155111);

function parseEnvChainId(raw: string | undefined): bigint | null {
  if (raw == null || raw.trim() === "") return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  try {
    return BigInt(trimmed);
  } catch {
    return null;
  }
}

function resolveExpectedChainId(raw: string | undefined): bigint {
  const parsed = parseEnvChainId(raw);
  if (parsed !== null) return parsed;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "NEXT_PUBLIC_EXPECTED_CHAIN_ID must be set in production (e.g. 1 for mainnet). " +
        "Refusing to default to Sepolia in a production build.",
    );
  }
  return DEFAULT_CHAIN_ID;
}

/** Public RPC URLs for wallet_addEthereumChain only; app reads can use Alchemy separately. */
export type ChainAddEthereumChainParameter = {
  chainId: string;
  chainName: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrls: string[];
  blockExplorerUrls?: string[];
};

export const CHAIN_METADATA: Readonly<Record<string, ChainAddEthereumChainParameter>> = {
  "1": {
    chainId: "0x1",
    chainName: "Ethereum Mainnet",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://eth.llamarpc.com"],
    blockExplorerUrls: ["https://etherscan.io"],
  },
  "11155111": {
    chainId: "0xaa36a7",
    chainName: "Ethereum Sepolia",
    nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://rpc.sepolia.org"],
    blockExplorerUrls: ["https://sepolia.etherscan.io"],
  },
};

export const expectedChainId: bigint = resolveExpectedChainId(
  process.env.NEXT_PUBLIC_EXPECTED_CHAIN_ID,
);

export const expectedChainIdHex: string = `0x${expectedChainId.toString(16)}`;

/**
 * Reads `NEXT_PUBLIC_EXPECTED_CHAIN_ID` at call time so guards (e.g.
 * deploy-broadcast checks) can be exercised in tests by mutating `process.env`.
 * In production, throws when the env var is missing rather than defaulting to
 * Sepolia.
 */
export function getExpectedChainId(): bigint {
  return resolveExpectedChainId(process.env.NEXT_PUBLIC_EXPECTED_CHAIN_ID);
}

function metadataForExpected(): ChainAddEthereumChainParameter {
  const key = expectedChainId.toString();
  const meta = CHAIN_METADATA[key];
  if (!meta) {
    return {
      chainId: expectedChainIdHex,
      chainName: `Chain ${key}`,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: [],
    };
  }
  return meta;
}

const _meta = metadataForExpected();

/** Human-readable name for UI (matches wallet_addEthereumChain chainName where defined). */
export const expectedNetworkName: string = _meta.chainName;

/** Friendly name for the wallet’s current chain when it isn’t the expected one. */
export function networkLabelForChainId(chainId: bigint): string {
  const key = chainId.toString();
  const meta = CHAIN_METADATA[key];
  return meta?.chainName ?? `Chain ${key}`;
}
