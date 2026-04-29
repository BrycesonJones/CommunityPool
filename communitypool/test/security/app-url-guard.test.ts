import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getAppUrl production guard", () => {
  it("returns the URL with trailing slash trimmed", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.communitypool.example/");
    const { getAppUrl } = await import("@/lib/stripe/server");
    expect(getAppUrl()).toBe("https://app.communitypool.example");
  });

  it("allows http://localhost in non-production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    const { getAppUrl } = await import("@/lib/stripe/server");
    expect(getAppUrl()).toBe("http://localhost:3000");
  });

  it("rejects http://localhost in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    const { getAppUrl } = await import("@/lib/stripe/server");
    expect(() => getAppUrl()).toThrow(/Invalid production NEXT_PUBLIC_APP_URL/);
  });

  it("throws when env var is unset", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    const { getAppUrl } = await import("@/lib/stripe/server");
    expect(() => getAppUrl()).toThrow(/NEXT_PUBLIC_APP_URL is not set/);
  });
});
