-- OWASP A08 F-07: drop the legacy `community_pools` and `community_pool_owners`
-- tables. They were the original ownership registry (migration
-- 20250421120000_community_pool_ownership.sql) and were superseded by
-- `pool_owner_memberships` (migration 20250421120001_pool_owner_memberships.sql).
-- Their write policies were stripped in 20260427130000 ("writes service-role
-- only"), but the tables themselves continued to exist with no active
-- consumer in app code or tests — only the generated `database.types.ts`
-- still mentions them.
--
-- Same reasoning that justified dropping `user_pools` in
-- 20260427130100_drop_user_pools.sql: an unreviewed table with stale rows
-- and no consumer is an integrity hazard, because a future code path
-- (or an agent-generated patch) could quietly start writing to it without
-- anyone re-auditing its policies. Better to delete.
--
-- `community_pool_owners` has a foreign key on `(chain_id, pool_address)`
-- back to `community_pools`, so drop it first to avoid a constraint error.
-- CASCADE on the parent is unnecessary and would mask any unexpected
-- dependents — drop them in order instead.

drop table if exists public.community_pool_owners;
drop table if exists public.community_pools;
