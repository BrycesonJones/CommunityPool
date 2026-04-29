-- OWASP A08 F-02: the Free-tier deploy gate counts pools by reading
-- user_pool_activity, but that table is fully writable by the row owner via
-- RLS. A Free user could DELETE their own rows to reset the count and
-- bypass the FREE_POOL_LIMIT enforcement in lib/pools/deploy-eligibility.ts.
--
-- The fix is a service-role-only deployment ledger. A row is written here
-- only by the /api/pools/record-deployment route, which verifies the deploy
-- transaction receipt on chain (tx exists, tx succeeded, the receipt's
-- contractAddress matches the pool address, and the pool address has
-- bytecode on the expected chain) before inserting.
--
-- Trust model:
--   - Authenticated users can SELECT their own rows (so the eligibility
--     helper can count them).
--   - Authenticated users CANNOT INSERT/UPDATE/DELETE — RLS denies by
--     default with no policies for those verbs.
--   - The service-role admin client bypasses RLS for the verified insert.
--
-- Idempotency:
--   - PRIMARY KEY ensures one ledger row per id (server-generated).
--   - UNIQUE (chain_id, pool_address) collapses re-records of the same
--     contract to a single row — the second call returns the existing row
--     instead of creating a duplicate.
--   - UNIQUE (chain_id, deploy_tx_hash) collapses re-records of the same
--     deploy transaction (defence in depth against partial-state retries).
--
-- Counting rules (enforced in lib/pools/deploy-eligibility.ts after this):
--   - deployed-but-funding-failed pools count (pool exists on chain).
--   - failed deploys with no contractAddress never reach this table.

create table if not exists public.user_pool_deployments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  chain_id bigint not null,
  pool_address text not null,
  deploy_tx_hash text not null,
  deployment_status text not null default 'deployed',
  funding_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chain_id, pool_address),
  unique (chain_id, deploy_tx_hash),
  constraint user_pool_deployments_pool_address_format
    check (pool_address ~ '^0x[a-fA-F0-9]{40}$'),
  constraint user_pool_deployments_deploy_tx_hash_format
    check (deploy_tx_hash ~ '^0x[a-fA-F0-9]{64}$'),
  constraint user_pool_deployments_deployment_status_allowed
    check (deployment_status in ('deployed')),
  constraint user_pool_deployments_funding_status_allowed
    check (funding_status is null or funding_status in ('funded', 'funding_failed'))
);

create index if not exists user_pool_deployments_user_chain_idx
  on public.user_pool_deployments (user_id, chain_id);

alter table public.user_pool_deployments enable row level security;

-- Read-own only. No INSERT/UPDATE/DELETE policies — RLS denies by default,
-- so all writes must go through the service-role admin client used by
-- /api/pools/record-deployment.
drop policy if exists "user_pool_deployments_select_own"
  on public.user_pool_deployments;
create policy "user_pool_deployments_select_own"
  on public.user_pool_deployments for select
  using (auth.uid() = user_id);

-- Defence-in-depth: drop any policies a hand-edit may have added.
drop policy if exists "user_pool_deployments_insert_own"
  on public.user_pool_deployments;
drop policy if exists "user_pool_deployments_update_own"
  on public.user_pool_deployments;
drop policy if exists "user_pool_deployments_delete_own"
  on public.user_pool_deployments;
