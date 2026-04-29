import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runOnchainLookup } from "@/lib/onchain/service";
import { enforceRateLimits } from "@/lib/security/rate-limit";
import { apiErrorResponse, publicErrorResponse } from "@/lib/security/public-error";
import {
  hashIdentifier,
  requestContextForSecurityEvent,
  securityEvent,
} from "@/lib/security/security-event";

/**
 * Body: `{ raw, rowId?, forceRefresh?, networks?, assumedFamily? }`.
 * Persisted rows use `address_id` as the stored submitted value (legacy name).
 */
export async function POST(request: Request) {
  const ctx = requestContextForSecurityEvent(request);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return apiErrorResponse({
      error: "Invalid request",
      code: "invalid_request",
      status: 400,
      request,
    });
  }

  const raw = typeof body.raw === "string" ? body.raw : "";
  if (!raw.trim()) {
    return apiErrorResponse({
      error: "Invalid request",
      code: "invalid_request",
      status: 400,
      request,
    });
  }

  const supabase = await createClient();
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
    return apiErrorResponse({
      error: "Authentication required",
      code: "authentication_required",
      status: 401,
      request,
    });
  }

  // Stack a per-minute and per-hour budget on the user's id so a single
  // session can't exhaust the shared Alchemy/Etherscan quota with repeated
  // manual lookups.
  const limited = await enforceRateLimits([
    { name: "onchain_lookup_user_minute", identifier: user.id },
    { name: "onchain_lookup_user_hour", identifier: user.id },
  ]);
  if (limited) return limited;

  const forceRefresh = Boolean(body.forceRefresh);
  const rowId = typeof body.rowId === "string" ? body.rowId : undefined;
  const assumedFamily =
    body.assumedFamily === "evm" || body.assumedFamily === "bitcoin"
      ? body.assumedFamily
      : undefined;

  let networks: string[] | undefined;
  if (Array.isArray(body.networks)) {
    networks = body.networks.filter((n): n is string => typeof n === "string");
  }

  try {
    const result = await runOnchainLookup({
      raw,
      userId: user.id,
      supabase,
      forceRefresh,
      networks,
      assumedFamily,
      rowId,
    });

    return NextResponse.json(result, {
      headers: { "cache-control": "no-store" },
    });
  } catch (err) {
    securityEvent({
      ...ctx,
      event_type: "onchain.lookup.failed",
      severity: "medium",
      status_code: 502,
      user_id_hash: hashIdentifier(user.id),
      safe_message: "On-chain lookup failed.",
    });
    return publicErrorResponse(err, "Service unavailable", 502);
  }
}
