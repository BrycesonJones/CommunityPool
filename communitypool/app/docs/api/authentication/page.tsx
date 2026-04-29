import type { Metadata } from "next";
import { CodeBlock, Callout, DocsPage } from "@/components/docs-page";

export const metadata: Metadata = {
  title: "API Authentication",
  description:
    "Authenticate to the CommunityPool HTTP API with a Pro-tier API key.",
};

export default function ApiAuthenticationPage() {
  return (
    <DocsPage
      eyebrow="API (Pro)"
      title="Authentication"
      lead="All requests require a Pro API key passed in the Authorization header."
      next={{ label: "Rate limits", href: "/docs/api/rate-limits" }}
    >
      <h2>Bearer tokens</h2>
      <p>
        Pass the key in the <code>Authorization</code> header, prefixed
        with <code>Bearer</code>:
      </p>
      <CodeBlock lang="bash">{`curl https://api.communitypool.xyz/v1/pools \\
  -H "Authorization: Bearer cp_live_..."`}</CodeBlock>

      <h2>Key lifecycle</h2>
      <ul>
        <li>
          <strong>Create.</strong> Generate keys from <code>/api-keys</code>{" "}
          inside the dashboard. Each key shows exactly once on creation —
          copy it immediately.
        </li>
        <li>
          <strong>Revoke.</strong> Revoking a key takes effect immediately
          and cannot be undone. Rotate keys by creating a new one first,
          updating your integration, then revoking the old key.
        </li>
        <li>
          <strong>Scope.</strong> Keys inherit the permissions of the
          account that owns them. If the Pro subscription lapses, all keys
          owned by that account stop working until the subscription
          resumes.
        </li>
      </ul>

      <Callout tone="warn" title="Key hygiene">
        <p>
          Never commit keys to source control, never send them to a client-
          side bundle, and never expose them in a browser request. Rotate
          immediately if a key is exposed — assume it is compromised.
        </p>
      </Callout>

      <h2>Errors</h2>
      <ul>
        <li>
          <code>401 Unauthorized</code> — missing, malformed, or revoked
          key.
        </li>
        <li>
          <code>403 Forbidden</code> — key is valid but the requested
          resource is outside its scope (e.g., reading a pool the account
          is not a member of, if access is gated there).
        </li>
      </ul>
    </DocsPage>
  );
}
