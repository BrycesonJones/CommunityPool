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
  type CheckDeployResult,
} from "@/lib/pools/deploy-eligibility";

/**
 * `POST /api/pools/check-deploy`
 *
 * Server-side preflight for pool deployment. Confirms the caller holds a
 * valid Supabase session before the client opens a wallet signature prompt,
 * and returns the user's verified deployed-pool count on the expected chain
 * for display. There is no plan or subscription check — every authenticated
 * user may deploy an unlimited number of pools.
 *
 * The chain id is read from the server-side env (`NEXT_PUBLIC_EXPECTED_CHAIN_ID`)
 * rather than from the request body. The user id is read from the Supabase
 * session, never from the request body.
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
      deployedPoolCount: 0,
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
