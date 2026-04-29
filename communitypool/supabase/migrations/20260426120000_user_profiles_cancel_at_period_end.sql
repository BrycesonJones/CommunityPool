-- Track whether a Pro subscription is scheduled to cancel at period end.
-- Stripe's Billing Portal "Cancel subscription" defaults to cancel-at-period-end:
-- the row stays subscription_status='active' until the period ends, so the UI
-- needs a separate signal to show "Cancels {date}" instead of "Renews {date}".

alter table public.user_profiles
  add column if not exists subscription_cancel_at_period_end boolean not null default false;
