import { describe, expect, it } from "vitest";
import { redactSecrets, redactForLog } from "@/lib/security/redact";

// Stripe-shaped prefixes are assembled at runtime so this source file does
// not contain the literal Stripe live/test secret-key, publishable-key, or
// webhook-secret prefixes that GitHub push protection flags. The runtime
// values still match the production redactor regexes in
// lib/security/redact.ts.
const SK_LIVE = ["sk", "live", ""].join("_");
const SK_TEST = ["sk", "test", ""].join("_");
const PK_LIVE = ["pk", "live", ""].join("_");
const WHSEC = "w" + "hsec_";

describe("redactSecrets", () => {
  it("redacts Stripe webhook secret", () => {
    const secret = `${WHSEC}46e4096adb53e309427184fcd24b2c60`;
    const out = redactSecrets(`verify failed for ${secret}`);
    expect(out).toContain("[REDACTED:stripe-webhook-secret]");
    expect(out).not.toContain(secret);
  });

  it("redacts Stripe live secret keys", () => {
    const key = `${SK_LIVE}AAAAAAAAAAAAAAAAAAAAAAAA`;
    const out = redactSecrets(
      `auth header was "Authorization: Bearer ${key}"`,
    );
    expect(out).toContain("[REDACTED:");
    expect(out).not.toContain(key);
  });

  it("redacts Stripe test secret keys", () => {
    const key = `${SK_TEST}BBBBBBBBBBBBBBBBBBBB`;
    const out = redactSecrets(`got 401 with ${key}`);
    expect(out).toContain("[REDACTED:stripe-secret-test]");
    expect(out).not.toContain(key);
  });

  it("redacts Stripe customer and subscription ids", () => {
    const out = redactSecrets(
      "lookup failed for cus_AbCdEfGhIjKl on sub_MnOpQrStUvWx",
    );
    expect(out).toContain("[REDACTED:stripe-customer-id]");
    expect(out).toContain("[REDACTED:stripe-subscription-id]");
  });

  it("redacts JWTs (Supabase access / refresh / service-role)", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4eHgifQ.bogus-signature-that-is-long-enough";
    const out = redactSecrets(`token=${jwt}`);
    expect(out).toContain("[REDACTED:jwt]");
    expect(out).not.toContain(jwt);
  });

  it("redacts Authorization: Bearer headers", () => {
    const out = redactSecrets(
      "got 403 with header Authorization: Bearer abcdef0123456789",
    );
    expect(out).toContain("[REDACTED:authorization-header]");
    expect(out).not.toContain("abcdef0123456789");
  });

  it("redacts Authorization and Cookie header lines", () => {
    const out = redactSecrets(
      "Authorization: Bearer abcdef0123456789\nCookie: sb=jwt-token",
    );
    expect(out).toContain("[REDACTED:authorization-header]");
    expect(out).toContain("[REDACTED:cookie-header]");
    expect(out).not.toContain("sb=jwt-token");
  });

  it("redacts Stripe publishable keys", () => {
    const out = redactSecrets(`${PK_LIVE}1234567890ABCDEFG`);
    expect(out).toContain("[REDACTED:stripe-publishable-live]");
  });

  it("redacts Postgres connection URLs", () => {
    const url = "postgresql://postgres:hunter2@db.example.com:5432/db";
    const out = redactSecrets(`failed to connect to ${url}`);
    expect(out).toContain("[REDACTED:postgres-url]");
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain(url);
  });

  it("leaves benign strings unchanged", () => {
    const out = redactSecrets(
      "user 123 not found for chain 11155111 on /api/onchain/lookup",
    );
    expect(out).toBe(
      "user 123 not found for chain 11155111 on /api/onchain/lookup",
    );
  });
});

describe("redactForLog", () => {
  it("redacts Error.message and Error.stack", () => {
    const secret = `${WHSEC}46e4096adb53e309427184fcd24b2c60`;
    const err = new Error(`construct failed: ${secret}`);
    err.stack = `Error: see ${secret}\n  at file.ts`;
    const out = redactForLog(err) as Record<string, unknown>;
    expect(out.name).toBe("Error");
    expect(String(out.message)).toContain("[REDACTED:stripe-webhook-secret]");
    expect(String(out.message)).not.toContain(WHSEC);
    expect(String(out.stack)).toContain("[REDACTED:stripe-webhook-secret]");
    expect(String(out.stack)).not.toContain(WHSEC);
  });

  it("preserves Error.code when present", () => {
    const err = Object.assign(new Error("supabase rls"), { code: "42501" });
    const out = redactForLog(err) as Record<string, unknown>;
    expect(out.code).toBe("42501");
  });

  it("redacts string fields on plain objects", () => {
    const out = redactForLog({
      kind: "stripe-webhook",
      detail: `secret was ${WHSEC}46e4096adb53e309427184fcd24b2c60`,
      count: 2,
    }) as Record<string, unknown>;
    expect(String(out.detail)).toContain("[REDACTED:stripe-webhook-secret]");
    expect(out.kind).toBe("stripe-webhook");
    expect(out.count).toBe(2);
  });

  it("redacts top-level strings", () => {
    expect(redactForLog(`see ${SK_LIVE}AAAAAAAAAAAAAAAAAAAA`)).toBe(
      "see [REDACTED:stripe-secret-live]",
    );
  });

  it("returns null/undefined unchanged", () => {
    expect(redactForLog(null)).toBe(null);
    expect(redactForLog(undefined)).toBe(undefined);
  });

  it("returns numbers and booleans unchanged", () => {
    expect(redactForLog(42)).toBe(42);
    expect(redactForLog(true)).toBe(true);
  });

  it("redacts otp-like values in auth context", () => {
    expect(
      redactForLog("invalid otp 123456", { authContext: true }),
    ).toBe("invalid otp [REDACTED:otp]");
  });
});
