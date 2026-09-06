/**
 * Regression guard for the Phase 1 monetization migration.
 *
 * CommunityPool has no subscription product: no Free/Pro tiers, no Stripe
 * integration, no per-plan pool ceiling. These source-level assertions fail
 * CI if any of that is reintroduced, and pin the database migration that
 * retires the billing tables.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const APP_SOURCE_DIRS = ["app", "components", "lib", "scripts"].map((d) =>
  path.join(repoRoot, d),
);

// lib/security/redact.ts and scripts/scan-bundle-secrets.mjs keep generic
// payment-provider-shaped secret patterns as log/bundle hygiene. They are
// not part of a billing product, so they are allowed to mention the vendor.
const SECRET_HYGIENE_ALLOWLIST = new Set([
  "lib/security/redact.ts",
  "lib/security/public-error.ts",
  "scripts/scan-bundle-secrets.mjs",
]);

function sourceFiles(): Array<{ rel: string; src: string }> {
  return APP_SOURCE_DIRS.flatMap((dir) =>
    fs.existsSync(dir) ? walk(dir) : [],
  ).map((full) => ({
    rel: path.relative(repoRoot, full),
    src: fs.readFileSync(full, "utf8"),
  }));
}

describe("no subscription / plan gate remains in application code", () => {
  const files = sourceFiles();

  it("does not import the Stripe SDK or a lib/stripe module anywhere", () => {
    const offenders = files
      .filter(({ src }) => /from\s+["']stripe["']|from\s+["']@\/lib\/stripe/.test(src))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("does not depend on the stripe package", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    expect(pkg.dependencies?.stripe).toBeUndefined();
    expect(pkg.devDependencies?.stripe).toBeUndefined();
  });

  it("does not reference the retired billing tables", () => {
    const offenders = files
      .filter(({ src }) => /user_billing_state|stripe_processed_events/.test(src))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("does not define plan constants or a pool-count ceiling", () => {
    const offenders = files
      .filter(({ src }) =>
        /FREE_PLAN|PRO_PLAN|FREE_POOL_LIMIT|isProActive|free_pool_limit_reached/.test(src),
      )
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("does not reference the retired Stripe routes, billing pages, or pricing page", () => {
    const offenders = files
      .filter(({ src }) => /\/api\/stripe\/|\/billing\/(start|success|cancel)|href=["']\/pricing["']/.test(src))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
    expect(fs.existsSync(path.join(repoRoot, "app/api/stripe"))).toBe(false);
    expect(fs.existsSync(path.join(repoRoot, "app/billing"))).toBe(false);
    expect(fs.existsSync(path.join(repoRoot, "app/pricing"))).toBe(false);
    expect(fs.existsSync(path.join(repoRoot, "lib/stripe"))).toBe(false);
  });

  it("does not render subscription-era copy", () => {
    const offenders = files
      .filter(({ rel }) => !SECRET_HYGIENE_ALLOWLIST.has(rel))
      .filter(({ src }) =>
        /Upgrade to Pro|Manage subscription|\$20\s*\/\s*month|\$20 per month|Free plan limit/i.test(src),
      )
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("only mentions the vendor in secret-hygiene modules", () => {
    const offenders = files
      .filter(({ rel }) => !SECRET_HYGIENE_ALLOWLIST.has(rel))
      .filter(({ src }) => /stripe/i.test(src))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("does not read retired billing environment variables", () => {
    const offenders = files
      .filter(({ rel }) => !SECRET_HYGIENE_ALLOWLIST.has(rel))
      .filter(({ src }) => /process\.env\.(STRIPE_|NEXT_PUBLIC_STRIPE_|NEXT_PUBLIC_APP_URL)/.test(src))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });
});

describe("Fees page and route", () => {
  it("ships app/fees/page.tsx and redirects /pricing to /fees", () => {
    expect(fs.existsSync(path.join(repoRoot, "app/fees/page.tsx"))).toBe(true);
    const cfg = fs.readFileSync(path.join(repoRoot, "next.config.ts"), "utf8");
    expect(cfg).toMatch(/source:\s*"\/pricing",\s*destination:\s*"\/fees"/);
  });

  it("no longer allows the Stripe payment origin in Permissions-Policy", () => {
    const cfg = fs.readFileSync(path.join(repoRoot, "next.config.ts"), "utf8");
    expect(cfg).not.toMatch(/js\.stripe\.com/);
    expect(cfg).toMatch(/payment=\(\)/);
  });
});

describe("billing tables are retired by an explicit migration", () => {
  const migration = fs.readFileSync(
    path.join(
      repoRoot,
      "supabase/migrations/20260905120000_drop_stripe_billing_tables.sql",
    ),
    "utf8",
  );

  it("drops stripe_processed_events", () => {
    expect(migration).toMatch(
      /drop table if exists\s+public\.stripe_processed_events/i,
    );
  });

  it("drops user_billing_state", () => {
    expect(migration).toMatch(/drop table if exists\s+public\.user_billing_state/i);
  });

  it("removes the billing tables from the generated Database types", () => {
    const types = fs.readFileSync(
      path.join(repoRoot, "lib/supabase/database.types.ts"),
      "utf8",
    );
    expect(types).not.toMatch(/user_billing_state|stripe_processed_events/);
  });
});
