/**
 * Lightweight, dependency-free validators for inputs that cross a trust
 * boundary (API routes, Server Actions, anything that accepts JSON from a
 * client). The shape `Result<T> = { ok: true; value: T } | { ok: false; error }`
 * lets callers handle failures explicitly without throwing — useful in route
 * handlers that want to return a clean 400.
 *
 * These are intentionally "pull-as-needed" rather than a full Zod replacement.
 * Adopt them in new routes; do not refactor existing routes wholesale unless
 * the route is being touched for another reason.
 */

export type Ok<T> = { ok: true; value: T };
export type Err = { ok: false; error: string };
export type Result<T> = Ok<T> | Err;

const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
const err = (error: string): Err => ({ ok: false, error });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OTP_RE = /^\d{6}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVM_ADDR_RE = /^0x[a-fA-F0-9]{40}$/;
const TX_HASH_RE = /^0x[a-fA-F0-9]{64}$/;
const TOKEN_SYMBOL_RE = /^[A-Za-z0-9₮]{1,12}$/;
const USD_AMOUNT_RE = /^\d{1,9}(\.\d{1,8})?$/;
const CONTROL_CHARS_RE = /[\x00-\x1F\x7F]/;

export const SUPPORTED_CHAIN_IDS = [1, 11155111, 31337] as const;
export type SupportedChainId = (typeof SUPPORTED_CHAIN_IDS)[number];

export const POOL_NAME_MAX = 80;
export const POOL_DESCRIPTION_MAX = 500;
export const SAVED_ADDRESS_LABEL_MAX = 80;
export const EMAIL_MAX = 254;

export function parseEmail(raw: unknown): Result<string> {
  if (typeof raw !== "string") return err("email must be a string");
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return err("email is required");
  if (trimmed.length > EMAIL_MAX) return err("email is too long");
  if (!EMAIL_RE.test(trimmed)) return err("email is not a valid address");
  return ok(trimmed);
}

export function parseOtpCode(raw: unknown): Result<string> {
  if (typeof raw !== "string") return err("otp must be a string");
  const collapsed = raw.replace(/\s/g, "");
  if (!OTP_RE.test(collapsed)) return err("otp must be 6 digits");
  return ok(collapsed);
}

export function parseUuid(raw: unknown): Result<string> {
  if (typeof raw !== "string") return err("uuid must be a string");
  if (!UUID_RE.test(raw)) return err("not a valid uuid");
  return ok(raw.toLowerCase());
}

/**
 * Validate the *shape* of an EVM address. Callers that need a checksummed
 * representation should pass the result to `ethers.getAddress`; this module
 * intentionally has no `ethers` dependency.
 */
export function parseEvmAddress(raw: unknown): Result<string> {
  if (typeof raw !== "string") return err("address must be a string");
  if (!EVM_ADDR_RE.test(raw)) return err("not a valid EVM address");
  return ok(raw);
}

export function parseTxHash(raw: unknown): Result<string> {
  if (typeof raw !== "string") return err("tx hash must be a string");
  if (!TX_HASH_RE.test(raw)) return err("not a valid tx hash");
  return ok(raw.toLowerCase());
}

export function parseChainId(raw: unknown): Result<SupportedChainId> {
  const n = typeof raw === "number" ? raw : Number.NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    return err("chainId must be a positive integer");
  }
  if (!(SUPPORTED_CHAIN_IDS as readonly number[]).includes(n)) {
    return err(`chainId ${n} is not supported`);
  }
  return ok(n as SupportedChainId);
}

export function parseTokenSymbol(raw: unknown): Result<string> {
  if (typeof raw !== "string") return err("symbol must be a string");
  const trimmed = raw.trim();
  if (!TOKEN_SYMBOL_RE.test(trimmed)) return err("not a valid token symbol");
  return ok(trimmed);
}

/** USD amount as a decimal string. Rejects scientific notation, sign, etc. */
export function parseUsdAmount(raw: unknown): Result<string> {
  if (typeof raw !== "string") return err("amount must be a string");
  const trimmed = raw.trim();
  if (!USD_AMOUNT_RE.test(trimmed)) return err("not a valid USD amount");
  return ok(trimmed);
}

function trimmedBoundedText(
  raw: unknown,
  max: number,
  field: string,
): Result<string> {
  if (typeof raw !== "string") return err(`${field} must be a string`);
  const trimmed = raw.trim();
  if (trimmed.length > max) {
    return err(`${field} exceeds maximum of ${max} characters`);
  }
  if (CONTROL_CHARS_RE.test(trimmed)) {
    return err(`${field} contains control characters`);
  }
  return ok(trimmed);
}

export function parsePoolName(raw: unknown): Result<string> {
  const r = trimmedBoundedText(raw, POOL_NAME_MAX, "pool name");
  if (!r.ok) return r;
  if (r.value.length === 0) return err("pool name is required");
  return r;
}

export function parsePoolDescription(raw: unknown): Result<string> {
  return trimmedBoundedText(raw, POOL_DESCRIPTION_MAX, "pool description");
}

export function parseSavedAddressLabel(raw: unknown): Result<string> {
  return trimmedBoundedText(raw, SAVED_ADDRESS_LABEL_MAX, "label");
}

/**
 * Validate a same-origin redirect path fragment. Mirrors the rules in
 * `lib/auth/safe-next-path.ts` (which is the load-bearing copy used by
 * /auth/callback). This variant returns a Result so non-redirect callers can
 * surface a 400 instead of silently falling back to /dashboard.
 */
export function parseSafePathFragment(raw: unknown): Result<string> {
  if (typeof raw !== "string") return err("path must be a string");
  let candidate = raw;
  try {
    candidate = decodeURIComponent(candidate);
  } catch {
    return err("malformed percent-encoding");
  }
  if (CONTROL_CHARS_RE.test(candidate)) {
    return err("path contains control characters");
  }
  if (!candidate.startsWith("/")) return err("path must start with '/'");
  if (candidate.startsWith("//")) return err("path must not be protocol-relative");
  if (candidate.includes("\\")) return err("path must not contain a backslash");
  return ok(candidate);
}
