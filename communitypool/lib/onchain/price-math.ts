import {
  Contract,
  type BrowserProvider,
  type ContractRunner,
  type JsonRpcProvider,
  type JsonRpcSigner,
  parseUnits,
} from "ethers";

export const CHAINLINK_AGGREGATOR_V3_ABI = [
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
] as const;

export type SignerOrProvider = JsonRpcSigner | BrowserProvider | JsonRpcProvider;

/**
 * The runner to use for a read-only contract call.
 *
 * Reads must go through the provider, never the signer. A signer runner makes ethers populate the
 * call before sending it, so the wallet receives `eth_call {from, to, data}` instead of the plain
 * `eth_call {to, data}` a view needs — it drags account/signing context into an operation that
 * requires no authority, and it fails in wallet environments where the plain call succeeds. A
 * Chainlink `latestRoundData()` or a `protocolFeeBps()` view has no caller.
 */
export function readerFor(runner: SignerOrProvider): ContractRunner {
  const maybeProvider = (runner as JsonRpcSigner).provider;
  return maybeProvider ?? (runner as ContractRunner);
}

/** ETH (wei) so that PriceConverter-style USD value is at least `targetUsdHuman` (18-decimal USD on-chain). */
export async function weiForUsdContribution(
  signerOrProvider: SignerOrProvider,
  ethUsdFeed: string,
  targetUsdHuman: string,
): Promise<bigint> {
  const feed = new Contract(ethUsdFeed, CHAINLINK_AGGREGATOR_V3_ABI, readerFor(signerOrProvider));
  const round = await feed.latestRoundData();
  const answer = BigInt(round.answer as bigint);
  if (answer <= BigInt(0)) throw new Error("ETH/USD feed returned a non-positive price.");
  const ethPriceUsd18 = answer * BigInt(10) ** BigInt(10);
  const targetUsd18 = parseUnits(targetUsdHuman.trim(), 18);
  const wei = (targetUsd18 * BigInt(10) ** BigInt(18)) / ethPriceUsd18 + BigInt(1);
  return wei;
}
