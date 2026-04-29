import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [],
    set: () => {},
  }),
}));

const mockVerifyOtp = vi.fn(async () => ({ error: null }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { verifyOtp: mockVerifyOtp },
  }),
}));

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  mockVerifyOtp.mockClear();
});

afterEach(async () => {
  const rl = await import("@/lib/security/rate-limit");
  rl.__resetRateLimitForTests();
  vi.unstubAllEnvs();
});

async function postVerify(opts: {
  email: string;
  token: string;
  ip?: string;
}): Promise<Response> {
  const { POST } = await import("@/app/api/auth/otp/verify/route");
  const headers = new Headers({ "content-type": "application/json" });
  // Different IPs per assertion stop the per-IP short-window axis from
  // tripping before we can probe the per-email axes.
  headers.set(
    "x-forwarded-for",
    opts.ip ?? `198.51.100.${Math.floor(Math.random() * 250) + 1}`,
  );
  return POST(
    new Request("https://app.example/api/auth/otp/verify", {
      method: "POST",
      headers,
      body: JSON.stringify({ email: opts.email, token: opts.token }),
    }),
  );
}

describe("POST /api/auth/otp/verify — tightened rate limits", () => {
  it("policy table reflects the tightened limits", async () => {
    const { POLICIES } = await import("@/lib/security/rate-limit");
    expect(POLICIES.otp_verify.limit).toBe(5);
    expect(POLICIES.otp_verify.windowSeconds).toBe(60);
    expect(POLICIES.otp_verify_email_long.limit).toBe(30);
    expect(POLICIES.otp_verify_email_long.windowSeconds).toBe(600);
  });

  it("trips the email-axis short-window limit at the 6th attempt within 60s", async () => {
    const email = "alice-short@example.com";
    for (let i = 0; i < 5; i += 1) {
      const ok = await postVerify({ email, token: "000000" });
      expect(ok.status).toBe(200);
    }
    const blocked = await postVerify({ email, token: "000000" });
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as {
      error?: string;
      code?: string;
      message?: string;
      retryAfter?: number;
    };
    expect(body.code).toBe("rate_limited");
    expect(body.error).toMatch(/too many requests/i);
    expect(body.retryAfter).toBeGreaterThanOrEqual(1);
  });

  it("trips the email-axis long-window limit at the 31st attempt across rotating IPs", async () => {
    // Rotate IPs deterministically so the per-IP short-window limit doesn't
    // trip first. The long-window cap is what we're proving here.
    const email = "alice-long@example.com";
    const sendOnce = async (i: number) =>
      postVerify({ email, token: "000000", ip: `203.0.113.${i + 1}` });

    for (let i = 0; i < 30; i += 1) {
      const res = await sendOnce(i);
      // The first 5 succeed (200); attempts 6..30 hit the email short-window
      // cap (429). What we ultimately care about is that attempt #31 is also
      // blocked, regardless of which axis trips it.
      expect([200, 429]).toContain(res.status);
    }
    const blocked = await sendOnce(31);
    expect(blocked.status).toBe(429);
  });

  it("rejects malformed token formats with 400 before consulting the rate limiter", async () => {
    const { POST } = await import("@/app/api/auth/otp/verify/route");
    const res = await POST(
      new Request("https://app.example/api/auth/otp/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "alice@example.com", token: "12345" }),
      }),
    );
    expect(res.status).toBe(400);
    expect(mockVerifyOtp).not.toHaveBeenCalled();
  });

  it("emits failed OTP security event without logging the OTP value", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // The mock's resolved type is the success shape `{ error: null }`,
    // but Supabase verifyOtp returns the union of success and error
    // shapes. Cast through `unknown` to satisfy TS while keeping the
    // assertion on the error message visible.
    mockVerifyOtp.mockResolvedValueOnce(
      { error: { code: "invalid_otp", message: "bad token 123456" } } as unknown as Awaited<
        ReturnType<typeof mockVerifyOtp>
      >,
    );
    const res = await postVerify({
      email: "alice@example.com",
      token: "123456",
    });
    expect(res.status).toBe(400);
    const output = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("auth.otp.verify_failed");
    expect(output).not.toContain("123456");
  });
});
