import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocsPage } from "@/components/docs-page";

export const metadata: Metadata = {
  title: "API overview",
  description:
    "Pro-tier HTTP API for CommunityPool — read pool metadata, funders, and event streams from outside the dApp.",
};

export default function ApiOverviewPage() {
  return (
    <DocsPage
      eyebrow="API (Pro)"
      title="API overview"
      lead="A read-only HTTP API for Pro subscribers. Use it to index pools, power dashboards, or build integrations without running your own RPC."
      next={{
        label: "Authentication",
        href: "/docs/api/authentication",
      }}
    >
      <Callout tone="warn" title="In development">
        <p>
          The HTTP API is being built alongside the Pro tier. These docs
          describe the shape it will ship with. Endpoint paths, payloads,
          and rate limits may change before general availability. Follow
          the <Link href="/docs/changelog">changelog</Link> for updates.
        </p>
      </Callout>

      <h2>What the API is for</h2>
      <p>
        The on-chain contract is already a public API — anyone with an RPC
        endpoint can read pool state. The HTTP API exists to save you from
        running that infrastructure: indexed queries, aggregated stats,
        pagination over funders and events, and a single webhook feed per
        key.
      </p>

      <h2>What it is not</h2>
      <ul>
        <li>
          <strong>Not a transaction relayer.</strong> Funding and
          withdrawing still happen on-chain, signed by the user&apos;s
          wallet. The API never takes custody and never signs. To deploy,
          fund, or withdraw, use the app —{" "}
          <Link href="/docs/quickstart">the quickstart</Link> walks through
          each flow (including how to get Sepolia test ETH).
        </li>
        <li>
          <strong>Not a free tier.</strong> Keys require a Pro subscription.
          See <Link href="/pricing">pricing</Link>.
        </li>
      </ul>

      <h2>Base URL</h2>
      <p>
        All requests are served from a single base URL (TBD — will be{" "}
        <code>api.communitypool.xyz</code> or similar). Versioning is
        path-based: <code>/v1/</code>.
      </p>

      <h2>Quick reference</h2>
      <ul>
        <li>
          <Link href="/docs/api/authentication">Authentication</Link> — API
          keys via <code>Authorization: Bearer</code>.
        </li>
        <li>
          <Link href="/docs/api/rate-limits">Rate limits</Link> — per-key
          quotas and how to read the response headers.
        </li>
        <li>
          <Link href="/docs/api/endpoints">Endpoints</Link> — the full
          resource list.
        </li>
      </ul>

      <h2>Creating a key</h2>
      <p>
        Pro subscribers create keys from <code>/api-keys</code> inside
        the dashboard. The page lists existing keys and exposes two
        actions: <strong>View API docs</strong> (sends you back here) and{" "}
        <strong>Create API key</strong>. A newly created key is shown
        exactly once — store it somewhere safe before dismissing the
        dialog.
      </p>
    </DocsPage>
  );
}
