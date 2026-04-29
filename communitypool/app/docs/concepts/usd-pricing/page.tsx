import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock, Callout, DocsPage } from "@/components/docs-page";

export const metadata: Metadata = {
  title: "USD pricing & Chainlink",
  description:
    "How CommunityPool enforces a dollar-denominated minimum on-chain without holding stablecoins.",
};

export default function UsdPricingPage() {
  return (
    <DocsPage
      eyebrow="Concepts"
      title="USD pricing & Chainlink"
      lead="Pools take ETH and ERC-20s, but minimums are enforced in USD. Here is exactly how."
      next={{
        label: "Pool lifecycle",
        href: "/docs/concepts/pool-lifecycle",
      }}
    >
      <h2>Why USD, not ETH</h2>
      <p>
        Pricing a minimum in ETH means the floor moves with the market —
        a $5 minimum becomes $20 if ETH triples. Pricing in USD keeps the
        commitment stable even when the underlying asset swings.
      </p>

      <h2>The conversion path</h2>
      <p>
        When a funder calls <code>fund()</code> or{" "}
        <code>fundERC20()</code>, the contract reads the latest Chainlink
        price feed for the asset and converts the incoming amount to its
        USD equivalent. The conversion happens{" "}
        <strong>at the time of the transaction</strong>, using the feed
        snapshot at that block.
      </p>
      <CodeBlock lang="solidity">{`// Simplified — see PriceConverter.sol
function getConversionRate(uint256 ethAmount, AggregatorV3Interface feed)
    internal view returns (uint256 usdValue)
{
    (, int256 answer, , , ) = feed.latestRoundData();
    // Chainlink ETH/USD returns 8 decimals. Normalize to 18.
    uint256 ethPrice = uint256(answer) * 1e10;
    usdValue = (ethPrice * ethAmount) / 1e18;
}`}</CodeBlock>

      <h2>Which feeds are used</h2>
      <ul>
        <li>
          <strong>ETH/USD</strong> — a single Chainlink aggregator passed
          into the pool constructor. Immutable per pool.
        </li>
        <li>
          <strong>Each whitelisted ERC-20</strong> — paired with its own
          Chainlink aggregator and decimals at deploy time (e.g., WBTC/USD
          for WBTC contributions).
        </li>
      </ul>

      <h2>Input parity across the app</h2>
      <p>
        <strong>Deploy, fund, and withdraw all accept USD inputs.</strong>{" "}
        The UI handles the USD→asset conversion before signing. The chain
        enforces the USD minimum on submit, which means a long wait between
        quote and confirmation could land a transaction just above or just
        below the threshold if the asset price moves — the contract is the
        source of truth.
      </p>

      <Callout tone="info" title="Price freshness">
        <p>
          Chainlink feeds update on either a heartbeat interval or a
          deviation threshold. A pool always uses the latest answer the
          aggregator reports at the time of the transaction — there is no
          staleness check in the contract, so read freshness off the
          aggregator directly if you are building anything downstream.
        </p>
      </Callout>

      <h2>Edge cases</h2>
      <ul>
        <li>
          <strong>Feed outages.</strong> If a Chainlink feed stops updating,
          contributions continue to price against the last answer until the
          aggregator recovers.
        </li>
        <li>
          <strong>Decimals mismatch.</strong> ERC-20 token decimals are
          captured at deploy and used to scale the feed answer. If the
          wrong decimals are passed in, the minimum check will be off by an
          order of magnitude. This is why token configs are immutable.
        </li>
      </ul>

      <h2>Related</h2>
      <ul>
        <li>
          <Link href="/docs/contracts">
            Smart-contract reference → <code>PriceConverter</code>
          </Link>
        </li>
      </ul>
    </DocsPage>
  );
}
