import { Contract, JsonRpcSigner, parseUnits } from "ethers";

export const CHAINLINK_AGGREGATOR_V3_ABI = [
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
] as const;

/** ETH (wei) so that PriceConverter-style USD value is at least `targetUsdHuman` (18-decimal USD on-chain). */
export async function weiForUsdContribution(
  signer: JsonRpcSigner,
  ethUsdFeed: string,
  targetUsdHuman: string,
): Promise<bigint> {
  const feed = new Contract(ethUsdFeed, CHAINLINK_AGGREGATOR_V3_ABI, signer);
  const round = await feed.latestRoundData();
  const answer = BigInt(round.answer as bigint);
  if (answer <= BigInt(0)) throw new Error("ETH/USD feed returned a non-positive price.");
  const ethPriceUsd18 = answer * BigInt(10) ** BigInt(10);
  const targetUsd18 = parseUnits(targetUsdHuman.trim(), 18);
  const wei = (targetUsd18 * BigInt(10) ** BigInt(18)) / ethPriceUsd18 + BigInt(1);
  return wei;
}
