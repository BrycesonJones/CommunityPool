import "server-only";
import { JsonRpcProvider } from "ethers";

/**
 * Server-only RPC providers for chain reads that happen from API routes.
 *
 * Unlike the client, the server has access to the app's Alchemy credentials
 * and can run reliable `eth_call` / `eth_getBalance` requests for Open Pools
 * reconciliation regardless of the user's wallet state.
 *
 * Resolution order per chain:
 *   1. `ALCHEMY_API_URL_ETH_<network>` (explicit full URL)
 *   2. `ALCHEMY_API_KEY` combined with the Alchemy base URL for that network
 *   3. Local Anvil via `LOCAL_ANVIL_RPC_URL` for chain 31337 (dev only)
 *
 * Returns `null` when nothing is configured; the caller returns 503 so the
 * client can fall back to the wallet provider or the public RPC.
 */
export function getServerReadOnlyProviderForChain(
  chainId: number,
): JsonRpcProvider | null {
  const alchemyKey = process.env.ALCHEMY_API_KEY?.trim() ?? "";

  if (chainId === 1) {
    // Aliases: support both the `ALCHEMY_API_URL_ETH_*` naming used in
    // `lib/onchain/networks.ts` and the `ALCHEMY_ETHMAINNET_ENDPOINT_URL`
    // variant that ships in our local example / legacy env files.
    const explicit =
      process.env.ALCHEMY_API_URL_ETH_MAINNET?.trim() ||
      process.env.ALCHEMY_ETHMAINNET_ENDPOINT_URL?.trim();
    if (explicit) return new JsonRpcProvider(explicit);
    if (alchemyKey) {
      return new JsonRpcProvider(
        `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`,
      );
    }
    return null;
  }

  if (chainId === 11155111) {
    const explicit =
      process.env.ALCHEMY_API_URL_ETH_SEPOLIA?.trim() ||
      process.env.ALCHEMY_ETHSEPOLIA_ENDPOINT_URL?.trim();
    if (explicit) return new JsonRpcProvider(explicit);
    if (alchemyKey) {
      return new JsonRpcProvider(
        `https://eth-sepolia.g.alchemy.com/v2/${alchemyKey}`,
      );
    }
    return null;
  }

  if (chainId === 31337) {
    const local = process.env.LOCAL_ANVIL_RPC_URL?.trim();
    if (local) return new JsonRpcProvider(local);
    return null;
  }

  return null;
}
