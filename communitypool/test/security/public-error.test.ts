import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publicError, publicErrorResponse } from "@/lib/security/public-error";

const SENSITIVE_HAYSTACK = [
  "supabase://internal",
  "PostgrestError: relation \"user_profiles\" does not exist",
  "StripeAuthenticationError: Invalid API Key sk_test_DEADBEEF",
  "JsonRpcError: invalid params at eth_call",
  "TypeError: Cannot read properties of undefined\n    at <anonymous> (file://lib/foo.ts:42:11)",
  "JWT eyJhbGciOi.payload.sig",
];

describe("publicError sanitization", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the fallback string, not the internal message", () => {
    for (const internal of SENSITIVE_HAYSTACK) {
      const out = publicError(new Error(internal), "Service unavailable");
      expect(out.error).toBe("Service unavailable");
      expect(out.error).not.toContain("supabase");
      expect(out.error).not.toContain("Stripe");
      expect(out.error).not.toContain("JsonRpc");
      expect(out.error).not.toContain("eth_call");
      expect(out.error).not.toContain("eyJ");
      expect(out.error).not.toContain("sk_test_");
      expect(out.error).not.toMatch(/at <anonymous>/);
    }
  });

  it("logs the redacted error to console.error so operators can debug", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const internal = new Error("internal-only message");
    publicError(internal, "Service unavailable");
    // We log a redacted view of the Error rather than the raw object so any
    // secret-shaped substring in `.message` / `.stack` is masked before it
    // reaches a hosted log collector. Operators still see name + message.
    expect(spy).toHaveBeenCalledTimes(1);
    const arg = spy.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.name).toBe("Error");
    expect(arg.message).toBe("internal-only message");
  });

  it("redacts secret-shaped substrings in the logged error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const internal = new Error(
      "stripe verify failed for whsec_46e4096adb53e309427184fcd24b2c60",
    );
    publicError(internal, "Service unavailable");
    const arg = spy.mock.calls[0][0] as Record<string, unknown>;
    expect(String(arg.message)).toContain("[REDACTED:stripe-webhook-secret]");
    expect(String(arg.message)).not.toContain("whsec_");
  });

  it("publicErrorResponse returns a NextResponse with the requested status", async () => {
    const res = publicErrorResponse(new Error("internal"), "Invalid request", 400);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "Invalid request" });
  });
});
