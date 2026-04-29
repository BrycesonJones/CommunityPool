import type { Metadata } from "next";
import { CodeBlock, DocsPage } from "@/components/docs-page";

export const metadata: Metadata = {
  title: "API Rate limits",
  description: "Per-key rate limits for the CommunityPool HTTP API.",
};

export default function ApiRateLimitsPage() {
  return (
    <DocsPage
      eyebrow="API (Pro)"
      title="Rate limits"
      lead="Each API key has a per-minute request budget. Limits are published in the response headers."
      next={{ label: "Endpoints", href: "/docs/api/endpoints" }}
    >
      <h2>Default limits</h2>
      <p>
        Pro keys start at <strong>120 requests per minute</strong> per key,
        shared across all endpoints. Heavy indexing workloads should
        request a raise rather than running many keys in parallel.
      </p>

      <h2>Response headers</h2>
      <p>Every response includes:</p>
      <ul>
        <li>
          <code>X-RateLimit-Limit</code> — the per-minute budget for this
          key.
        </li>
        <li>
          <code>X-RateLimit-Remaining</code> — requests left in the current
          window.
        </li>
        <li>
          <code>X-RateLimit-Reset</code> — unix timestamp when the window
          resets.
        </li>
      </ul>

      <h2>When you hit the limit</h2>
      <p>
        The API returns <code>429 Too Many Requests</code> with a{" "}
        <code>Retry-After</code> header (seconds). Back off for at least
        that long before retrying.
      </p>
      <CodeBlock lang="http">{`HTTP/1.1 429 Too Many Requests
Retry-After: 12
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1713888000

{"error":{"code":"rate_limited","message":"Rate limit exceeded"}}`}</CodeBlock>

      <h2>Best practices</h2>
      <ul>
        <li>
          Cache pool metadata aggressively — it changes rarely. Pool
          balances change every block, event streams are append-only.
        </li>
        <li>
          Prefer webhooks over polling for event-driven workloads.
        </li>
        <li>
          Respect <code>Retry-After</code>. Tight-looping on 429s will
          compound the problem and may trigger abuse throttling.
        </li>
      </ul>
    </DocsPage>
  );
}
