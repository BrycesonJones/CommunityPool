# CommunityPool Incident Response Runbook

This runbook defines how CommunityPool responds to security and reliability incidents for auth abuse, billing, and irreversible blockchain actions.

## Severity Levels

- **Critical**: active exploitation, secret leak, billing integrity risk, irreversible chain-state persistence failure.
- **High**: repeated abuse, Stripe anomaly, provider outage impacting core flows.
- **Medium**: isolated failures with bounded impact, no evidence of exploitation.
- **Low**: informational, no immediate customer impact.

## Alert Destinations and Ownership

- **Primary on-call**: product/security owner.
- **Critical/High destination**: paging channel + incident Slack channel.
- **Medium destination**: engineering Slack + dashboard queue.
- **Low destination**: backlog triage.

## Required Before Mainnet Alerts

- Critical: bundle secret scan failed.
- Critical: production missing Upstash backend.
- Critical: Stripe webhook signature failures spike.
- Critical: Stripe metadata/customer mismatch.
- Critical: deploy confirmed but DB persistence failed.
- Critical: repeated non-owner withdrawal attempts.
- High: Free/Pro quota bypass attempt.
- High: OTP verify failures spike.
- High: on-chain lookup abuse spike.
- High: provider/RPC failure spike.
- High: checkout/portal creation failures spike.

## Secret Rotation Procedures

Never paste secret values into tickets, chat, commits, or logs.

- **Supabase**: rotate service-role and anon keys in Supabase dashboard, update host env vars, redeploy, invalidate affected sessions.
- **Stripe**: rotate secret key and webhook signing secret in Stripe dashboard, update host env vars, verify webhook health.
- **Google OAuth**: rotate client secret in Google Cloud Console, update host env vars, validate callback flow.
- **Upstash / RPC keys**: rotate token/API keys, update host env vars, verify rate-limit and RPC health checks.

## Containment Controls

- **Disable checkout temporarily**: disable pricing checkout CTA and block `/api/stripe/create-checkout-session`.
- **Disable deployment temporarily**: block deploy UI action and reject deploy preflight route server-side.
- **Force refresh/re-auth**: invalidate sessions and prompt users to re-authenticate.

## Stripe Reconciliation

1. Verify webhook endpoint health and retry backlog in Stripe dashboard.
2. Inspect `stripe_processed_events` decisions for duplicates/stale/failed.
3. Reconcile `user_billing_state` against Stripe subscription source of truth.
4. Reprocess safe failed events if needed.

## Orphaned Pool Recovery

Use when on-chain tx confirmed but app persistence failed.

1. Collect chain id, pool address, tx hash from user report.
2. Verify confirmation in explorer.
3. Restore pool activity / owner mapping records.
4. Mark incident resolved and keep audit event trail.

## Suspicious Withdrawal Investigation

1. Pull `pool.withdraw.*` events for wallet/pool/user hash.
2. Verify owner check outcomes and tx confirmations.
3. Check repeated non-owner attempts and source patterns.
4. Escalate to Critical if active abuse persists.

## Free/Pro Quota Bypass Investigation

1. Review `pool.deploy.eligibility_check_failed` and quota-related events.
2. Compare Stripe billing state and deploy counts.
3. Validate no unauthorized plan escalation path was used.

## Provider/RPC Outage Response

1. Confirm outage via provider status and internal failure spikes.
2. Degrade non-critical reads first; protect write paths.
3. Update status page and incident channel.
4. Recover and backfill missed non-critical updates.

## Rollback Procedure

1. Pause deploy pipeline.
2. Roll back to last known-good release.
3. Re-run smoke tests for auth, Stripe webhooks, and pool flows.
4. Restore traffic progressively.

## User Communication Templates

- **Initial**: "We detected an incident affecting `<area>`. Funds remain on-chain. We are investigating and will provide updates every `<interval>`."
- **Recovery**: "Issue identified and mitigated. If your transaction was confirmed on-chain but missing in-app, contact support with chain id and tx hash."
- **Closure**: "Incident resolved. Root cause: `<summary>`. Controls added: `<summary>`."
