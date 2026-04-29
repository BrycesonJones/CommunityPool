import { describe, it, expect, vi } from "vitest";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  applySubscriptionToBillingState,
  fetchBillingStateForUser,
  isProActive,
  markSubscriptionCanceled,
  persistStripeCustomerId,
  resolveUserIdForCustomer,
} from "@/lib/stripe/subscription";

/**
 * OWASP A01 regression: every Stripe code path must read/write
 * `user_billing_state`, never `user_profiles`. The webhook signature is the
 * only source of truth for these fields and the row is service-role-only at
 * the DB layer. These unit tests assert the table the helpers actually
 * target so a future refactor cannot silently re-route through user_profiles.
 */

type Captured = {
  table: string | null;
  upsert: unknown[];
  update: unknown[];
};

function createCapturingAdmin(opts: {
  fetchSingle?: { data: unknown; error: { message: string } | null };
}): { client: SupabaseClient<Database>; captured: Captured } {
  const captured: Captured = { table: null, upsert: [], update: [] };
  const fetchResult = opts.fetchSingle ?? { data: null, error: null };

  const builder: Record<string, unknown> = {};
  builder.upsert = (row: unknown) => {
    captured.upsert.push(row);
    return { error: null };
  };
  builder.update = (row: unknown) => {
    captured.update.push(row);
    // The post-A08-F-01 implementation chains
    // `.update(...).eq("user_id", ...).eq("stripe_subscription_id", ...)` for
    // defence-in-depth. Make `.eq()` self-chaining so any number of calls
    // resolves to `{ error: null }` when awaited.
    type UpdateChain = {
      eq: (...args: unknown[]) => UpdateChain;
      error: null;
    };
    const chain: UpdateChain = {
      error: null,
      eq: () => chain,
    };
    return chain;
  };
  builder.select = () => ({
    eq: () => ({
      maybeSingle: async () => fetchResult,
    }),
  });

  const client = {
    from: (table: string) => {
      captured.table = table;
      return builder;
    },
  } as unknown as SupabaseClient<Database>;

  return { client, captured };
}

function makeStripeSubscription(overrides?: Partial<Stripe.Subscription>): Stripe.Subscription {
  const base = {
    id: "sub_test_123",
    status: "active" as Stripe.Subscription.Status,
    customer: "cus_test_abc",
    cancel_at_period_end: false,
    metadata: { interval: "monthly" },
    items: {
      data: [
        {
          current_period_end: 1893456000, // 2030-01-01
          price: { recurring: { interval: "month" } },
        } as unknown as Stripe.SubscriptionItem,
      ],
    } as Stripe.ApiList<Stripe.SubscriptionItem>,
  };
  return { ...base, ...overrides } as unknown as Stripe.Subscription;
}

describe("isProActive", () => {
  // Fixed reference time so period_end comparisons are deterministic.
  const NOW = Date.parse("2026-04-27T12:00:00Z");
  const FUTURE = "2026-05-27T12:00:00Z";
  const PAST = "2026-03-27T12:00:00Z";

  it("returns false for null/undefined billing state (free user)", () => {
    expect(isProActive(null, NOW)).toBe(false);
    expect(isProActive(undefined, NOW)).toBe(false);
  });

  it("returns true for plan=pro + status=active + period_end in the future", () => {
    expect(
      isProActive(
        {
          subscription_plan: "pro",
          subscription_status: "active",
          subscription_current_period_end: FUTURE,
        },
        NOW,
      ),
    ).toBe(true);
  });

  it("returns true for plan=pro + status=trialing + period_end in the future", () => {
    expect(
      isProActive(
        {
          subscription_plan: "pro",
          subscription_status: "trialing",
          subscription_current_period_end: FUTURE,
        },
        NOW,
      ),
    ).toBe(true);
  });

  it("returns false for plan=pro + status=canceled (lapsed)", () => {
    expect(
      isProActive(
        {
          subscription_plan: "pro",
          subscription_status: "canceled",
          subscription_current_period_end: FUTURE,
        },
        NOW,
      ),
    ).toBe(false);
  });

  it("returns false for plan=free regardless of status", () => {
    expect(
      isProActive(
        {
          subscription_plan: "free",
          subscription_status: "active",
          subscription_current_period_end: FUTURE,
        },
        NOW,
      ),
    ).toBe(false);
  });

  // OWASP A06 F-05: cache freshness alone is not enough. A missed
  // `customer.subscription.deleted` would otherwise grant permanent Pro
  // access. The predicate must time-bound entitlement on period_end.
  it("returns false when subscription_current_period_end is missing", () => {
    expect(
      isProActive(
        {
          subscription_plan: "pro",
          subscription_status: "active",
          subscription_current_period_end: null,
        },
        NOW,
      ),
    ).toBe(false);
  });

  it("returns false when subscription_current_period_end is in the past", () => {
    expect(
      isProActive(
        {
          subscription_plan: "pro",
          subscription_status: "active",
          subscription_current_period_end: PAST,
        },
        NOW,
      ),
    ).toBe(false);
  });

  it("returns false when subscription_current_period_end is unparseable", () => {
    expect(
      isProActive(
        {
          subscription_plan: "pro",
          subscription_status: "active",
          subscription_current_period_end: "not-a-date",
        },
        NOW,
      ),
    ).toBe(false);
  });
});

describe("applySubscriptionToBillingState", () => {
  it("upserts into user_billing_state (not user_profiles)", async () => {
    const { client, captured } = createCapturingAdmin({});
    await applySubscriptionToBillingState({
      admin: client,
      userId: "11111111-1111-1111-1111-111111111111",
      customerId: "cus_test_abc",
      subscription: makeStripeSubscription(),
    });
    expect(captured.table).toBe("user_billing_state");
    expect(captured.upsert).toHaveLength(1);
    expect(captured.update).toHaveLength(0);
  });

  it("keys the upsert on user_id (not on profile id)", async () => {
    const { client, captured } = createCapturingAdmin({});
    await applySubscriptionToBillingState({
      admin: client,
      userId: "22222222-2222-2222-2222-222222222222",
      customerId: "cus_xyz",
      subscription: makeStripeSubscription(),
    });
    const row = captured.upsert[0] as { user_id: string; stripe_customer_id: string };
    expect(row.user_id).toBe("22222222-2222-2222-2222-222222222222");
    expect(row.stripe_customer_id).toBe("cus_xyz");
  });

  it("derives subscription_plan='pro' from active status", async () => {
    const { client, captured } = createCapturingAdmin({});
    await applySubscriptionToBillingState({
      admin: client,
      userId: "u",
      customerId: "cus_a",
      subscription: makeStripeSubscription({ status: "active" }),
    });
    const row = captured.upsert[0] as { subscription_plan: string };
    expect(row.subscription_plan).toBe("pro");
  });

  it("derives subscription_plan='free' from canceled status", async () => {
    const { client, captured } = createCapturingAdmin({});
    await applySubscriptionToBillingState({
      admin: client,
      userId: "u",
      customerId: "cus_a",
      subscription: makeStripeSubscription({ status: "canceled" }),
    });
    const row = captured.upsert[0] as { subscription_plan: string };
    expect(row.subscription_plan).toBe("free");
  });
});

describe("markSubscriptionCanceled", () => {
  // The function now reads the row first to confirm the deleted subscription
  // matches what's on file (OWASP A08 F-01: out-of-order Stripe retries).
  // Tests stub `console.warn` for the no-op branches to keep test output clean.

  it("downgrades on user_billing_state when the subscription_id matches the cached row", async () => {
    const { client, captured } = createCapturingAdmin({
      fetchSingle: {
        data: { stripe_subscription_id: "sub_test_123" },
        error: null,
      },
    });
    const result = await markSubscriptionCanceled({
      admin: client,
      userId: "u",
      subscriptionId: "sub_test_123",
    });
    expect(result.downgraded).toBe(true);
    expect(captured.table).toBe("user_billing_state");
    const row = captured.update[0] as {
      subscription_plan: string;
      subscription_status: string;
      stripe_subscription_id: string | null;
      subscription_cancel_at_period_end: boolean;
    };
    expect(row.subscription_plan).toBe("free");
    expect(row.subscription_status).toBe("canceled");
    expect(row.stripe_subscription_id).toBeNull();
    expect(row.subscription_cancel_at_period_end).toBe(false);
  });

  it("ignores a stale subscription_id (out-of-order delete preserves the new active subscription)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client, captured } = createCapturingAdmin({
      // The cached row already has the *new* subscription; an old delete
      // arriving late must NOT downgrade.
      fetchSingle: {
        data: { stripe_subscription_id: "sub_NEW" },
        error: null,
      },
    });
    const result = await markSubscriptionCanceled({
      admin: client,
      userId: "u",
      subscriptionId: "sub_OLD",
    });
    expect(result.downgraded).toBe(false);
    expect(captured.update).toHaveLength(0);
    warnSpy.mockRestore();
  });

  it("returns downgraded:false when no billing row exists for the user", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client, captured } = createCapturingAdmin({
      fetchSingle: { data: null, error: null },
    });
    const result = await markSubscriptionCanceled({
      admin: client,
      userId: "u",
      subscriptionId: "sub_test_123",
    });
    expect(result.downgraded).toBe(false);
    expect(captured.update).toHaveLength(0);
    warnSpy.mockRestore();
  });

  it("returns downgraded:false when the row already has no subscription (replay/idempotent)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client, captured } = createCapturingAdmin({
      fetchSingle: {
        data: { stripe_subscription_id: null },
        error: null,
      },
    });
    const result = await markSubscriptionCanceled({
      admin: client,
      userId: "u",
      subscriptionId: "sub_test_123",
    });
    expect(result.downgraded).toBe(false);
    expect(captured.update).toHaveLength(0);
    warnSpy.mockRestore();
  });
});

describe("resolveUserIdForCustomer", () => {
  // OWASP A08 F-06: stored (stripe_customer_id → user_id) mapping is now the
  // source of truth. Metadata is only used to seed brand-new customers. A
  // mismatched metadata.user_id is logged but does NOT re-bind billing state.

  it("returns the metadata user_id when no stored mapping exists (new-customer seed path)", async () => {
    const { client, captured } = createCapturingAdmin({
      // No row yet for this customer.
      fetchSingle: { data: null, error: null },
    });
    const userId = await resolveUserIdForCustomer({
      admin: client,
      customerId: "cus_a",
      metadataUserId: "trusted-user-id",
    });
    expect(userId).toBe("trusted-user-id");
    // The lookup still runs (DB-first), but no row exists so we fall back.
    expect(captured.table).toBe("user_billing_state");
  });

  it("skips the DB lookup entirely when no customerId is supplied", async () => {
    const { client, captured } = createCapturingAdmin({});
    const userId = await resolveUserIdForCustomer({
      admin: client,
      customerId: null,
      metadataUserId: "trusted-user-id",
    });
    expect(userId).toBe("trusted-user-id");
    expect(captured.table).toBeNull();
  });

  it("uses the stored customer→user mapping when one exists, ignoring metadata", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client, captured } = createCapturingAdmin({
      fetchSingle: { data: { user_id: "stored-user" }, error: null },
    });
    const userId = await resolveUserIdForCustomer({
      admin: client,
      customerId: "cus_a",
      // Attacker-controlled metadata claiming a different user must NOT
      // re-bind the customer. Stored mapping wins.
      metadataUserId: "attacker-user",
    });
    expect(userId).toBe("stored-user");
    expect(captured.table).toBe("user_billing_state");
    // Mismatch is logged.
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("falls back to user_billing_state lookup when metadata is absent", async () => {
    const { client, captured } = createCapturingAdmin({
      fetchSingle: { data: { user_id: "looked-up-user" }, error: null },
    });
    const userId = await resolveUserIdForCustomer({
      admin: client,
      customerId: "cus_a",
      metadataUserId: null,
    });
    expect(userId).toBe("looked-up-user");
    expect(captured.table).toBe("user_billing_state");
  });

  it("returns null when neither metadata nor a matching customer row exists", async () => {
    const { client } = createCapturingAdmin({
      fetchSingle: { data: null, error: null },
    });
    const userId = await resolveUserIdForCustomer({
      admin: client,
      customerId: "cus_unknown",
      metadataUserId: null,
    });
    expect(userId).toBeNull();
  });
});

describe("persistStripeCustomerId", () => {
  it("upserts the customer id into user_billing_state", async () => {
    const { client, captured } = createCapturingAdmin({});
    await persistStripeCustomerId({
      admin: client,
      userId: "u",
      customerId: "cus_new_one",
    });
    expect(captured.table).toBe("user_billing_state");
    const row = captured.upsert[0] as { user_id: string; stripe_customer_id: string };
    expect(row.user_id).toBe("u");
    expect(row.stripe_customer_id).toBe("cus_new_one");
  });
});

describe("fetchBillingStateForUser", () => {
  it("queries user_billing_state for the given user", async () => {
    const billingRow = {
      user_id: "u",
      stripe_customer_id: "cus_a",
      stripe_subscription_id: "sub_a",
      subscription_status: "active",
      subscription_plan: "pro",
      subscription_current_period_end: "2030-01-01T00:00:00Z",
      subscription_cancel_at_period_end: false,
      subscription_interval: "monthly",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    const { client, captured } = createCapturingAdmin({
      fetchSingle: { data: billingRow, error: null },
    });
    const row = await fetchBillingStateForUser({ admin: client, userId: "u" });
    expect(captured.table).toBe("user_billing_state");
    expect(row?.stripe_customer_id).toBe("cus_a");
    expect(row?.subscription_plan).toBe("pro");
  });
});
