import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [],
    set: () => {},
  }),
}));

const mockExchange = vi.fn(async () => ({ error: null }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { exchangeCodeForSession: mockExchange },
  }),
}));

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  mockExchange.mockClear();
});

afterEach(async () => {
  const rl = await import("@/lib/security/rate-limit");
  rl.__resetRateLimitForTests();
  vi.unstubAllEnvs();
});

async function callCallback(query: string): Promise<Response> {
  const { GET } = await import("@/app/auth/callback/route");
  const url = `https://app.example/auth/callback?${query}`;
  return GET(new Request(url));
}

describe("/auth/callback redirect validation", () => {
  it("redirects to /dashboard when next is //evil.com", async () => {
    const res = await callCallback(
      "code=valid&next=" + encodeURIComponent("//evil.com"),
    );
    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toBe("https://app.example/dashboard");
  });

  it("redirects to /dashboard when next is https://evil.com", async () => {
    const res = await callCallback(
      "code=valid&next=" + encodeURIComponent("https://evil.com"),
    );
    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toBe("https://app.example/dashboard");
  });

  it("redirects to /dashboard when next is /\\evil.com", async () => {
    const res = await callCallback(
      "code=valid&next=" + encodeURIComponent("/\\evil.com"),
    );
    const location = res.headers.get("location") ?? "";
    expect(location).toBe("https://app.example/dashboard");
  });

  it("redirects to /dashboard when next is %2F%2Fevil.com (double-encoded //)", async () => {
    const res = await callCallback("code=valid&next=%252F%252Fevil.com");
    const location = res.headers.get("location") ?? "";
    expect(location).toBe("https://app.example/dashboard");
  });

  it("preserves valid same-origin paths", async () => {
    const res = await callCallback(
      "code=valid&next=" + encodeURIComponent("/account"),
    );
    const location = res.headers.get("location") ?? "";
    expect(location).toBe("https://app.example/account");
  });

  it("redirects to /dashboard and does not inject Set-Cookie when next contains CRLF", async () => {
    const res = await callCallback(
      "code=valid&next=/dashboard%0d%0aSet-Cookie:%20pwn=1",
    );
    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toBe("https://app.example/dashboard");
    // No header named Set-Cookie should have been planted by the response.
    expect(res.headers.get("set-cookie")).toBeNull();
    // Any header value (including the Location) must not carry CR/LF bytes.
    for (const [, value] of res.headers) {
      expect(value).not.toMatch(/[\r\n]/);
    }
  });

  it("redirects to /dashboard when next contains a NUL byte", async () => {
    const res = await callCallback("code=valid&next=/dashboard%00evil");
    const location = res.headers.get("location") ?? "";
    expect(location).toBe("https://app.example/dashboard");
  });
});
