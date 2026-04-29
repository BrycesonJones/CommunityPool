-- User-saved lookup snapshots (bookmark from workspace). RLS enforced.
-- Apply via Supabase SQL editor or `supabase db push`.

create table if not exists public.user_saved_lookups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  address_id text not null,
  onchain_snapshot jsonb,
  address_balance numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_saved_lookups_user_address_unique unique (user_id, address_id)
);

create index if not exists user_saved_lookups_user_created_idx
  on public.user_saved_lookups (user_id, created_at asc);

alter table public.user_saved_lookups enable row level security;

create policy "user_saved_lookups_select_own"
  on public.user_saved_lookups for select
  using (auth.uid() = user_id);

create policy "user_saved_lookups_insert_own"
  on public.user_saved_lookups for insert
  with check (auth.uid() = user_id);

create policy "user_saved_lookups_update_own"
  on public.user_saved_lookups for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "user_saved_lookups_delete_own"
  on public.user_saved_lookups for delete
  using (auth.uid() = user_id);
