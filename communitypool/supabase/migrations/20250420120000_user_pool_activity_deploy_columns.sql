-- Add first-class typed columns for Open Pools display parity with
-- Public Address Information (asset type, funded token amount, explicit
-- deploy / fund tx hashes). Keep metadata jsonb for secondary fields only.
-- RLS policies on user_pool_activity are row-level and already cover these
-- new columns; no policy changes needed.

alter table public.user_pool_activity
  add column if not exists asset_type text,
  add column if not exists funded_amount_human text,
  add column if not exists deploy_tx_hash text,
  add column if not exists fund_tx_hash text;

-- Best-effort backfill for historical rows written before this migration.
-- Before this change, pools-content.handlePoolDeployed passed
-- [deployTxHash, fundTxHash] into last_tx_hashes (deploy first, then fund),
-- so position 1 is the deploy hash and position 2 is the fund hash when
-- both were recorded. Only populate when the destination column is still
-- null so we never overwrite freshly-written values.
update public.user_pool_activity
  set deploy_tx_hash = last_tx_hashes[1]
  where deploy_tx_hash is null
    and array_length(last_tx_hashes, 1) >= 1;

update public.user_pool_activity
  set fund_tx_hash = last_tx_hashes[2]
  where fund_tx_hash is null
    and last_activity = 'deploy'
    and array_length(last_tx_hashes, 1) >= 2;

create index if not exists user_pool_activity_user_updated_at_idx
  on public.user_pool_activity (user_id, updated_at desc);
