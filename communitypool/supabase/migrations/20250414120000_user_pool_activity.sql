-- Per-user pool activity (deploy / fund / withdraw) with RLS.
-- Apply via Supabase SQL editor or `supabase db push`.

create table if not exists public.user_pool_activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  chain_id bigint not null,
  pool_address text not null,
  last_activity text not null check (last_activity in ('deploy', 'fund', 'withdraw')),
  last_tx_hashes text[] not null default '{}',
  expires_at_unix bigint not null,
  name text not null default '',
  description text not null default '',
  minimum_usd_wei text,
  total_usd_estimate numeric,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_pool_activity_user_chain_address_unique unique (user_id, chain_id, pool_address)
);

create index if not exists user_pool_activity_user_id_idx
  on public.user_pool_activity (user_id);

create index if not exists user_pool_activity_user_expires_idx
  on public.user_pool_activity (user_id, expires_at_unix desc);

alter table public.user_pool_activity enable row level security;

create policy "user_pool_activity_select_own"
  on public.user_pool_activity for select
  using (auth.uid() = user_id);

create policy "user_pool_activity_insert_own"
  on public.user_pool_activity for insert
  with check (auth.uid() = user_id);

create policy "user_pool_activity_update_own"
  on public.user_pool_activity for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "user_pool_activity_delete_own"
  on public.user_pool_activity for delete
  using (auth.uid() = user_id);
