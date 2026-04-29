import { afterEach, describe, expect, it, vi } from "vitest";
import { securityEvent } from "@/lib/security/security-event";

describe("securityEvent redaction", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redacts JWT, Stripe secrets, webhook secrets, and Postgres URLs", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    securityEvent({
      event_type: "auth.test",
      severity: "critical",
      route: "/api/auth/otp/verify",
      safe_message:
        "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4eHgifQ.bogus-signature sk_test_ABCDEF1234567890 whsec_ABCDEF1234567890 postgresql://postgres:pw@db.example.com:5432/db",
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const payload = String(spy.mock.calls[0][0]);
    expect(payload).toContain("[REDACTED:jwt]");
    expect(payload).toContain("[REDACTED:stripe-secret-test]");
    expect(payload).toContain("[REDACTED:stripe-webhook-secret]");
    expect(payload).toContain("[REDACTED:postgres-url]");
    expect(payload).not.toContain("sk_test_ABCDEF1234567890");
    expect(payload).not.toContain("whsec_ABCDEF1234567890");
    expect(payload).not.toContain("postgresql://postgres:pw@db.example.com:5432/db");
  });

  it("redacts OTP-like values in auth contexts", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    securityEvent({
      event_type: "auth.otp.verify_failed",
      severity: "high",
      route: "/api/auth/otp/verify",
      safe_message: "Invalid token 123456 for user",
    });
    const payload = String(spy.mock.calls[0][0]);
    expect(payload).toContain("[REDACTED:otp]");
    expect(payload).not.toContain("123456");
  });

  it("never throws if logger fails", () => {
    vi.spyOn(console, "info").mockImplementation(() => {
      throw new Error("logger unavailable");
    });
    expect(() =>
      securityEvent({
        event_type: "test.info",
        severity: "info",
        safe_message: "ok",
      }),
    ).not.toThrow();
  });
});
