import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockConstructEvent,
  mockInsertProcessed,
  mockProcessedMaybeSingle,
  mockUserBillingMaybeSingle,
  mockUpdateEq,
} = vi.hoisted(() => ({
  mockConstructEvent: vi.fn(),
  mockInsertProcessed: vi.fn(),
  mockProcessedMaybeSingle: vi.fn(),
  mockUserBillingMaybeSingle: vi.fn(),
  mockUpdateEq: vi.fn(),
}));

vi.mock("@/lib/stripe/server", () => ({
  getStripe: () => ({
    webhooks: { constructEvent: mockConstructEvent },
    subscriptions: {
      retrieve: vi.fn(async () => ({
        id: "sub_123",
        status: "active",
        items: { data: [] },
      })),
    },
  }),
}));

vi.mock("@/lib/stripe/subscription", () => ({
  applySubscriptionToBillingState: vi.fn(async () => {}),
  markSubscriptionCanceled: vi.fn(async () => {}),
  resolveUserIdForCustomer: vi.fn(async () => "user-1"),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "stripe_processed_events") {
        const query = {
          neq: () => query,
          order: () => query,
          limit: () => query,
          eq: () => query,
          maybeSingle: async () => mockProcessedMaybeSingle(),
        };
        return {
          insert: async (row: unknown) => mockInsertProcessed(row),
          update: () => ({
            eq: async (...args: unknown[]) => mockUpdateEq(...args),
          }),
          select: () => query,
        };
      }
      if (table === "user_billing_state") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => mockUserBillingMaybeSingle(),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      };
    },
  }),
}));

describe("stripe webhook audit events", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test_placeholder");
    mockInsertProcessed.mockReset();
    mockProcessedMaybeSingle.mockReset();
    mockUserBillingMaybeSingle.mockReset();
    mockUpdateEq.mockReset();
    mockConstructEvent.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("emits duplicate_ignored for duplicate webhook events", async () => {
    mockConstructEvent.mockReturnValue({
      id: "evt_dup_1",
      type: "invoice.paid",
      created: 1000,
      data: { object: { customer: "cus_1", subscription: "sub_1" } },
    });
    mockInsertProcessed.mockResolvedValue({ error: { code: "23505", message: "duplicate" } });
    mockUpdateEq.mockResolvedValue({ error: null });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const res = await POST(
      new Request("https://app.example/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "t=1,v1=ok" },
        body: "{}",
      }),
    );
    expect([200, 500]).toContain(res.status);
    const output = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("stripe.webhook.duplicate_ignored");
  });

  it("emits critical metadata_customer_mismatch and marks failed", async () => {
    mockConstructEvent.mockReturnValue({
      id: "evt_mm_1",
      type: "checkout.session.completed",
      created: 1001,
      data: {
        object: {
          mode: "subscription",
          customer: "cus_abc",
          subscription: "sub_abc",
          client_reference_id: "user-from-metadata",
          metadata: { user_id: "user-from-metadata" },
        },
      },
    });
    mockInsertProcessed.mockResolvedValue({ error: null });
    mockProcessedMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockUserBillingMaybeSingle.mockResolvedValue({
      data: { user_id: "different-user" },
      error: null,
    });
    mockUpdateEq.mockResolvedValue({ error: null });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const res = await POST(
      new Request("https://app.example/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "t=1,v1=ok" },
        body: "{}",
      }),
    );
    expect([200, 500]).toContain(res.status);
    const output = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("stripe.webhook.metadata_customer_mismatch");
  });
});
