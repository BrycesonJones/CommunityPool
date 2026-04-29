import { createAlchemyEvmAdapter } from "./providers/alchemy-evm";
import { createEtherscanEvmAdapter } from "./providers/etherscan-evm";
import { defaultRpcUrlForNetwork } from "./networks";
import type { ProviderAdapter } from "./providers/provider-adapter";

/**
 * When `ALCHEMY_API_KEY` is set, default to Alchemy (faster for typical lookups).
 * Set `EVM_LOOKUP_PROVIDER=etherscan` to force Etherscan when both keys exist.
 * Set `EVM_LOOKUP_PROVIDER=alchemy` to force Alchemy explicitly.
 */
export function createEvmLookupAdapter(args: {
  alchemyKey: string;
  etherscanKey: string;
}): ProviderAdapter {
  const { alchemyKey, etherscanKey } = args;
  const rpcUrlForNetwork = (id: string) => defaultRpcUrlForNetwork(id, alchemyKey);
  const prefer = process.env.EVM_LOOKUP_PROVIDER?.trim().toLowerCase();

  if (prefer === "etherscan" && etherscanKey) {
    return createEtherscanEvmAdapter({ apiKey: etherscanKey, rpcUrlForNetwork });
  }
  if (prefer === "alchemy" && alchemyKey) {
    return createAlchemyEvmAdapter({ apiKey: alchemyKey, rpcUrlForNetwork });
  }
  if (alchemyKey) {
    return createAlchemyEvmAdapter({ apiKey: alchemyKey, rpcUrlForNetwork });
  }
  if (etherscanKey) {
    return createEtherscanEvmAdapter({ apiKey: etherscanKey, rpcUrlForNetwork });
  }
  return createAlchemyEvmAdapter({ apiKey: "", rpcUrlForNetwork });
}
