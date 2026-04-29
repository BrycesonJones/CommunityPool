import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockGetUser = vi.fn();
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser },
  }),
}));

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  mockGetUser.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function run(pathname: string): Promise<Response> {
  const { updateSession } = await import("@/lib/supabase/middleware");
  const url = `https://app.example${pathname}`;
  return updateSession(new NextRequest(url));
}

describe("middleware updateSession — protected route coverage", () => {
  describe("when the user is unauthenticated", () => {
    beforeEach(() => {
      mockGetUser.mockResolvedValue({ data: { user: null } });
    });

    it.each([
      "/dashboard",
      "/dashboard/anything/here",
      "/account",
      "/account/security",
      "/pools",
      "/pools/0xabc",
      "/api-keys",
      "/documents",
      "/documents/x",
    ])("redirects %s to /login?next=<path>", async (pathname) => {
      const res = await run(pathname);
      expect(res.status).toBe(307);
      const location = res.headers.get("location") ?? "";
      const url = new URL(location);
      expect(url.pathname).toBe("/login");
      expect(url.searchParams.get("next")).toBe(pathname);
    });

    it.each(["/", "/pricing", "/login", "/signup", "/auth/verify", "/privacy"])(
      "passes through public path %s without redirecting",
      async (pathname) => {
        const res = await run(pathname);
        // No redirect — Supabase response or a passthrough NextResponse.
        const location = res.headers.get("location");
        expect(location === null || !location.includes("/login?next=")).toBe(
          true,
        );
      },
    );

    it("does not match a path that merely contains a protected segment elsewhere", async () => {
      // "/foo/dashboard" must NOT be considered protected — only "/dashboard"
      // and its subtree are. Guards against a sloppy `includes()` check.
      const res = await run("/foo/dashboard");
      const location = res.headers.get("location");
      expect(location === null || !location.includes("/login?next=")).toBe(
        true,
      );
    });
  });

  describe("when the user is authenticated", () => {
    beforeEach(() => {
      mockGetUser.mockResolvedValue({
        data: { user: { id: "u-1", email: "alice@example.com" } },
      });
    });

    it("does not redirect /dashboard", async () => {
      const res = await run("/dashboard");
      const location = res.headers.get("location");
      expect(location === null || !location.includes("/login")).toBe(true);
    });

    it("does not redirect /account", async () => {
      const res = await run("/account");
      const location = res.headers.get("location");
      expect(location === null || !location.includes("/login")).toBe(true);
    });
  });

  describe("when Supabase public config is missing in production", () => {
    beforeEach(() => {
      vi.stubEnv("NODE_ENV", "production");
      mockGetUser.mockResolvedValue({ data: { user: null } });
    });

    it.each([
      {
        label: "missing Supabase URL",
        env: {
          NEXT_PUBLIC_SUPABASE_URL: "",
          NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
        },
      },
      {
        label: "missing Supabase anon key",
        env: {
          NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
          NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
        },
      },
    ])("$label fails closed on protected routes", async ({ env }) => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", env.NEXT_PUBLIC_SUPABASE_URL);
      vi.stubEnv(
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      );
      for (const pathname of [
        "/dashboard",
        "/account",
        "/pools",
        "/api-keys",
        "/documents",
      ]) {
        const res = await run(pathname);
        expect(res.status).toBe(503);
        await expect(res.text()).resolves.toContain(
          "Authentication service unavailable.",
        );
      }
    });

    it("does not block a public path", async () => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
      const res = await run("/pricing");
      expect(res.status).not.toBe(503);
    });
  });
});
