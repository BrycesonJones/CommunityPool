-- Assert RLS state for user_address_balances. The table itself was created
-- out-of-band (Supabase Studio) before this repo started tracking migrations;
-- only ALTER migrations exist for it. Its RLS policy state was therefore not
-- reproducible from the repo. This migration enables RLS and recreates the
-- four CRUD policies idempotently so the state is captured in source.
--
-- All rows in this table are per-user lookup snapshots keyed on user_id, so
-- access is restricted to the row owner.

alter table public.user_address_balances enable row level security;

drop policy if exists "user_address_balances_select_own"
  on public.user_address_balances;
drop policy if exists "user_address_balances_insert_own"
  on public.user_address_balances;
drop policy if exists "user_address_balances_update_own"
  on public.user_address_balances;
drop policy if exists "user_address_balances_delete_own"
  on public.user_address_balances;

create policy "user_address_balances_select_own"
  on public.user_address_balances for select
  using (auth.uid() = user_id);

create policy "user_address_balances_insert_own"
  on public.user_address_balances for insert
  with check (auth.uid() = user_id);

create policy "user_address_balances_update_own"
  on public.user_address_balances for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "user_address_balances_delete_own"
  on public.user_address_balances for delete
  using (auth.uid() = user_id);
