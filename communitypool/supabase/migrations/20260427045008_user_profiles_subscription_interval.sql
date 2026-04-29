-- Track which Pro billing interval (monthly $20 / yearly $160) the user is on,
-- so the Account UI can render the right price + cadence. Webhook fills this
-- from Stripe on every subscription event; null is treated as monthly by the UI
-- (matches behavior for legacy rows created before this column existed).

alter table public.user_profiles
  add column if not exists subscription_interval text
    check (subscription_interval in ('monthly', 'yearly'));
