import type { Metadata } from "next";
import Link from "next/link";
import { DocsPage } from "@/components/docs-page";

export const metadata: Metadata = {
  title: "Introduction",
  description:
    "CommunityPool is a non-custodial, USD-denominated funding pool on Ethereum. Learn what it is and how to get started.",
};

export default function IntroductionPage() {
  return (
    <DocsPage
      eyebrow="Overview"
      title="Introduction"
      lead="CommunityPool is a non-custodial funding pool on Ethereum. Deployers set a USD minimum contribution, funders send ETH or whitelisted ERC-20s, and owners withdraw before the pool expires."
      next={{ label: "Quickstart", href: "/docs/quickstart" }}
    >
      <h2>What it is</h2>
      <p>
        Each pool is its own smart contract. The deployer picks a name, a USD
        minimum contribution, co-owners, an expiry timestamp, and a set of
        whitelisted ERC-20 tokens. Chainlink price feeds translate incoming
        ETH and token amounts into USD at the time of contribution, so the
        minimum is enforced in dollars even though the funds themselves live
        on-chain.
      </p>

      <h2>What it is not</h2>
      <ul>
        <li>
          <strong>Not custodial.</strong> CommunityPool never holds funds on
          behalf of anyone. Funds sit in the pool contract until an owner
          withdraws or the pool expires.
        </li>
        <li>
          <strong>Not a token.</strong> There is no CommunityPool token, no
          presale, and no treasury.
        </li>
        <li>
          <strong>Not audited.</strong> The contract is open source.
          Review the source before committing funds to any deployment.
        </li>
      </ul>

      <h2>How the docs are organized</h2>
      <ul>
        <li>
          <Link href="/docs/quickstart">Quickstart</Link> — deploy, fund, and
          withdraw a pool end-to-end.
        </li>
        <li>
          <Link href="/docs/concepts/how-pools-work">Concepts</Link> — the
          mental model behind pools, USD pricing, and the lifecycle.
        </li>
        <li>
          <Link href="/docs/contracts">Smart contracts</Link> — function-by-
          function reference for <code>CommunityPool.sol</code>.
        </li>
        <li>
          <Link href="/docs/api">API</Link> — HTTP endpoints for Pro-tier
          integrations.
        </li>
      </ul>

      <h2>Where to go from here</h2>
      <p>
        New? Start with the{" "}
        <Link href="/docs/quickstart">Quickstart</Link>. Integrating on-chain?
        Jump to <Link href="/docs/contracts">CommunityPool.sol</Link>.
        Integrating over HTTP? See the{" "}
        <Link href="/docs/api">API overview</Link>.
      </p>
    </DocsPage>
  );
}
