import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [],
    set: () => {},
  }),
}));

const mockSignInWithOtp = vi.fn(async () => ({ error: null }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { signInWithOtp: mockSignInWithOtp },
  }),
}));

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  mockSignInWithOtp.mockClear();
});

afterEach(async () => {
  const rl = await import("@/lib/security/rate-limit");
  rl.__resetRateLimitForTests();
  vi.unstubAllEnvs();
});

async function postOtp(body: unknown, headers?: HeadersInit): Promise<Response> {
  const { POST } = await import("@/app/api/auth/otp/send/route");
  // Headers vary per call so each test gets a fresh IP bucket — keeps the
  // per-IP rate limit from leaking between assertions in the same describe.
  const finalHeaders = new Headers(headers ?? {});
  finalHeaders.set("content-type", "application/json");
  if (!finalHeaders.has("x-forwarded-for")) {
    finalHeaders.set(
      "x-forwarded-for",
      `198.51.100.${Math.floor(Math.random() * 250) + 1}`,
    );
  }
  return POST(
    new Request("https://app.example/api/auth/otp/send", {
      method: "POST",
      body: JSON.stringify(body),
      headers: finalHeaders,
    }),
  );
}

function passedDataOption(): unknown {
  // signInWithOtp is invoked as ({ email, options: { shouldCreateUser, data? } })
  const calls = mockSignInWithOtp.mock.calls as unknown as Array<
    [{ options?: { data?: unknown } }]
  >;
  const last = calls.at(-1)?.[0];
  return last?.options?.data;
}

describe("POST /api/auth/otp/send — metadata allowlist", () => {
  it("succeeds with valid email and no metadata; never forwards a `data` option", async () => {
    const res = await postOtp({ email: "alice@example.com" });
    expect(res.status).toBe(200);
    expect(mockSignInWithOtp).toHaveBeenCalledTimes(1);
    expect(passedDataOption()).toBeUndefined();
  });

  it("succeeds with a valid username and forwards only { username }", async () => {
    const res = await postOtp({
      email: "alice@example.com",
      metadata: { username: "alice_42" },
    });
    expect(res.status).toBe(200);
    expect(passedDataOption()).toEqual({ username: "alice_42" });
  });

  it("trims surrounding whitespace from username before forwarding", async () => {
    const res = await postOtp({
      email: "alice@example.com",
      metadata: { username: "  alice_42  " },
    });
    expect(res.status).toBe(200);
    expect(passedDataOption()).toEqual({ username: "alice_42" });
  });

  it("rejects unsupported metadata keys (no silent stripping)", async () => {
    const res = await postOtp({
      email: "alice@example.com",
      metadata: { username: "alice", is_admin: true },
    });
    expect(res.status).toBe(400);
    expect(mockSignInWithOtp).not.toHaveBeenCalled();
  });

  it("rejects an HTML/script payload as username", async () => {
    const res = await postOtp({
      email: "alice@example.com",
      metadata: { username: "<img src=x onerror=alert(1)>" },
    });
    expect(res.status).toBe(400);
    expect(mockSignInWithOtp).not.toHaveBeenCalled();
  });

  it("rejects a username over 40 characters", async () => {
    const res = await postOtp({
      email: "alice@example.com",
      metadata: { username: "a".repeat(41) },
    });
    expect(res.status).toBe(400);
    expect(mockSignInWithOtp).not.toHaveBeenCalled();
  });

  it("rejects metadata sent as an array", async () => {
    const res = await postOtp({
      email: "alice@example.com",
      metadata: ["alice"],
    });
    expect(res.status).toBe(400);
    expect(mockSignInWithOtp).not.toHaveBeenCalled();
  });

  it("rejects metadata sent as a string/number/null", async () => {
    for (const bad of ["alice", 42, null]) {
      mockSignInWithOtp.mockClear();
      const res = await postOtp({
        email: "alice@example.com",
        metadata: bad,
      });
      expect(res.status).toBe(400);
      expect(mockSignInWithOtp).not.toHaveBeenCalled();
    }
  });

  it("rejects an empty username", async () => {
    const res = await postOtp({
      email: "alice@example.com",
      metadata: { username: "" },
    });
    expect(res.status).toBe(400);
    expect(mockSignInWithOtp).not.toHaveBeenCalled();
  });

  it("rejects username with disallowed characters (interior control / non-allowlisted)", async () => {
    // Interior CR/LF — trim() can't paper over this, USERNAME_RE refuses it.
    const res1 = await postOtp({
      email: "alice@example.com",
      metadata: { username: "alice\r\nbob" },
    });
    expect(res1.status).toBe(400);
    expect(mockSignInWithOtp).not.toHaveBeenCalled();

    // Spaces aren't in the allowlist either.
    const res2 = await postOtp({
      email: "alice@example.com",
      metadata: { username: "alice bob" },
    });
    expect(res2.status).toBe(400);
    expect(mockSignInWithOtp).not.toHaveBeenCalled();
  });

  it("treats an explicitly absent username key as no metadata (data option omitted)", async () => {
    const res = await postOtp({
      email: "alice@example.com",
      metadata: {},
    });
    expect(res.status).toBe(200);
    expect(passedDataOption()).toBeUndefined();
  });
});
