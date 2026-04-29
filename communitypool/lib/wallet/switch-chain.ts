import {
  CHAIN_METADATA,
  expectedChainId,
  expectedChainIdHex,
  type ChainAddEthereumChainParameter,
} from "./expected-chain";
import { getProviderErrorCode, messageForProviderError } from "./metamask-errors";
import type { Eip1193Provider } from "./types";

const CHAIN_NOT_ADDED_CODE = 4902;

function addChainParamsForExpected(): ChainAddEthereumChainParameter {
  const meta = CHAIN_METADATA[expectedChainId.toString()];
  if (meta) return meta;
  return {
    chainId: expectedChainIdHex,
    chainName: `Chain ${expectedChainId.toString()}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: [],
  };
}

/**
 * Prompts MetaMask to switch to the app’s expected chain; adds the chain if missing (4902).
 */
export async function switchToExpectedChain(
  eip1193: Eip1193Provider,
): Promise<void> {
  try {
    await eip1193.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: expectedChainIdHex }],
    });
  } catch (e) {
    const code = getProviderErrorCode(e);
    if (code === CHAIN_NOT_ADDED_CODE) {
      const params = addChainParamsForExpected();
      if (!params.rpcUrls.length) {
        throw new Error(
          "This chain is not in the built-in list and has no RPC URLs configured.",
        );
      }
      await eip1193.request({
        method: "wallet_addEthereumChain",
        params: [params],
      });
      return;
    }
    throw new Error(messageForProviderError(e));
  }
}
