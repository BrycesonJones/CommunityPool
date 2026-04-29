import "server-only";
import { DEFAULT_EVM_NETWORKS, ONCHAIN_CACHE_TTL_SECONDS } from "./constants";

export { DEFAULT_EVM_NETWORKS, ONCHAIN_CACHE_TTL_SECONDS };

export type SupportedEvmNetworkId = (typeof DEFAULT_EVM_NETWORKS)[number];

/** Extend this list and RPC map when adding EVM chains. */
export const SUPPORTED_EVM_NETWORK_IDS: readonly string[] = DEFAULT_EVM_NETWORKS;

/** Etherscan API v2 `chainid` for supported app network ids. */
export function etherscanChainIdForNetwork(networkId: string): number | undefined {
  if (networkId === "eth-mainnet") return 1;
  if (networkId === "eth-sepolia") return 11155111;
  return undefined;
}

export function chainIdBigIntForEvmNetwork(networkId: string): bigint | undefined {
  const n = etherscanChainIdForNetwork(networkId);
  return n === undefined ? undefined : BigInt(n);
}

export function defaultRpcUrlForNetwork(
  networkId: string,
  apiKey: string,
): string | undefined {
  const envMainnet = process.env.ALCHEMY_API_URL_ETH_MAINNET;
  const envSepolia = process.env.ALCHEMY_API_URL_ETH_SEPOLIA;

  if (networkId === "eth-mainnet") {
    return (
      envMainnet ??
      (apiKey ? `https://eth-mainnet.g.alchemy.com/v2/${apiKey}` : undefined)
    );
  }
  if (networkId === "eth-sepolia") {
    return (
      envSepolia ??
      (apiKey ? `https://eth-sepolia.g.alchemy.com/v2/${apiKey}` : undefined)
    );
  }
  return undefined;
}
