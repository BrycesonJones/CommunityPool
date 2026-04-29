import { NextResponse } from "next/server";
import { isAddress } from "ethers";
import { createClient as createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getExpectedChainId } from "@/lib/wallet/expected-chain";
import { enforceRateLimits } from "@/lib/security/rate-limit";
import { publicErrorResponse } from "@/lib/security/public-error";
import { recordVerifiedDeployment } from "@/lib/pools/pool-deployment-service";

/**
 * `POST /api/pools/record-deployment`
 *
 * OWASP A08 F-02 — verified deploy ledger writer. Called by the client
 * AFTER `tx.wait()` succeeds, with `{ chainId, poolAddress, deployTxHash }`.
 * The route:
 *
 *   - reads the authenticated user from the Supabase session (NEVER from
 *     the body)
 *   - rejects requests for chains other than the build's expected chain
 *   - re-verifies the deploy receipt on chain via the server's RPC
 *     credentials (the client cannot fake this)
 *   - inserts into `user_pool_deployments` via the service-role admin
 *     client, idempotently
 *
 * The eligibility helper (`countVerifiedDeployments`) reads from this
 * ledger, so a Free user cannot reset their count by deleting their own
 * `user_pool_activity` rows.
 */
export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }

  const parsed = parseRequestBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  // Pin the chain to the build env so a client cannot record a deploy on
  // a chain other than the one the app is configured for. This mirrors
  // the same env-derived chain used by /api/pools/check-deploy.
  const expectedChainId = Number(getExpectedChainId());
  if (parsed.value.chainId !== expectedChainId) {
    return NextResponse.json(
      { error: `chainId must equal the expected chain (${expectedChainId})` },
      { status: 400 },
    );
  }

  const limited = await enforceRateLimits([
    {
      name: "pool_record_deploy_user",
      identifier: user.id,
    },
  ]);
  if (limited) return limited;

  const admin = createAdminClient();
  try {
    const result = await recordVerifiedDeployment(admin, {
      userId: user.id,
      chainId: parsed.value.chainId,
      poolAddress: parsed.value.poolAddress,
      deployTxHash: parsed.value.deployTxHash,
    });
    if (!result.ok) {
      // Distinguish "client should retry once the tx is mined" from
      // "this request is malformed or untrusted." The client polls a few
      // times after deploy; a 202 keeps the modal in a retry state.
      const status =
        result.reason === "tx_pending"
          ? 202
          : result.reason === "no_provider"
            ? 503
            : 400;
      return NextResponse.json(
        { error: "Unable to record deployment", reason: result.reason },
        { status },
      );
    }
    return NextResponse.json({
      ok: true,
      status: result.status,
    });
  } catch (err) {
    return publicErrorResponse(err, "Unable to record deployment", 500);
  }
}

type ParsedBody =
  | {
      ok: true;
      value: { chainId: number; poolAddress: string; deployTxHash: string };
    }
  | { ok: false; error: string };

function parseRequestBody(body: unknown): ParsedBody {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "body must be a json object" };
  }
  const obj = body as Record<string, unknown>;

  const chainId =
    typeof obj.chainId === "number" ? obj.chainId : Number.NaN;
  if (!Number.isFinite(chainId) || chainId <= 0 || !Number.isInteger(chainId)) {
    return { ok: false, error: "chainId must be a positive integer" };
  }

  const pool = obj.poolAddress;
  if (typeof pool !== "string" || !isAddress(pool)) {
    return { ok: false, error: "poolAddress must be a valid EVM address" };
  }

  const tx = obj.deployTxHash;
  if (typeof tx !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(tx)) {
    return {
      ok: false,
      error: "deployTxHash must be a 32-byte hex string (0x + 64 hex chars)",
    };
  }

  return {
    ok: true,
    value: { chainId, poolAddress: pool, deployTxHash: tx },
  };
}
