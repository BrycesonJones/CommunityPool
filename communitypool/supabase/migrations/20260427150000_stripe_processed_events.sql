-- OWASP A08 F-05: Stripe webhook processed-events ledger.
--
-- Purpose:
--   Stripe retries events for up to 3 days and ordering is best-effort.
--   Without an event-id ledger, a duplicated or replayed event would
--   re-mutate billing state, and there would be no audit trail. This
--   table stores one row per (event_id) so duplicates are detected at
--   the PRIMARY KEY layer and the handler can return 200 immediately.
--
-- Workflow (see app/api/stripe/webhook/route.ts):
--   1. After signature verification, INSERT a row with decision='processing'.
--      A primary-key conflict (SQLSTATE 23505) means we've seen this
--      event before — handler returns 200 with `duplicate: true`.
--   2. Out-of-order check: compare event.created against the most recent
--      stored event for the same customer/subscription hash; if older,
--      mark decision='stale_ignored' and return 200.
--   3. Process the event normally; on success mark decision='processed'.
--      On a metadata mismatch or user-mapping failure, mark
--      decision='failed' so operators can audit.
--
-- RLS:
--   No policies are created. RLS is enabled, so the authenticated/anon
--   roles are denied by default — only the service-role key (used in
--   lib/supabase/admin.ts) bypasses RLS and can read/write this table.
--
-- The hashed identifier columns hold short SHA-256 prefixes (see
-- lib/security/security-event.ts → hashIdentifier) — not raw Stripe ids
-- — so log readers and DB operators can correlate events without seeing
-- the raw customer/subscription handles.

create table if not exists public.stripe_processed_events (
  event_id text primary key,
  event_type text not null,
  event_created bigint not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  decision text not null
    check (decision in ('processing', 'processed', 'duplicate_ignored', 'stale_ignored', 'failed')),
  reason text,
  stripe_customer_id_hash text,
  stripe_subscription_id_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists stripe_processed_events_created_idx
  on public.stripe_processed_events (event_created desc);

create index if not exists stripe_processed_events_decision_idx
  on public.stripe_processed_events (decision, updated_at desc);

create index if not exists stripe_processed_events_subscription_hash_idx
  on public.stripe_processed_events (stripe_subscription_id_hash, event_created desc)
  where stripe_subscription_id_hash is not null;

create index if not exists stripe_processed_events_customer_hash_idx
  on public.stripe_processed_events (stripe_customer_id_hash, event_created desc)
  where stripe_customer_id_hash is not null;

alter table public.stripe_processed_events enable row level security;

-- Defence-in-depth: drop any prior policies if a hand-edit ever added them,
-- then create none. RLS-enabled with zero policies = deny-by-default for
-- the authenticated/anon roles. Only service-role bypasses.
drop policy if exists "stripe_processed_events_select_authenticated"
  on public.stripe_processed_events;
drop policy if exists "stripe_processed_events_select_own"
  on public.stripe_processed_events;
drop policy if exists "stripe_processed_events_insert_any"
  on public.stripe_processed_events;
drop policy if exists "stripe_processed_events_update_any"
  on public.stripe_processed_events;
drop policy if exists "stripe_processed_events_delete_any"
  on public.stripe_processed_events;
