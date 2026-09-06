-- Monetization migration, Phase 1: retire the Stripe subscription product.
--
-- CommunityPool no longer has Free/Pro tiers, a $20/month subscription, or
-- a per-plan pool-deployment ceiling. Every authenticated user can deploy
-- unlimited pools. The two tables below existed solely to cache Stripe
-- subscription state and to de-duplicate Stripe webhook deliveries; with
-- the Stripe routes, webhook handler, and entitlement checks removed from
-- the application there is no remaining reader or writer.
--
-- Verified before authoring (both Dev and Prod projects):
--   - no application code path reads or writes either table
--   - no RLS policy on any other table references them
--   - no Edge Function exists on either project
--   - no trigger, function, or view depends on them
--   - Prod holds zero rows in both tables
--
-- The historical migrations that created these tables are left in place
-- so the migration history stays linear; this file supersedes them.

drop table if exists public.stripe_processed_events;
drop table if exists public.user_billing_state;
