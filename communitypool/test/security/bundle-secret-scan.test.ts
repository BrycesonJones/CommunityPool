import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// `runScan` is the unit-testable entrypoint; the CLI's `main()` is exercised
// indirectly by setting up synthetic build trees and asserting the findings
// shape.
import { runScan } from "@/scripts/scan-bundle-secrets.mjs";

const REPO_ROOT = path.resolve(__dirname, "../..");

function makeFakeBuild(opts: {
  staticFiles?: Record<string, string>;
  serverFiles?: Record<string, string>;
}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cp-bundle-scan-"));
  const staticDir = path.join(tmp, ".next", "static");
  const serverDir = path.join(tmp, ".next", "server", "app");
  fs.mkdirSync(staticDir, { recursive: true });
  fs.mkdirSync(serverDir, { recursive: true });
  for (const [name, body] of Object.entries(opts.staticFiles ?? {})) {
    const target = path.join(staticDir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
  }
  for (const [name, body] of Object.entries(opts.serverFiles ?? {})) {
    const target = path.join(serverDir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
  }
  return tmp;
}

describe("bundle secret scanner", () => {
  let tmpRoots: string[] = [];
  beforeEach(() => {
    tmpRoots = [];
  });
  afterEach(() => {
    for (const root of tmpRoots) {
      try {
        fs.rmSync(root, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it("passes on a clean synthetic build", () => {
    const root = makeFakeBuild({
      staticFiles: { "chunks/main.js": 'console.log("hello world");' },
      serverFiles: { "page.js": 'export default function Page() {}' },
    });
    tmpRoots.push(root);
    const { browser, server } = runScan(root);
    expect(browser.findings).toEqual([]);
    expect(server.findings).toEqual([]);
  });

  it("flags forbidden env names embedded in the browser bundle", () => {
    const root = makeFakeBuild({
      staticFiles: {
        "chunks/leak.js":
          'const k = process.env.SUPABASE_SERVICE_ROLE_KEY; console.log(k);',
      },
    });
    tmpRoots.push(root);
    const { browser } = runScan(root);
    expect(browser.findings.length).toBe(1);
    const tokens = browser.findings[0].fileFindings.map((f: { token: string }) => f.token);
    expect(tokens).toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("flags Stripe live secret keys by value pattern", () => {
    const root = makeFakeBuild({
      staticFiles: {
        "chunks/leak.js":
          'const k = "sk_live_AAAAAAAAAAAAAAAAAAAAAAAA";',
      },
    });
    tmpRoots.push(root);
    const { browser } = runScan(root);
    expect(browser.findings.length).toBe(1);
    expect(
      browser.findings[0].fileFindings.some(
        (f: { token: string }) => f.token === "Stripe live secret key",
      ),
    ).toBe(true);
  });

  it("flags Stripe webhook secrets by value pattern", () => {
    const root = makeFakeBuild({
      staticFiles: {
        "chunks/leak.js":
          'const w = "whsec_AAAAAAAAAAAAAAAAAAAAAAAAAA";',
      },
    });
    tmpRoots.push(root);
    const { browser } = runScan(root);
    expect(browser.findings.length).toBe(1);
    expect(
      browser.findings[0].fileFindings.some(
        (f: { token: string }) => f.token === "Stripe webhook secret",
      ),
    ).toBe(true);
  });

  it("flags Postgres connection URLs in either surface", () => {
    const root = makeFakeBuild({
      staticFiles: {
        "chunks/leak.js":
          'const u = "postgresql://user:pass@db.example.com:5432/db";',
      },
      serverFiles: {
        "page.js":
          'const u = "postgres://user:pass@db.example.com:5432/db";',
      },
    });
    tmpRoots.push(root);
    const { browser, server } = runScan(root);
    expect(browser.findings.length).toBe(1);
    expect(server.findings.length).toBe(1);
  });

  it("flags Supabase service-role JWT only when 'service_role' is in the neighborhood", () => {
    const innocuous = makeFakeBuild({
      staticFiles: {
        // Plain JWT-shaped string with no service_role nearby — must NOT
        // trip (this is what the Supabase anon key looks like in source maps).
        "chunks/anon.js":
          'const t = "eyJABCDEFGHIJKLMNOP.QRSTUVWXYZabcdef.0123456789abcdef";',
      },
    });
    tmpRoots.push(innocuous);
    const innocuousFindings = runScan(innocuous).browser.findings;
    expect(innocuousFindings).toEqual([]);

    const leaky = makeFakeBuild({
      staticFiles: {
        // service-role key shape: literal "service_role" within the same
        // file as a JWT. Mirrors a careless `JSON.stringify` of a decoded
        // service-role token landing in a client component.
        "chunks/svc.js":
          'const decoded = {role:"service_role"}; const t = "eyJABCDEFGHIJKLMNOP.QRSTUVWXYZabcdef.0123456789abcdef";',
      },
    });
    tmpRoots.push(leaky);
    const leakyFindings = runScan(leaky).browser.findings;
    expect(leakyFindings.length).toBe(1);
    expect(
      leakyFindings[0].fileFindings.some(
        (f: { token: string }) => f.token === "service-role JWT",
      ),
    ).toBe(true);
  });

  it("flags DB-password env names in the server bundle even though it skips JWT/Stripe value patterns", () => {
    const root = makeFakeBuild({
      serverFiles: {
        "page.js":
          'const p = process.env.SUPABASE_Dev_Password; console.log(p);',
      },
    });
    tmpRoots.push(root);
    const { server } = runScan(root);
    expect(server.findings.length).toBe(1);
    expect(
      server.findings[0].fileFindings.some(
        (f: { kind: string; token: string }) =>
          f.kind === "name" && f.token === "SUPABASE_Dev_Password",
      ),
    ).toBe(true);
  });
});

// Live scan against the real .next/ if the developer has it built. Skipped
// when the build artifact is missing (vitest dev / CI without build).
describe("live build bundle scan", () => {
  const nextDir = path.join(REPO_ROOT, ".next");
  const buildExists = fs.existsSync(nextDir);
  describe.skipIf(!buildExists)("real .next/", () => {
    it("contains no forbidden secret names or value patterns", () => {
      const { browser, server } = runScan(REPO_ROOT);
      expect(
        browser.findings,
        "browser surface findings (.next/static)",
      ).toEqual([]);
      expect(
        server.findings,
        "server surface findings (.next/server/app)",
      ).toEqual([]);
    });
  });
});
