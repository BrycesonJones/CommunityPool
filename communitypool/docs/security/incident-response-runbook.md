# CommunityPool Incident Response Runbook

This runbook defines how CommunityPool responds to security and reliability incidents for auth abuse and irreversible blockchain actions.

## Severity Levels

- **Critical**: active exploitation, secret leak, irreversible chain-state persistence failure.
- **High**: repeated abuse, provider outage impacting core flows.
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
- Critical: deploy confirmed but DB persistence failed.
- Critical: repeated non-owner withdrawal attempts.
- High: OTP verify failures spike.
- High: on-chain lookup abuse spike.
- High: provider/RPC failure spike.

## Secret Rotation Procedures

Never paste secret values into tickets, chat, commits, or logs.

- **Supabase**: rotate service-role and anon keys in Supabase dashboard, update host env vars, redeploy, invalidate affected sessions.
- **Google OAuth**: rotate client secret in Google Cloud Console, update host env vars, validate callback flow.
- **Upstash / RPC keys**: rotate token/API keys, update host env vars, verify rate-limit and RPC health checks.

## Containment Controls

- **Disable deployment temporarily**: block deploy UI action and reject deploy preflight route server-side.
- **Force refresh/re-auth**: invalidate sessions and prompt users to re-authenticate.

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

## Deploy Preflight Failure Investigation

1. Review `pool.deploy.eligibility_check_failed` events (the preflight only confirms the session and reads the deploy ledger; there is no plan or quota).
2. Confirm Supabase availability and `user_pool_deployments` read health.

## Provider/RPC Outage Response

1. Confirm outage via provider status and internal failure spikes.
2. Degrade non-critical reads first; protect write paths.
3. Update status page and incident channel.
4. Recover and backfill missed non-critical updates.

## Rollback Procedure

1. Pause deploy pipeline.
2. Roll back to last known-good release.
3. Re-run smoke tests for auth and pool flows.
4. Restore traffic progressively.

## User Communication Templates

- **Initial**: "We detected an incident affecting `<area>`. Funds remain on-chain. We are investigating and will provide updates every `<interval>`."
- **Recovery**: "Issue identified and mitigated. If your transaction was confirmed on-chain but missing in-app, contact support with chain id and tx hash."
- **Closure**: "Incident resolved. Root cause: `<summary>`. Controls added: `<summary>`."
