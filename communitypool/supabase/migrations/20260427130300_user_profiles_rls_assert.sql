-- Assert RLS state for user_profiles. The table itself was created out-of-band
-- (Supabase Studio); the KYC migration (20250425120000_user_profiles_kyc.sql)
-- already enables RLS and creates SELECT/INSERT/UPDATE policies. This
-- migration is idempotent re-application + adds a DELETE policy that
-- explicitly denies user-driven deletes. Account deletion still works via the
-- service-role admin client (which bypasses RLS) or via the auth.users
-- ON DELETE CASCADE chain — but a stolen anon-key session cannot wipe a
-- user_profiles row.

alter table public.user_profiles enable row level security;

drop policy if exists "user_profiles_select_own" on public.user_profiles;
drop policy if exists "user_profiles_insert_own" on public.user_profiles;
drop policy if exists "user_profiles_update_own" on public.user_profiles;
drop policy if exists "user_profiles_delete_none" on public.user_profiles;

create policy "user_profiles_select_own"
  on public.user_profiles for select
  using (auth.uid() = id);

create policy "user_profiles_insert_own"
  on public.user_profiles for insert
  with check (auth.uid() = id);

create policy "user_profiles_update_own"
  on public.user_profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Explicit deny-all for delete from non-service-role contexts. Without this,
-- the table is already deny-default for delete (no policy + RLS on), but
-- the explicit policy makes the intent visible and survives any future
-- "FOR ALL" policy added by mistake.
create policy "user_profiles_delete_none"
  on public.user_profiles for delete
  using (false);
