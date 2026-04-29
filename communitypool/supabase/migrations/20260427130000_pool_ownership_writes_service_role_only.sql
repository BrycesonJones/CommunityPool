-- Lock down client writes on the pool ownership / registry tables. The
-- previous policies only checked auth.uid() = <some>_user_id, which let any
-- authenticated user insert rows claiming themselves (or anyone) as an owner
-- of any pool. That bypassed the app-side withdraw permission gate.
--
-- Writes now flow exclusively through server routes that use the service-role
-- client (which bypasses RLS) AFTER verifying ownership on-chain via the
-- pool contract's isOwner(address) view. Keeping SELECT for authenticated
-- users so the app can still query memberships.

drop policy if exists "pool_owner_memberships_insert_creator"
  on public.pool_owner_memberships;
drop policy if exists "pool_owner_memberships_update_creator"
  on public.pool_owner_memberships;
drop policy if exists "pool_owner_memberships_delete_creator"
  on public.pool_owner_memberships;

drop policy if exists "community_pool_owners_insert_adder"
  on public.community_pool_owners;
drop policy if exists "community_pool_owners_update_adder"
  on public.community_pool_owners;
drop policy if exists "community_pool_owners_delete_adder"
  on public.community_pool_owners;

drop policy if exists "community_pools_insert_creator"
  on public.community_pools;
drop policy if exists "community_pools_update_creator"
  on public.community_pools;
drop policy if exists "community_pools_delete_creator"
  on public.community_pools;
