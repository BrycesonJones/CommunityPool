import "server-only";
import { createHash } from "node:crypto";
import { redactForLog } from "@/lib/security/redact";

export type SecuritySeverity = "debug" | "info" | "medium" | "high" | "critical";

export type SecurityEvent = {
  event_type: string;
  severity: SecuritySeverity;
  timestamp?: string;
  environment?: string;
  request_id?: string;
  route?: string;
  method?: string;
  status_code?: number;
  user_id?: string;
  user_id_hash?: string;
  ip_hash?: string;
  user_agent_hash?: string;
  email_hash?: string;
  rate_limit_key_hash?: string;
  wallet_address_hash?: string;
  chain_id?: number;
  pool_address?: string;
  tx_hash?: string;
  stripe_event_id?: string;
  stripe_customer_id_hash?: string;
  stripe_subscription_id_hash?: string;
  error_code?: string;
  safe_message?: string;
  metadata?: Record<string, unknown>;
};

export function hashIdentifier(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function requestContextForSecurityEvent(request: Request): Pick<
  SecurityEvent,
  "request_id" | "method" | "route" | "ip_hash" | "user_agent_hash"
> {
  const url = new URL(request.url);
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip")?.trim() ?? undefined;
  const ua = request.headers.get("user-agent") ?? undefined;
  return {
    request_id:
      request.headers.get("x-request-id") ??
      request.headers.get("x-correlation-id") ??
      undefined,
    method: request.method,
    route: url.pathname,
    ip_hash: hashIdentifier(ip),
    user_agent_hash: hashIdentifier(ua),
  };
}

export function securityEvent(event: SecurityEvent): void {
  try {
    const payload: SecurityEvent = {
      ...event,
      timestamp: event.timestamp ?? new Date().toISOString(),
      environment: event.environment ?? process.env.NODE_ENV ?? "unknown",
      user_id_hash: event.user_id_hash ?? hashIdentifier(event.user_id),
    };

    const authContext =
      payload.event_type.startsWith("auth.") ||
      payload.route?.includes("/auth/") ||
      payload.route?.includes("/api/auth/") ||
      false;
    const safePayload = redactForLog(payload, { authContext });
    const json = JSON.stringify(safePayload);

    // Keep sink fanout behind a single API for future Datadog/Sentry/Axiom wiring.
    if (payload.severity === "critical" || payload.severity === "high") {
      console.error(json);
      return;
    }
    if (payload.severity === "medium") {
      console.warn(json);
      return;
    }
    if (payload.severity === "debug") {
      console.debug(json);
      return;
    }
    console.info(json);
  } catch {
    // Never throw from security logging paths.
  }
}
