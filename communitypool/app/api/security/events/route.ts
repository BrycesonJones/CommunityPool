import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { apiErrorResponse } from "@/lib/security/public-error";
import {
  hashIdentifier,
  requestContextForSecurityEvent,
  securityEvent,
  type SecuritySeverity,
} from "@/lib/security/security-event";

const ALLOWED_EVENT_TYPES = new Set([
  "pool.deploy.started",
  "pool.deploy.tx_submitted",
  "pool.deploy.confirmed",
  "pool.deploy.failed",
  "pool.deploy.db_persist_failed",
  "pool.deploy.recovery_needed",
  "pool.fund.started",
  "pool.fund.tx_submitted",
  "pool.fund.confirmed",
  "pool.fund.failed",
  "pool.fund.db_persist_failed",
  "pool.withdraw.owner_check_failed",
  "pool.withdraw.started",
  "pool.withdraw.tx_submitted",
  "pool.withdraw.confirmed",
  "pool.withdraw.failed",
  "pool.withdraw.db_persist_failed",
  "pool.withdraw.recovery_needed",
  "pool.owner_sync.failed",
]);

type IncomingSecurityEvent = {
  event_type?: unknown;
  severity?: unknown;
  chain_id?: unknown;
  pool_address?: unknown;
  tx_hash?: unknown;
  wallet_address?: unknown;
  error_code?: unknown;
  safe_message?: unknown;
  metadata?: unknown;
  db_persist_ok?: unknown;
  needs_recovery?: unknown;
  action?: unknown;
  status?: unknown;
  explorer_url?: unknown;
};

function asSeverity(value: unknown): SecuritySeverity {
  if (
    value === "debug" ||
    value === "info" ||
    value === "medium" ||
    value === "high" ||
    value === "critical"
  ) {
    return value;
  }
  return "info";
}

export async function POST(request: Request) {
  const ctx = requestContextForSecurityEvent(request);
  let body: IncomingSecurityEvent;
  try {
    body = (await request.json()) as IncomingSecurityEvent;
  } catch {
    return apiErrorResponse({
      error: "Invalid request",
      code: "invalid_request",
      status: 400,
      request,
    });
  }

  const eventType = typeof body.event_type === "string" ? body.event_type : "";
  if (!ALLOWED_EVENT_TYPES.has(eventType)) {
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

  securityEvent({
    ...ctx,
    event_type: eventType,
    severity: asSeverity(body.severity),
    user_id_hash: hashIdentifier(user.id),
    chain_id: typeof body.chain_id === "number" ? body.chain_id : undefined,
    pool_address: typeof body.pool_address === "string" ? body.pool_address : undefined,
    tx_hash: typeof body.tx_hash === "string" ? body.tx_hash : undefined,
    wallet_address_hash:
      typeof body.wallet_address === "string"
        ? hashIdentifier(body.wallet_address)
        : undefined,
    error_code: typeof body.error_code === "string" ? body.error_code : undefined,
    safe_message:
      typeof body.safe_message === "string"
        ? body.safe_message
        : "Client-reported pool lifecycle event.",
    metadata:
      body.metadata && typeof body.metadata === "object"
        ? {
            ...(body.metadata as Record<string, unknown>),
            db_persist_ok:
              typeof body.db_persist_ok === "boolean" ? body.db_persist_ok : undefined,
            needs_recovery:
              typeof body.needs_recovery === "boolean" ? body.needs_recovery : undefined,
            action: typeof body.action === "string" ? body.action : undefined,
            status: typeof body.status === "string" ? body.status : undefined,
            explorer_url:
              typeof body.explorer_url === "string" ? body.explorer_url : undefined,
          }
        : undefined,
  });

  return NextResponse.json({ ok: true });
}
