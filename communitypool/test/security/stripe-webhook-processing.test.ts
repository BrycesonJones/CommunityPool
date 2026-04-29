import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const shared = vi.hoisted(() => {
  const constructEvent = vi.fn();
  const resolveUser = vi.fn();
  const applyBilling = vi.fn(async () => {});
  const cancelBilling = vi.fn(async () => {});
  const processedInsert = vi.fn(async () => ({ error: null as { code?: string } | null }));
  return {
    constructEvent,
    resolveUser,
    applyBilling,
    cancelBilling,
    processedInsert,
  };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "stripe_processed_events") {
        return {
          insert: shared.processedInsert,
          update: () => ({ eq: async () => ({ error: null }) }),
          select: () => {
            const q = {
              neq: () => q,
              order: () => q,
              limit: () => q,
              eq: () => q,
              maybeSingle: async () => ({ data: null, error: null }),
            };
            return q;
          },
        };
      }
      if (table === "user_billing_state") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
      return {};
    },
  }),
}));

vi.mock("@/lib/stripe/server", () => ({
  getStripe: () => ({
    webhooks: { constructEvent: shared.constructEvent },
    subscriptions: {
      retrieve: async () =>
        ({
          id: "sub_test",
          status: "active",
          customer: "cus_test",
          cancel_at_period_end: false,
          metadata: {},
          items: {
            data: [
              {
                current_period_end: 1_893_456_000,
                price: { recurring: { interval: "month" } },
              },
            ],
          },
        }) as unknown,
    },
  }),
}));

vi.mock("@/lib/stripe/subscription", () => ({
  resolveUserIdForCustomer: shared.resolveUser,
  applySubscriptionToBillingState: shared.applyBilling,
  markSubscriptionCanceled: shared.cancelBilling,
}));

describe("/api/stripe/webhook processing", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test_placeholder");
    shared.constructEvent.mockReset();
    shared.resolveUser.mockReset();
    shared.applyBilling.mockReset();
    shared.cancelBilling.mockReset();
    shared.processedInsert.mockReset();
    shared.processedInsert.mockResolvedValue({ error: null });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns 500 when a required mapping cannot be resolved", async () => {
    shared.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          customer: "cus_test",
          subscription: "sub_test",
          client_reference_id: null,
          metadata: {},
        },
      },
    });
    shared.resolveUser.mockResolvedValue(null);

    const { POST } = await import("@/app/api/stripe/webhook/route");
    const res = await POST(
      new Request("https://app.example/api/stripe/webhook", {
        method: "POST",
        body: "{}",
        headers: { "stripe-signature": "t=1,v1=good" },
      }),
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Webhook processing failed");
    expect(body.error).not.toContain("Stripe");
    expect(console.error).toHaveBeenCalled();
  });

  it("returns 200 when mapping resolves and processing succeeds", async () => {
    shared.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          customer: "cus_test",
          subscription: "sub_test",
          client_reference_id: "user_123",
          metadata: {},
        },
      },
    });
    shared.resolveUser.mockResolvedValue("user_123");

    const { POST } = await import("@/app/api/stripe/webhook/route");
    const res = await POST(
      new Request("https://app.example/api/stripe/webhook", {
        method: "POST",
        body: "{}",
        headers: { "stripe-signature": "t=1,v1=good" },
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ received: true });
    expect(shared.applyBilling).toHaveBeenCalledTimes(1);
  });

  it("returns 200 for duplicate already-processed payloads", async () => {
    shared.constructEvent.mockReturnValue({
      id: "evt_dup_1",
      type: "customer.subscription.updated",
      data: {
        object: {
          customer: "cus_test",
          metadata: { user_id: "user_123" },
        },
      },
    });
    shared.resolveUser.mockResolvedValue("user_123");

    const { POST } = await import("@/app/api/stripe/webhook/route");
    const req = () =>
      new Request("https://app.example/api/stripe/webhook", {
        method: "POST",
        body: "{}",
        headers: { "stripe-signature": "t=1,v1=good" },
      });

    const first = await POST(req());
    shared.processedInsert.mockResolvedValueOnce({
      error: { code: "23505", message: "duplicate" } as { code: string; message: string },
    });
    const second = await POST(req());
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  it("returns 400 for forged/invalid signatures", async () => {
    shared.constructEvent.mockImplementation(() => {
      throw new Error("bad stripe signature");
    });
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const res = await POST(
      new Request("https://app.example/api/stripe/webhook", {
        method: "POST",
        body: "{}",
        headers: { "stripe-signature": "bad" },
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Unable to verify webhook");
    expect(body.error).not.toContain("signature");
  });
});
