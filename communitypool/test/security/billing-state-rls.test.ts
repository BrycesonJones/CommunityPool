import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * OWASP A01 regression: billing/subscription state must not be reachable by
 * client-supplied JWT writes. The original `user_profiles` UPDATE policy
 * (`using/with check auth.uid() = id`) covered the whole row including
 * Stripe-controlled columns, so any logged-in user could PATCH
 * `subscription_plan='pro'` via PostgREST and self-elevate without paying.
 *
 * The fix has two halves and this test pins both:
 *   1. A new `user_billing_state` table whose RLS surface is read-own-only —
 *      no INSERT/UPDATE/DELETE policy is defined for the authenticated role,
 *      so RLS denies by default and only the service-role admin client (used
 *      by /api/stripe/* and the webhook) can write.
 *   2. `user_profiles` no longer carries the billing columns at all, so
 *      even though it keeps a row-scoped UPDATE policy for KYC fields, there
 *      is nothing billing-related left to PATCH.
 *
 * We assert both at the migration-source level so a future change that
 * accidentally re-introduces the vulnerability fails CI before it ever
 * reaches production. A live integration test against Supabase
 * (PATCH /rest/v1/user_billing_state ⇒ 401/403) is in
 * `docs/security/a01-billing-rls-live.md` for manual pre-launch verification.
 */

const MIGRATIONS_DIR = path.resolve(
  __dirname,
  "../../supabase/migrations",
);

function loadMigration(name: string): string {
  return readFileSync(path.join(MIGRATIONS_DIR, name), "utf8");
}

describe("user_billing_state RLS shape (A01 regression)", () => {
  const create = loadMigration(
    "20260427140000_user_billing_state_create.sql",
  );

  it("creates the user_billing_state table", () => {
    expect(create).toMatch(
      /create table if not exists\s+public\.user_billing_state/i,
    );
  });

  it("enables RLS on user_billing_state", () => {
    expect(create).toMatch(
      /alter table\s+public\.user_billing_state\s+enable row level security/i,
    );
  });

  it("defines a SELECT-own policy keyed on auth.uid() = user_id", () => {
    expect(create).toMatch(/for select/i);
    expect(create).toMatch(/using\s*\(\s*auth\.uid\(\)\s*=\s*user_id\s*\)/i);
  });

  it("does not define an INSERT policy for authenticated callers", () => {
    expect(create).not.toMatch(/create policy[\s\S]+?for insert/i);
  });

  it("does not define an UPDATE policy for authenticated callers", () => {
    expect(create).not.toMatch(/create policy[\s\S]+?for update/i);
  });

  it("does not define a DELETE policy for authenticated callers", () => {
    expect(create).not.toMatch(/create policy[\s\S]+?for delete/i);
  });

  it("does not grant blanket access via auth.role() = 'authenticated' for writes", () => {
    // Spot-check: SELECT may legitimately gate on the role elsewhere, but
    // the billing table specifically must not allow ANY write predicate
    // that resolves to "any authenticated user".
    const insertOrUpdateOrDelete = create.match(
      /for (insert|update|delete)[\s\S]*?(?=create policy|$)/gi,
    );
    expect(insertOrUpdateOrDelete).toBeNull();
  });

  it("backfills from user_profiles where stripe_customer_id is set", () => {
    expect(create).toMatch(
      /insert into public\.user_billing_state[\s\S]+?from public\.user_profiles[\s\S]+?stripe_customer_id is not null/i,
    );
  });

  it("uses ON CONFLICT DO NOTHING so re-running is safe", () => {
    expect(create).toMatch(/on conflict\s*\(\s*user_id\s*\)\s*do nothing/i);
  });
});

describe("user_profiles billing-column drop (A01 regression)", () => {
  const drop = loadMigration(
    "20260427140001_user_profiles_drop_billing_columns.sql",
  );

  for (const column of [
    "stripe_customer_id",
    "stripe_subscription_id",
    "subscription_status",
    "subscription_plan",
    "subscription_current_period_end",
    "subscription_cancel_at_period_end",
    "subscription_interval",
  ]) {
    it(`drops user_profiles.${column}`, () => {
      const re = new RegExp(
        `alter table\\s+public\\.user_profiles\\s+drop column if exists\\s+${column}`,
        "i",
      );
      expect(drop).toMatch(re);
    });
  }
});
