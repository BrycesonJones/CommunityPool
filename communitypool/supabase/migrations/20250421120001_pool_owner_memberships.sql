-- Persisted pool owner mapping used by app-side withdraw authorization.
-- One row per (chain, pool, owner_address), including deployer + co-owners.

create table if not exists public.pool_owner_memberships (
  id uuid primary key default gen_random_uuid(),
  chain_id bigint not null,
  pool_address text not null,
  owner_address text not null,
  is_deployer boolean not null default false,
  created_by_user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pool_owner_memberships_chain_pool_owner_unique unique (chain_id, pool_address, owner_address)
);

create index if not exists pool_owner_memberships_owner_idx
  on public.pool_owner_memberships (owner_address, chain_id);

create index if not exists pool_owner_memberships_pool_idx
  on public.pool_owner_memberships (chain_id, pool_address);

alter table public.pool_owner_memberships enable row level security;

-- Ownership rows are not sensitive and are needed by all authenticated users
-- to determine whether their connected wallet can withdraw.
create policy "pool_owner_memberships_select_authenticated"
  on public.pool_owner_memberships for select
  using (auth.role() = 'authenticated');

create policy "pool_owner_memberships_insert_creator"
  on public.pool_owner_memberships for insert
  with check (auth.uid() = created_by_user_id);

create policy "pool_owner_memberships_update_creator"
  on public.pool_owner_memberships for update
  using (auth.uid() = created_by_user_id)
  with check (auth.uid() = created_by_user_id);

create policy "pool_owner_memberships_delete_creator"
  on public.pool_owner_memberships for delete
  using (auth.uid() = created_by_user_id);
