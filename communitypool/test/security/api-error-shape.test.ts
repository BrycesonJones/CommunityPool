import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../..");
const apiDir = path.join(repoRoot, "app", "api");

function listRouteFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listRouteFiles(full));
    else if (entry.name === "route.ts") out.push(full);
  }
  return out;
}

describe("API route source: no raw SDK error messages reach the client", () => {
  const routes = listRouteFiles(apiDir);

  it("finds at least one route to scan", () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  for (const route of routes) {
    it(`${path.relative(repoRoot, route)} does not return an interpolated error.message`, () => {
      const src = fs.readFileSync(route, "utf8");
      // Detect the historical leak pattern: returning a JSON body whose
      // `error` field is built from a template literal that includes
      // `error.message` / `err.message` / SDK-error fields.
      const leakyPattern =
        /error:\s*`[^`]*\$\{[^}]*\b(?:error|err|profileError|insertError)\b[^}]*\.message[^}]*\}/;
      expect(src).not.toMatch(leakyPattern);

      // Detect the simpler leak: `error: error.message` returned directly.
      const directLeak =
        /\berror:\s*(?:error|err|profileError|insertError)\.message\b/;
      expect(src).not.toMatch(directLeak);
    });
  }
});

describe("API route source: no wildcard CORS", () => {
  const routes = listRouteFiles(apiDir);
  for (const route of routes) {
    it(`${path.relative(repoRoot, route)} does not set Access-Control-Allow-Origin: *`, () => {
      const src = fs.readFileSync(route, "utf8");
      expect(src).not.toMatch(/Access-Control-Allow-Origin\s*['"]?:?\s*['"]?\*/);
    });
  }
});

describe("server-only secrets are not imported by client components", () => {
  it("admin/server modules are marked import 'server-only'", () => {
    const targets = [
      "lib/supabase/admin.ts",
      "lib/stripe/server.ts",
      "lib/onchain/server-providers.ts",
      "lib/security/rate-limit.ts",
      "lib/security/public-error.ts",
      // A04 hardening: these modules read ALCHEMY_API_KEY / ETHERSCAN_API_KEY /
      // ALCHEMY_API_URL_ETH_* and must throw at build time if pulled into a
      // client bundle.
      "lib/onchain/service.ts",
      "lib/onchain/networks.ts",
    ];
    for (const rel of targets) {
      const src = fs.readFileSync(path.join(repoRoot, rel), "utf8");
      expect(src).toMatch(/import\s+['"]server-only['"];?/);
    }
  });
});
