-- Companion to 20260427140000_user_billing_state_create.sql. After billing
-- data is backfilled into user_billing_state, drop the now-orphaned columns
-- from user_profiles so the user-writable UPDATE policy can no longer reach
-- subscription state. Indexes on these columns drop automatically with the
-- columns.

alter table public.user_profiles drop column if exists subscription_interval;
alter table public.user_profiles drop column if exists subscription_cancel_at_period_end;
alter table public.user_profiles drop column if exists subscription_current_period_end;
alter table public.user_profiles drop column if exists subscription_plan;
alter table public.user_profiles drop column if exists subscription_status;
alter table public.user_profiles drop column if exists stripe_subscription_id;
alter table public.user_profiles drop column if exists stripe_customer_id;
