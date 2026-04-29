import { beforeEach, describe, expect, it, vi } from "vitest";

const shared = vi.hoisted(() => ({
  getProPriceIdForInterval: vi.fn((interval: "monthly" | "yearly") =>
    interval === "yearly" ? "price_year" : "price_month",
  ),
  checkoutCreate: vi.fn(async () => ({ url: "https://checkout.stripe.test/session" })),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user_1", email: "u@example.com" } } }) },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "user_profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { email: "u@example.com", username: "user" },
                error: null,
              }),
            }),
          }),
          insert: () => ({
            select: () => ({
              single: async () => ({
                data: { email: "u@example.com", username: "user" },
                error: null,
              }),
            }),
          }),
        };
      }
      return {};
    },
  }),
}));

vi.mock("@/lib/stripe/subscription", () => ({
  fetchBillingStateForUser: async () => ({ stripe_customer_id: "cus_123" }),
  persistStripeCustomerId: async () => {},
}));

vi.mock("@/lib/security/rate-limit", () => ({
  enforceRateLimits: async () => null,
}));

vi.mock("@/lib/stripe/server", () => ({
  getAppUrl: () => "https://app.example",
  getProPriceIdForInterval: shared.getProPriceIdForInterval,
  getStripe: () => ({
    checkout: {
      sessions: {
        create: shared.checkoutCreate,
      },
    },
  }),
}));

describe("POST /api/stripe/create-checkout-session", () => {
  beforeEach(() => {
    shared.getProPriceIdForInterval.mockClear();
    shared.checkoutCreate.mockClear();
  });

  it("returns 400 for malformed JSON", async () => {
    const { POST } = await import("@/app/api/stripe/create-checkout-session/route");
    const res = await POST(
      new Request("https://app.example/api/stripe/create-checkout-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{invalid",
      }),
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "Invalid request",
      code: "invalid_request",
    });
  });

  it("returns 400 for invalid interval", async () => {
    const { POST } = await import("@/app/api/stripe/create-checkout-session/route");
    const res = await POST(
      new Request("https://app.example/api/stripe/create-checkout-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ interval: "weekly" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("defaults missing body to monthly", async () => {
    const { POST } = await import("@/app/api/stripe/create-checkout-session/route");
    const res = await POST(
      new Request("https://app.example/api/stripe/create-checkout-session", {
        method: "POST",
      }),
    );
    expect(res.status).toBe(200);
    expect(shared.getProPriceIdForInterval).toHaveBeenCalledWith("monthly");
  });

  it("accepts monthly and yearly intervals", async () => {
    const { POST } = await import("@/app/api/stripe/create-checkout-session/route");

    const monthly = await POST(
      new Request("https://app.example/api/stripe/create-checkout-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ interval: "monthly" }),
      }),
    );
    const yearly = await POST(
      new Request("https://app.example/api/stripe/create-checkout-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ interval: "yearly" }),
      }),
    );

    expect(monthly.status).toBe(200);
    expect(yearly.status).toBe(200);
    expect(shared.getProPriceIdForInterval).toHaveBeenCalledWith("monthly");
    expect(shared.getProPriceIdForInterval).toHaveBeenCalledWith("yearly");
  });
});
