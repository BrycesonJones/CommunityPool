import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock, Callout, DocsPage } from "@/components/docs-page";

export const metadata: Metadata = {
  title: "API Endpoints",
  description:
    "Resource-by-resource reference for the CommunityPool Pro API.",
};

export default function ApiEndpointsPage() {
  return (
    <DocsPage
      eyebrow="API (Pro)"
      title="Endpoints"
      lead="Read-only resources for pools, funders, and on-chain events. All responses are JSON; all amounts are returned in base units (wei / token-decimals) and USD-normalized where noted."
    >
      <Callout tone="warn" title="In development">
        <p>
          The endpoint list below is the shipping shape. Paths and
          payloads are stable intent, but may shift during the Pro launch.
        </p>
      </Callout>

      <h2>Pools</h2>

      <h3>
        <code>GET /v1/pools</code>
      </h3>
      <p>
        List pools the authenticated account can see (pools it owns, co-
        owns, or has funded). Paginated by <code>cursor</code>.
      </p>
      <CodeBlock lang="bash">{`curl "https://api.communitypool.xyz/v1/pools?limit=20" \\
  -H "Authorization: Bearer cp_live_..."`}</CodeBlock>

      <h3>
        <code>GET /v1/pools/:address</code>
      </h3>
      <p>
        Fetch a single pool by its contract address. Returns name,
        description, minimum USD, expiry, owners, whitelisted tokens, and
        current balances.
      </p>

      <h2>Funders</h2>

      <h3>
        <code>GET /v1/pools/:address/funders</code>
      </h3>
      <p>
        List addresses that have contributed to the pool, with their total
        contributions per asset (ETH + each whitelisted token) and the USD
        value at contribution time.
      </p>
      <p>
        Note: after a full withdraw or expiry release, on-chain per-funder
        records reset to zero. This endpoint preserves the historical
        totals by indexing <code>Funded</code> and <code>FundedERC20</code>{" "}
        events, so you can still attribute contributions after release.
      </p>

      <h2>Events</h2>

      <h3>
        <code>GET /v1/pools/:address/events</code>
      </h3>
      <p>
        Append-only event stream for a pool:{" "}
        <code>PoolCreated</code>, <code>Funded</code>,{" "}
        <code>FundedERC20</code>, <code>Withdrawn</code>,{" "}
        <code>WithdrawnToken</code>. Paginated by cursor, newest first.
      </p>

      <h2>Error shape</h2>
      <CodeBlock lang="json">{`{
  "error": {
    "code": "pool_not_found",
    "message": "No pool with that address",
    "traceId": "01HXYZ..."
  }
}`}</CodeBlock>
      <p>
        <code>traceId</code> is useful when asking support to look into an
        issue — include it in your bug report.
      </p>

      <h2>Webhooks (planned)</h2>
      <p>
        Webhooks for <code>Funded</code>, <code>Withdrawn</code>, and{" "}
        <code>PoolExpired</code> events are planned for after the initial
        read-only API ships. They will mirror the event payloads above.
        See the <Link href="/docs/changelog">changelog</Link>.
      </p>
    </DocsPage>
  );
}
