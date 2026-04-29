-- A01 Broken Access Control fix: separate Stripe-controlled billing state from
-- the user-writable user_profiles row. Previously the user_profiles UPDATE
-- policy (using/with check auth.uid() = id) let any authenticated user PATCH
-- their own subscription_plan / subscription_status / stripe_customer_id /
-- subscription_current_period_end via PostgREST and self-elevate to Pro
-- without paying. This migration moves those columns to a sibling table
-- whose RLS surface is read-own-only; writes are service-role exclusively.
--
-- Companion migration 20260427140001 drops the now-orphaned columns from
-- user_profiles after backfill.

create table if not exists public.user_billing_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text,
  subscription_status text,
  subscription_plan text not null default 'free',
  subscription_current_period_end timestamptz,
  subscription_cancel_at_period_end boolean not null default false,
  subscription_interval text check (subscription_interval in ('monthly', 'yearly')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_billing_state_stripe_subscription_id_idx
  on public.user_billing_state (stripe_subscription_id)
  where stripe_subscription_id is not null;

alter table public.user_billing_state enable row level security;

-- Read-own only. No INSERT/UPDATE/DELETE policies are defined for the
-- authenticated role — RLS denies by default, so all writes must go through
-- the service-role admin client used by /api/stripe/* and the Stripe webhook.
drop policy if exists "user_billing_state_select_own" on public.user_billing_state;
create policy "user_billing_state_select_own"
  on public.user_billing_state for select
  using (auth.uid() = user_id);

-- Backfill from user_profiles. Rows are created only for users that have
-- ever interacted with Stripe (have a customer id). Free-only users keep
-- the implicit "no billing row → free" semantic.
insert into public.user_billing_state (
  user_id,
  stripe_customer_id,
  stripe_subscription_id,
  subscription_status,
  subscription_plan,
  subscription_current_period_end,
  subscription_cancel_at_period_end,
  subscription_interval,
  created_at,
  updated_at
)
select
  p.id,
  p.stripe_customer_id,
  p.stripe_subscription_id,
  p.subscription_status,
  coalesce(p.subscription_plan, 'free'),
  p.subscription_current_period_end,
  coalesce(p.subscription_cancel_at_period_end, false),
  p.subscription_interval,
  coalesce(p.created_at, now()),
  coalesce(p.updated_at, now())
from public.user_profiles p
where p.stripe_customer_id is not null
on conflict (user_id) do nothing;
