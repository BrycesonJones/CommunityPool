-- Canonical pool + owner registry used for app-side withdraw authorization.
-- This is separate from user_pool_activity (which tracks per-user activity feed
-- rows) so ownership can be queried independently of who last interacted.

create table if not exists public.community_pools (
  id uuid primary key default gen_random_uuid(),
  chain_id bigint not null,
  pool_address text not null,
  name text not null default '',
  description text not null default '',
  expires_at_unix bigint not null,
  deployer_address text not null,
  deployer_user_id uuid references auth.users (id) on delete set null,
  created_by_user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint community_pools_chain_address_unique unique (chain_id, pool_address)
);

create index if not exists community_pools_chain_pool_idx
  on public.community_pools (chain_id, pool_address);

create table if not exists public.community_pool_owners (
  id uuid primary key default gen_random_uuid(),
  chain_id bigint not null,
  pool_address text not null,
  owner_address text not null,
  owner_user_id uuid references auth.users (id) on delete set null,
  added_by_user_id uuid not null references auth.users (id) on delete cascade,
  is_deployer boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint community_pool_owners_unique unique (chain_id, pool_address, owner_address),
  constraint community_pool_owners_pool_fk
    foreign key (chain_id, pool_address)
    references public.community_pools (chain_id, pool_address)
    on delete cascade
);

create index if not exists community_pool_owners_lookup_idx
  on public.community_pool_owners (chain_id, pool_address, owner_address);

alter table public.community_pools enable row level security;
alter table public.community_pool_owners enable row level security;

create policy "community_pools_select_authenticated"
  on public.community_pools for select
  using (auth.role() = 'authenticated');

create policy "community_pools_insert_creator"
  on public.community_pools for insert
  with check (auth.uid() = created_by_user_id);

create policy "community_pools_update_creator"
  on public.community_pools for update
  using (auth.uid() = created_by_user_id)
  with check (auth.uid() = created_by_user_id);

create policy "community_pools_delete_creator"
  on public.community_pools for delete
  using (auth.uid() = created_by_user_id);

create policy "community_pool_owners_select_authenticated"
  on public.community_pool_owners for select
  using (auth.role() = 'authenticated');

create policy "community_pool_owners_insert_adder"
  on public.community_pool_owners for insert
  with check (auth.uid() = added_by_user_id);

create policy "community_pool_owners_update_adder"
  on public.community_pool_owners for update
  using (auth.uid() = added_by_user_id)
  with check (auth.uid() = added_by_user_id);

create policy "community_pool_owners_delete_adder"
  on public.community_pool_owners for delete
  using (auth.uid() = added_by_user_id);
