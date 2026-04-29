import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { isProActive, PRO_GATE_COLUMNS } from "@/lib/stripe/subscription";

/**
 * Free-plan ceiling on deployed pools. Pro is unlimited. The number is fixed
 * at the API + product layer (not user-tunable) so the limit is the same
 * across every entry point. Increase here if the Free tier ever changes.
 */
export const FREE_POOL_LIMIT = 2 as const;

export type CheckDeployReason =
  | "free_pool_limit_reached"
  | "authentication_required";

export type CheckDeployResult = {
  allowed: boolean;
  plan: "free" | "pro";
  deployedPoolCount: number;
  freePoolLimit: typeof FREE_POOL_LIMIT;
  reason?: CheckDeployReason;
};

/**
 * Count verified-on-chain pool deployments for the user on the given chain.
 *
 * OWASP A08 F-02: the count comes from `user_pool_deployments`, which is
 * service-role-write-only. The previous implementation read from
 * `user_pool_activity`, but that table is fully writable by the row owner
 * (`auth.uid() = user_id` RLS), so a Free user could DELETE their own rows
 * to reset the deploy counter and bypass `FREE_POOL_LIMIT`. The ledger
 * table is populated only by /api/pools/record-deployment after on-chain
 * receipt verification — see lib/pools/pool-deployment-service.ts.
 *
 * Counting rules (matching the previous implementation's intent):
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
 * Decide whether a user is allowed to deploy another pool. Pure function so
 * the route handler stays a thin wiring layer and the rule is unit-testable
 * in isolation. Pro is unlimited; Free is capped at FREE_POOL_LIMIT.
 */
export function decideDeployEligibility(args: {
  isPro: boolean;
  deployedPoolCount: number;
}): CheckDeployResult {
  const plan: "free" | "pro" = args.isPro ? "pro" : "free";
  if (args.isPro) {
    return {
      allowed: true,
      plan,
      deployedPoolCount: args.deployedPoolCount,
      freePoolLimit: FREE_POOL_LIMIT,
    };
  }
  if (args.deployedPoolCount >= FREE_POOL_LIMIT) {
    return {
      allowed: false,
      plan,
      deployedPoolCount: args.deployedPoolCount,
      freePoolLimit: FREE_POOL_LIMIT,
      reason: "free_pool_limit_reached",
    };
  }
  return {
    allowed: true,
    plan,
    deployedPoolCount: args.deployedPoolCount,
    freePoolLimit: FREE_POOL_LIMIT,
  };
}

/**
 * Compose the eligibility check end-to-end against an authenticated Supabase
 * client. The caller resolves the user; we read billing state + count pools
 * and apply the predicate. Both reads are RLS-bounded to the calling user.
 */
export async function checkDeployEligibility(
  client: SupabaseClient<Database>,
  args: { userId: string; chainId: number; nowMs?: number },
): Promise<CheckDeployResult> {
  const { data: billingState, error: billingErr } = await client
    .from("user_billing_state")
    .select(PRO_GATE_COLUMNS)
    .eq("user_id", args.userId)
    .maybeSingle();
  if (billingErr) {
    throw new Error(`billing state lookup failed: ${billingErr.message}`);
  }

  const isPro = isProActive(billingState, args.nowMs);
  const deployedPoolCount = await countDeployedPools(client, {
    userId: args.userId,
    chainId: args.chainId,
  });
  return decideDeployEligibility({ isPro, deployedPoolCount });
}
