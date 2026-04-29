-- Lightweight application-level KYC / profile-completion fields on user_profiles.
-- Required before a user can deploy their first CommunityPool. Extends the
-- existing user_profiles row keyed on auth.users.id (no new table needed).

alter table public.user_profiles
  add column if not exists full_name text,
  add column if not exists address_line1 text,
  add column if not exists address_line2 text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists postal_code text,
  add column if not exists country text,
  add column if not exists phone_number text;

-- Single source of truth for "did the user finish KYC?". Generated so the app
-- can query a boolean instead of recomputing the rule client-side.
alter table public.user_profiles
  add column if not exists kyc_profile_completed boolean
    generated always as (
      coalesce(nullif(btrim(full_name), ''), '') <> ''
      and coalesce(nullif(btrim(phone_number), ''), '') <> ''
      and coalesce(nullif(btrim(address_line1), ''), '') <> ''
      and coalesce(nullif(btrim(city), ''), '') <> ''
      and coalesce(nullif(btrim(state), ''), '') <> ''
      and coalesce(nullif(btrim(postal_code), ''), '') <> ''
      and coalesce(nullif(btrim(country), ''), '') <> ''
    ) stored;

alter table public.user_profiles enable row level security;

drop policy if exists "user_profiles_select_own" on public.user_profiles;
drop policy if exists "user_profiles_insert_own" on public.user_profiles;
drop policy if exists "user_profiles_update_own" on public.user_profiles;

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
