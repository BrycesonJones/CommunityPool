import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export type CheckDeployReason = "authentication_required";

export type CheckDeployResult = {
  allowed: boolean;
  deployedPoolCount: number;
  reason?: CheckDeployReason;
};

/**
 * Count verified-on-chain pool deployments for the user on the given chain.
 *
 * The count is informational only — CommunityPool has no per-plan pool
 * ceiling, so nothing here gates deployment. The read stays on
 * `user_pool_deployments` (service-role-write-only, populated by
 * /api/pools/record-deployment after on-chain receipt verification; see
 * lib/pools/pool-deployment-service.ts) so the number reflects verified
 * deploys rather than the user-writable activity cache.
 *
 * Counting rules:
 *   - rows belong to the authenticated user (RLS already enforces; filter
 *     is defence-in-depth)
 *   - rows are on the chain we're about to deploy to (chain id from the
 *     env guard, never from the request body)
 *   - deployed-but-funding-failed pools still count: the ledger row is
 *     written when the deploy tx confirms, before any funding step
 *   - failed deploys with no contractAddress never reach the ledger (the
 *     verification step rejects them) so they don't count
 */
export async function countDeployedPools(
  client: SupabaseClient<Database>,
  args: { userId: string; chainId: number },
): Promise<number> {
  const { count, error } = await client
    .from("user_pool_deployments")
    .select("id", { count: "exact", head: true })
    .eq("user_id", args.userId)
    .eq("chain_id", args.chainId);
  if (error) {
    throw new Error(`countDeployedPools failed: ${error.message}`);
  }
  return count ?? 0;
}

/**
 * Decide whether an authenticated user may deploy another pool. Pure
 * function so the rule is unit-testable in isolation.
 *
 * Every authenticated user may deploy an unlimited number of pools. There
 * is no subscription tier, no plan lookup, and no pool-count ceiling — the
 * only reason a deploy is refused at this layer is a missing session, which
 * the route handler resolves before calling in.
 */
export function decideDeployEligibility(args: {
  deployedPoolCount: number;
}): CheckDeployResult {
  return {
    allowed: true,
    deployedPoolCount: args.deployedPoolCount,
  };
}

/**
 * Compose the eligibility check end-to-end against an authenticated Supabase
 * client. The caller resolves the user; we count verified pools (RLS-bounded
 * to the calling user) and apply the predicate.
 */
export async function checkDeployEligibility(
  client: SupabaseClient<Database>,
  args: { userId: string; chainId: number },
): Promise<CheckDeployResult> {
  const deployedPoolCount = await countDeployedPools(client, {
    userId: args.userId,
    chainId: args.chainId,
  });
  return decideDeployEligibility({ deployedPoolCount });
}
