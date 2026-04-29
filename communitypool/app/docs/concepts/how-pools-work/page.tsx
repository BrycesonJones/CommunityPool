import type { Metadata } from "next";
import Link from "next/link";
import { DocsPage } from "@/components/docs-page";

export const metadata: Metadata = {
  title: "How pools work",
  description:
    "Each CommunityPool is its own smart contract. Learn the actors, storage layout, and guarantees.",
};

export default function HowPoolsWorkPage() {
  return (
    <DocsPage
      eyebrow="Concepts"
      title="How pools work"
      lead="Each pool is its own smart contract. No shared treasury, no proxy upgrades — just an immutable contract per fundraise."
      next={{
        label: "USD pricing & Chainlink",
        href: "/docs/concepts/usd-pricing",
      }}
    >
      <h2>Three roles</h2>
      <ul>
        <li>
          <strong>Deployer</strong> — the address that called the
          constructor. Immutable. Receives remaining funds after expiry.
        </li>
        <li>
          <strong>Owners</strong> — the deployer plus any co-owners passed
          into the constructor. Any owner may withdraw before expiry.
        </li>
        <li>
          <strong>Funders</strong> — anyone who sends ETH or a whitelisted
          ERC-20. Their contributions are tracked per-address.
        </li>
      </ul>

      <h2>Per-pool state</h2>
      <p>
        Each pool contract stores its own name, description, USD minimum,
        expiry, co-owner set, ETH/ERC-20 balances, and per-funder totals.
        Because every pool is a separate contract, pools are fully isolated:
        a bug, exploit, or stuck state in one pool cannot affect another.
      </p>

      <h2>Immutable parameters</h2>
      <p>
        The following are fixed at deploy time and cannot be changed:
      </p>
      <ul>
        <li>Deployer address</li>
        <li>USD minimum contribution</li>
        <li>Expiry timestamp</li>
        <li>ETH/USD Chainlink feed</li>
        <li>Co-owner set</li>
        <li>Whitelisted tokens and their USD feeds</li>
      </ul>
      <p>
        This is deliberate. A pool&apos;s rules should not change after
        funders commit. If you need different parameters, deploy a new pool.
      </p>

      <h2>Funds flow</h2>
      <ol>
        <li>Funders send ETH or approved ERC-20s to the pool contract.</li>
        <li>
          The contract checks the Chainlink-priced USD value against the
          minimum. Below-minimum contributions revert.
        </li>
        <li>
          Owners may withdraw (partial or full) at any time before{" "}
          <code>expiresAt</code>.
        </li>
        <li>
          After <code>expiresAt</code>, owner withdraws are disabled. Anyone
          can call <code>releaseExpiredFundsToDeployer</code> to sweep the
          remaining balance back to the deployer.
        </li>
      </ol>

      <h2>Why every pool is a new contract</h2>
      <p>
        Sharing state across fundraises would mean a shared admin, shared
        upgrade risk, and shared blast radius. An immutable one-contract-per-
        pool model keeps trust assumptions small: funders only need to audit
        the bytecode they are sending money to, and the deployer cannot
        retroactively change the rules.
      </p>

      <h2>Related</h2>
      <ul>
        <li>
          <Link href="/docs/concepts/usd-pricing">
            USD pricing & Chainlink feeds
          </Link>{" "}
          — how dollar amounts are enforced on-chain.
        </li>
        <li>
          <Link href="/docs/concepts/pool-lifecycle">Pool lifecycle</Link> —
          funding, withdraws, expiry, and release.
        </li>
      </ul>
    </DocsPage>
  );
}
