import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [],
    set: () => {},
  }),
}));

const mockExchange = vi.fn();
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
  mockExchange.mockReset();
  mockExchange.mockResolvedValue({ error: null });
});

afterEach(async () => {
  const rl = await import("@/lib/security/rate-limit");
  rl.__resetRateLimitForTests();
  vi.unstubAllEnvs();
});

async function callCallback(query: string): Promise<Response> {
  const { GET } = await import("@/app/auth/callback/route");
  return GET(new Request(`https://app.example/auth/callback?${query}`));
}

describe("/auth/callback — error handling and next preservation", () => {
  it("missing code redirects to /login?error=oauth_no_code without consulting Supabase", async () => {
    const res = await callCallback("");
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("error")).toBe("oauth_no_code");
    expect(mockExchange).not.toHaveBeenCalled();
  });

  it("provider-side error redirects with a stable code, not the raw description", async () => {
    const res = await callCallback(
      "error=access_denied&error_description=" +
        encodeURIComponent("User denied <script>alert(1)</script>"),
    );
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("error")).toBe("oauth_provider");
    // Provider's raw description must NOT be reflected in the URL.
    expect(location.search).not.toContain("alert");
    expect(location.search).not.toContain("<script>");
    expect(mockExchange).not.toHaveBeenCalled();
  });

  it("Supabase exchange failure redirects with error=auth and preserves a safe next", async () => {
    mockExchange.mockResolvedValueOnce({ error: new Error("bad code") });
    const res = await callCallback(
      "code=valid&next=" + encodeURIComponent("/account"),
    );
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("error")).toBe("auth");
    expect(location.searchParams.get("next")).toBe("/account");
  });

  it("error redirect strips an unsafe next (collapses to /dashboard) and omits the param", async () => {
    const res = await callCallback(
      "error=access_denied&next=" + encodeURIComponent("//evil.com"),
    );
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("error")).toBe("oauth_provider");
    // Malicious `next` collapsed to /dashboard by safeNextPath, then dropped
    // from the URL since it equals the default — no off-origin URL surfaces.
    expect(location.searchParams.get("next")).toBeNull();
  });

  it("does not leak the OAuth code in the redirected Location URL", async () => {
    mockExchange.mockResolvedValueOnce({ error: new Error("bad code") });
    const res = await callCallback("code=very-secret-code&next=/dashboard");
    const location = res.headers.get("location") ?? "";
    expect(location).not.toContain("very-secret-code");
    expect(location).not.toContain("code=");
  });

  it("preserves the original happy-path redirect for a successful exchange", async () => {
    const res = await callCallback(
      "code=valid&next=" + encodeURIComponent("/account"),
    );
    const location = res.headers.get("location") ?? "";
    expect(location).toBe("https://app.example/account");
    expect(mockExchange).toHaveBeenCalledTimes(1);
  });
});
