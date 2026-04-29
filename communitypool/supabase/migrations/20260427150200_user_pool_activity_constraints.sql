-- OWASP A08 F-09: user_pool_activity is user-writable via RLS so a direct
-- PostgREST call can write fields that bypass the validation in
-- lib/pools/pool-activity-service.ts. This migration adds CHECK constraints
-- to the columns that flow into the UI / Stripe / explorer URLs so the DB
-- itself rejects malformed data even when the helper is bypassed.
--
-- Empty pool_address is preserved as a valid value because earlier rows
-- (failed deploys before the not-null tightening migration) used "" to mean
-- "no contract address". The eligibility helper already excludes empty
-- pool_address with .neq("pool_address", "").

-- 1. Sanitize any pre-existing rows that would violate the new constraints.
--    Each fix is best-effort: we'd rather lose a malformed display field
--    than block the migration.
update public.user_pool_activity
  set pool_address = ''
  where pool_address is not null
    and pool_address <> ''
    and pool_address !~ '^0x[a-fA-F0-9]{40}$';

update public.user_pool_activity
  set deploy_tx_hash = null
  where deploy_tx_hash is not null
    and deploy_tx_hash !~ '^0x[a-fA-F0-9]{64}$';

update public.user_pool_activity
  set fund_tx_hash = null
  where fund_tx_hash is not null
    and fund_tx_hash !~ '^0x[a-fA-F0-9]{64}$';

-- last_tx_hashes is intentionally NOT constrained: PostgreSQL CHECK
-- constraints cannot contain subqueries (so per-element regex via unnest
-- is not portable), and the array is only an internal audit log displayed
-- to the row owner. The single-tx-hash columns deploy_tx_hash and
-- fund_tx_hash flow into explorer URLs and ARE constrained below.

update public.user_pool_activity
  set total_usd_estimate = 0
  where total_usd_estimate is not null
    and total_usd_estimate < 0;

update public.user_pool_activity
  set name = substring(name from 1 for 80)
  where char_length(name) > 80;

update public.user_pool_activity
  set description = substring(description from 1 for 500)
  where char_length(description) > 500;

-- 2. Add the CHECK constraints. NOT VALID would let bad rows linger; we
--    sanitized first so the constraints can be added immediately.
alter table public.user_pool_activity
  drop constraint if exists user_pool_activity_pool_address_format;
alter table public.user_pool_activity
  add constraint user_pool_activity_pool_address_format
  check (pool_address = '' or pool_address ~ '^0x[a-fA-F0-9]{40}$');

alter table public.user_pool_activity
  drop constraint if exists user_pool_activity_deploy_tx_hash_format;
alter table public.user_pool_activity
  add constraint user_pool_activity_deploy_tx_hash_format
  check (deploy_tx_hash is null or deploy_tx_hash ~ '^0x[a-fA-F0-9]{64}$');

alter table public.user_pool_activity
  drop constraint if exists user_pool_activity_fund_tx_hash_format;
alter table public.user_pool_activity
  add constraint user_pool_activity_fund_tx_hash_format
  check (fund_tx_hash is null or fund_tx_hash ~ '^0x[a-fA-F0-9]{64}$');

alter table public.user_pool_activity
  drop constraint if exists user_pool_activity_total_usd_estimate_nonneg;
alter table public.user_pool_activity
  add constraint user_pool_activity_total_usd_estimate_nonneg
  check (total_usd_estimate is null or total_usd_estimate >= 0);

alter table public.user_pool_activity
  drop constraint if exists user_pool_activity_name_length;
alter table public.user_pool_activity
  add constraint user_pool_activity_name_length
  check (char_length(name) <= 80);

alter table public.user_pool_activity
  drop constraint if exists user_pool_activity_description_length;
alter table public.user_pool_activity
  add constraint user_pool_activity_description_length
  check (char_length(description) <= 500);
