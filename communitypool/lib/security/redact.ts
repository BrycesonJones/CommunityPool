import "server-only";

/**
 * A04 hardening: scrub obviously secret-shaped values from anything we are
 * about to log on the server. The redacted error still describes WHAT
 * happened (the SDK message text, the stack), just not the secret value
 * embedded in it.
 *
 * This is a defence-in-depth helper, not a sanitizer. The primary control
 * is "we don't log secrets in the first place" — but Stripe / Supabase /
 * fetch errors occasionally include sensitive substrings (a customer id,
 * a webhook signing secret echoed inside an error message) and once those
 * land in a hosted log SaaS they are someone else's problem.
 *
 * Tradeoffs:
 *   - We replace each match with `[REDACTED:<label>]` so log triage still
 *     knows the *shape* of what was hidden.
 *   - The patterns are conservative on purpose: only well-known prefixes /
 *     URL schemes that are unambiguous. We do NOT try to redact arbitrary
 *     "long random-looking string" — that flagrantly produces false
 *     positives that hide real diagnostic info.
 */

interface RedactionRule {
  label: string;
  regex: RegExp;
}

const RULES: readonly RedactionRule[] = [
  { label: "stripe-webhook-secret", regex: /\bwhsec_[A-Za-z0-9]{12,}/g },
  { label: "stripe-secret-live", regex: /\bsk_live_[A-Za-z0-9]{12,}/g },
  { label: "stripe-secret-test", regex: /\bsk_test_[A-Za-z0-9]{12,}/g },
  { label: "stripe-publishable-live", regex: /\bpk_live_[A-Za-z0-9]{12,}/g },
  { label: "stripe-publishable-test", regex: /\bpk_test_[A-Za-z0-9]{12,}/g },
  { label: "stripe-customer-id", regex: /\bcus_[A-Za-z0-9]{8,}/g },
  { label: "stripe-subscription-id", regex: /\bsub_[A-Za-z0-9]{8,}/g },
  // Authorization: Bearer <token> — strips the token, keeps the scheme.
  {
    label: "bearer-token",
    regex: /\bBearer\s+[A-Za-z0-9\-._~+/=]{8,}/gi,
  },
  {
    label: "authorization-header",
    regex: /\bAuthorization\s*:\s*[^\r\n]+/gi,
  },
  {
    label: "cookie-header",
    regex: /\bCookie\s*:\s*[^\r\n]+/gi,
  },
  // JWT-shaped tokens (3 base64url segments). Catches Supabase access /
  // refresh / service-role JWTs without trying to decode them.
  {
    label: "jwt",
    regex: /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g,
  },
  // Postgres connection URLs — credentials embedded inline.
  {
    label: "postgres-url",
    regex: /\bpostgres(?:ql)?:\/\/[^\s'"`<>]+/g,
  },
  {
    label: "google-oauth-secret",
    regex: /\bGOCSPX-[A-Za-z0-9_-]{12,}\b/g,
  },
  {
    label: "upstash-token",
    regex: /\bUPSTASH_REDIS_REST_TOKEN\s*[=:]\s*[^\s'"`<>]+/gi,
  },
  {
    label: "alchemy-api-key",
    regex: /\bALCHEMY_API_KEY\s*[=:]\s*[^\s'"`<>]+/gi,
  },
  {
    label: "etherscan-api-key",
    regex: /\bETHERSCAN_API_KEY\s*[=:]\s*[^\s'"`<>]+/gi,
  },
];

/** Replace secret-shaped substrings with `[REDACTED:<label>]`. */
export function redactSecrets(
  input: string,
  opts?: { authContext?: boolean },
): string {
  let out = input;
  for (const rule of RULES) {
    out = out.replace(rule.regex, `[REDACTED:${rule.label}]`);
  }
  if (opts?.authContext) {
    out = out.replace(/\b\d{6}\b/g, "[REDACTED:otp]");
  }
  return out;
}

/**
 * Best-effort string coercion + redaction for log payloads. Accepts the
 * raw `unknown` shape `console.error` would normally receive, and returns
 * either:
 *   - a `{ message, stack }` object for Error instances
 *   - a `{ message, fields }` object for non-Error objects with own keys
 *   - a plain redacted string for strings / primitives / unknown shapes
 *
 * Any string component is run through `redactSecrets`. Nested objects are
 * NOT walked recursively — most SDK errors put the leaky string in
 * `.message` / `.stack`, and a deep walk would risk perf regressions in
 * the hot path.
 */
export function redactForLog(
  value: unknown,
  opts?: { authContext?: boolean },
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactSecrets(value, opts);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) {
    const out: Record<string, unknown> = {
      name: value.name,
      message: redactSecrets(value.message ?? "", opts),
    };
    if (typeof value.stack === "string") {
      out.stack = redactSecrets(value.stack, opts);
    }
    // Carry over a known-safe subset of useful debugging fields.
    const code = (value as unknown as { code?: unknown }).code;
    if (typeof code === "string" || typeof code === "number") {
      out.code = code;
    }
    return out;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = redactSecrets(v, opts);
      else if (v instanceof Error) out[k] = redactForLog(v, opts);
      else out[k] = v;
    }
    return out;
  }
  return String(value);
}
