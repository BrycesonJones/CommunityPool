import { Contract, JsonRpcProvider } from "ethers";
import { CHAINLINK_AGGREGATOR_V3_ABI } from "./price-math";

/**
 * Latest Chainlink USD price per 1 whole unit of the asset (e.g. 1 ETH, 1 WBTC)
 * for standard 8-decimal USD aggregator answers.
 */
export async function chainlinkUsdPerUnit(
  rpcUrl: string,
  feedAddress: string,
): Promise<number | null> {
  try {
    const provider = new JsonRpcProvider(rpcUrl);
    const feed = new Contract(feedAddress, CHAINLINK_AGGREGATOR_V3_ABI, provider);
    const round = await feed.latestRoundData();
    const ans = Number(round.answer);
    if (!Number.isFinite(ans) || ans <= 0) return null;
    return ans / 1e8;
  } catch {
    return null;
  }
}
