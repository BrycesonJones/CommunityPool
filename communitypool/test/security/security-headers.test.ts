import { describe, expect, it } from "vitest";
import nextConfig from "@/next.config";

describe("next.config.ts security headers", () => {
  it("declares a headers() hook that covers all paths", async () => {
    expect(nextConfig.headers).toBeTypeOf("function");
    const headers = await nextConfig.headers!();
    expect(headers).toBeInstanceOf(Array);
    expect(headers[0]?.source).toBe("/:path*");
  });

  it("sets HSTS, XFO, nosniff, Referrer-Policy, Permissions-Policy, COOP", async () => {
    const headers = await nextConfig.headers!();
    const flat = new Map(
      headers
        .flatMap((h) => h.headers ?? [])
        .map((kv: { key: string; value: string | undefined }) => [
          kv.key.toLowerCase(),
          kv.value,
        ]),
    );

    expect(flat.get("strict-transport-security")).toMatch(/max-age=\d+/);
    expect(flat.get("strict-transport-security")).toMatch(/includeSubDomains/);
    expect(flat.get("x-content-type-options")).toBe("nosniff");
    expect(flat.get("x-frame-options")).toBe("DENY");
    expect(flat.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(flat.get("permissions-policy")).toBeTruthy();
    expect(flat.get("cross-origin-opener-policy")).toBe("same-origin");
  });

  it("does not declare a wildcard CORS allow-origin", async () => {
    const headers = await nextConfig.headers!();
    const allValues = headers
      .flatMap((h) => h.headers ?? [])
      .map((kv: { key: string; value: string | undefined }) => kv.value ?? "");
    for (const v of allValues) {
      expect(v).not.toContain("Access-Control-Allow-Origin: *");
    }
  });
});
