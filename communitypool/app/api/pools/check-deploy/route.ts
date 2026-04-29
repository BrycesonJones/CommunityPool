import { NextResponse } from "next/server";
import { createClient as createServerSupabaseClient } from "@/lib/supabase/server";
import { getExpectedChainId } from "@/lib/wallet/expected-chain";
import { enforceRateLimits } from "@/lib/security/rate-limit";
import { publicErrorResponse } from "@/lib/security/public-error";
import {
  hashIdentifier,
  requestContextForSecurityEvent,
  securityEvent,
} from "@/lib/security/security-event";
import {
  checkDeployEligibility,
  FREE_POOL_LIMIT,
  type CheckDeployResult,
} from "@/lib/pools/deploy-eligibility";

/**
 * `POST /api/pools/check-deploy`
 *
 * Server-side preflight gate for pool deployment. Resolves Pro entitlement
 * from `user_billing_state` (Stripe-driven; see lib/stripe/subscription.ts)
 * and counts the user's existing deployed pools on the expected chain. Free
 * users are capped at FREE_POOL_LIMIT; Pro users are unlimited.
 *
 * The chain id is read from the server-side env (`NEXT_PUBLIC_EXPECTED_CHAIN_ID`)
 * rather than from the request body so a client cannot pick a different
 * chain to dodge the limit. The user id is read from the Supabase session,
 * never from the request body.
 *
 * Closes OWASP A06 F-02 (pricing claimed "Unlimited pools" with no
 * server-side enforcement).
 */
export async function POST(request: Request): Promise<NextResponse> {
  const ctx = requestContextForSecurityEvent(request);
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    securityEvent({
      ...ctx,
      event_type: "api.auth_required",
      severity: "medium",
      status_code: 401,
      safe_message: "Authenticated API access required.",
    });
    const body: CheckDeployResult = {
      allowed: false,
      plan: "free",
      deployedPoolCount: 0,
      freePoolLimit: FREE_POOL_LIMIT,
      reason: "authentication_required",
    };
    return NextResponse.json(body, { status: 401 });
  }

  const limited = await enforceRateLimits([
    { name: "pool_check_deploy_user", identifier: user.id },
  ]);
  if (limited) return limited;

  const chainId = Number(getExpectedChainId());
  try {
    const result = await checkDeployEligibility(supabase, {
      userId: user.id,
      chainId,
    });
    return NextResponse.json(result satisfies CheckDeployResult);
  } catch (err) {
    securityEvent({
      ...ctx,
      event_type: "pool.deploy.eligibility_check_failed",
      severity: "medium",
      status_code: 500,
      user_id_hash: hashIdentifier(user.id),
      chain_id: chainId,
      safe_message: "Unable to verify deploy eligibility.",
    });
    return publicErrorResponse(err, "Unable to verify deploy eligibility", 500);
  }
}
