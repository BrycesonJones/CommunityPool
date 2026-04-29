import "server-only";
import { NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { hashIdentifier, securityEvent } from "@/lib/security/security-event";

/**
 * Application-layer rate limiting. Routes call `enforceRateLimits` with one or
 * more named policies; the helper returns a 429 NextResponse when any policy is
 * exhausted, or `null` when the request may proceed. Backed by Upstash Redis
 * when `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are set; otherwise
 * falls back to an in-process Map (per-instance, NOT durable across serverless
 * deployments — production must configure Upstash).
 */

export type PolicyName =
  | "otp_send_email"
  | "otp_send_ip"
  | "otp_verify"
  | "otp_verify_email_long"
  | "oauth_callback"
  | "onchain_lookup_user_minute"
  | "onchain_lookup_user_hour"
  | "pool_balances_ip"
  | "pool_balances_address"
  | "pool_owners_user_pool"
  | "pool_check_deploy_user"
  | "pool_record_deploy_user"
  | "stripe_checkout_user"
  | "stripe_portal_user";

interface Policy {
  limit: number;
  windowSeconds: number;
}

export const POLICIES: Record<PolicyName, Policy> = {
  otp_send_email: { limit: 3, windowSeconds: 60 },
  otp_send_ip: { limit: 10, windowSeconds: 60 },
  // Short-window cap. Was 10/60s — tightened to 5/60s to slow brute-force on
  // the 6-digit OTP space. Supabase still applies its own per-OTP attempt cap
  // server-side; this is the app-layer ceiling stacked on top of it.
  otp_verify: { limit: 5, windowSeconds: 60 },
  // Long-window cap on the email axis. Caps total verify attempts per OTP
  // lifetime even if an attacker rotates IPs. 30 attempts / 600s ≈ 0.003%
  // chance of guessing a uniformly random 6-digit code per 10-minute window.
  otp_verify_email_long: { limit: 30, windowSeconds: 600 },
  oauth_callback: { limit: 20, windowSeconds: 60 },
  onchain_lookup_user_minute: { limit: 30, windowSeconds: 60 },
  onchain_lookup_user_hour: { limit: 200, windowSeconds: 3600 },
  pool_balances_ip: { limit: 60, windowSeconds: 60 },
  pool_balances_address: { limit: 30, windowSeconds: 60 },
  pool_owners_user_pool: { limit: 10, windowSeconds: 60 },
  pool_check_deploy_user: { limit: 30, windowSeconds: 60 },
  // Tight cap: a successful deploy yields exactly one record-deployment
  // call. Multiple in a short window means the client is retrying after
  // a 202 "tx_pending" response — give it room without letting a script
  // hammer the route.
  pool_record_deploy_user: { limit: 20, windowSeconds: 60 },
  stripe_checkout_user: { limit: 5, windowSeconds: 600 },
  stripe_portal_user: { limit: 5, windowSeconds: 600 },
};

export interface RateLimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

interface Backend {
  hit(policyKey: string, identifier: string, policy: Policy): Promise<RateLimitResult>;
}

let cachedBackend: Backend | null = null;
let backendKindLogged = false;

function getBackend(): Backend {
  if (cachedBackend) return cachedBackend;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const isProd = process.env.NODE_ENV === "production";
  if (url && token) {
    cachedBackend = createUpstashBackend(url, token);
    if (!backendKindLogged) {
      backendKindLogged = true;
      console.info("[rate-limit] using Upstash Redis backend");
    }
  } else {
    if (isProd) {
      securityEvent({
        event_type: "security.config.missing_rate_limit_backend",
        severity: "critical",
        safe_message:
          "Production missing Upstash rate-limit backend configuration.",
        metadata: {
          has_url: Boolean(url),
          has_token: Boolean(token),
        },
      });
      throw new Error(
        "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required in production.",
      );
    }
    cachedBackend = createInMemoryBackend();
    if (!backendKindLogged) {
      backendKindLogged = true;
      console.warn(
        "[rate-limit] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set — falling back to in-process limiter (per-instance only, NOT safe for production)",
      );
    }
  }
  return cachedBackend;
}

function createUpstashBackend(url: string, token: string): Backend {
  const redis = new Redis({ url, token });
  const limiterCache = new Map<string, Ratelimit>();

  return {
    async hit(policyKey, identifier, policy) {
      let limiter = limiterCache.get(policyKey);
      if (!limiter) {
        limiter = new Ratelimit({
          redis,
          limiter: Ratelimit.slidingWindow(policy.limit, `${policy.windowSeconds} s`),
          prefix: `cp:rl:${policyKey}`,
          analytics: false,
        });
        limiterCache.set(policyKey, limiter);
      }
      const r = await limiter.limit(identifier);
      const retryAfterSeconds = Math.max(
        0,
        Math.ceil((r.reset - Date.now()) / 1000),
      );
      return {
        ok: r.success,
        limit: policy.limit,
        remaining: Math.max(0, r.remaining),
        retryAfterSeconds: r.success ? 0 : Math.max(1, retryAfterSeconds),
      };
    },
  };
}

function createInMemoryBackend(): Backend {
  const buckets = new Map<string, number[]>();
  return {
    async hit(policyKey, identifier, policy) {
      const key = `${policyKey}:${identifier}`;
      const now = Date.now();
      const cutoff = now - policy.windowSeconds * 1000;
      const hits = (buckets.get(key) ?? []).filter((t) => t > cutoff);
      if (hits.length >= policy.limit) {
        const oldest = hits[0];
        const retryAfter = Math.max(
          1,
          Math.ceil((oldest + policy.windowSeconds * 1000 - now) / 1000),
        );
        buckets.set(key, hits);
        return {
          ok: false,
          limit: policy.limit,
          remaining: 0,
          retryAfterSeconds: retryAfter,
        };
      }
      hits.push(now);
      buckets.set(key, hits);
      return {
        ok: true,
        limit: policy.limit,
        remaining: policy.limit - hits.length,
        retryAfterSeconds: 0,
      };
    },
  };
}

export async function checkRateLimit(
  name: PolicyName,
  identifier: string,
): Promise<RateLimitResult> {
  if (!identifier) {
    // An empty identifier would group every caller into one bucket — refuse
    // rather than silently mis-limiting. Callers must supply something.
    throw new Error(`rate-limit: empty identifier for policy ${name}`);
  }
  const policy = POLICIES[name];
  return getBackend().hit(name, identifier, policy);
}

export interface RateLimitCheck {
  name: PolicyName;
  identifier: string;
}

/**
 * Apply one or more rate-limit policies. Returns a 429 NextResponse if any
 * policy is exhausted; returns null when the caller may proceed. The
 * `Retry-After` header reflects the longest cooldown across all failing
 * policies.
 */
export async function enforceRateLimits(
  checks: RateLimitCheck[],
): Promise<NextResponse | null> {
  let worst: RateLimitResult | null = null;
  let failed: RateLimitCheck | null = null;
  for (const check of checks) {
    let result: RateLimitResult;
    try {
      result = await checkRateLimit(check.name, check.identifier);
    } catch (err) {
      securityEvent({
        event_type: "rate_limit.backend_unavailable",
        severity: "high",
        status_code: 503,
        safe_message: "Rate-limit backend unavailable.",
        rate_limit_key_hash: hashIdentifier(`${check.name}:${check.identifier}`),
        metadata: {
          policy: check.name,
          error_kind: err instanceof Error ? err.name : "unknown",
        },
      });
      return rateLimitUnavailableResponse();
    }
    if (!result.ok) {
      if (!worst || result.retryAfterSeconds > worst.retryAfterSeconds) {
        worst = result;
        failed = check;
      }
    }
  }
  if (!worst) return null;
  securityEvent({
    event_type: "rate_limit.exceeded",
    severity: "medium",
    status_code: 429,
    safe_message: "Rate limit policy exceeded.",
    rate_limit_key_hash: hashIdentifier(
      failed ? `${failed.name}:${failed.identifier}` : undefined,
    ),
    metadata: {
      policy: failed?.name,
      retry_after_seconds: worst.retryAfterSeconds,
      limit: worst.limit,
    },
  });
  return rateLimitedResponse(worst.retryAfterSeconds);
}

export function rateLimitedResponse(retryAfterSeconds: number): NextResponse {
  const seconds = Math.max(1, Math.ceil(retryAfterSeconds));
  return NextResponse.json(
    {
      error: "Too many requests. Please try again later.",
      code: "rate_limited",
      retryAfter: seconds,
    },
    {
      status: 429,
      headers: { "Retry-After": String(seconds) },
    },
  );
}

export function rateLimitUnavailableResponse(): NextResponse {
  return NextResponse.json(
    {
      error: "Service unavailable. Please try again shortly.",
      code: "service_unavailable",
    },
    {
      status: 503,
      headers: { "cache-control": "no-store" },
    },
  );
}

/**
 * Best-effort client IP extraction. Uses the standard proxy headers set by
 * Vercel / common reverse proxies. Falls back to "unknown" so callers always
 * get a usable string (which then groups all unknown-IP requests into one
 * bucket — fine, since we want to throttle that case aggressively).
 */
export function getClientIp(request: Request): string {
  const headers = request.headers;
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = headers.get("x-real-ip");
  if (real) return real.trim();
  const cf = headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  return "unknown";
}

/** Test-only: reset the cached backend. */
export function __resetRateLimitForTests(): void {
  cachedBackend = null;
  backendKindLogged = false;
}
