import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      upsert: async () => ({ error: null }),
      update: () => ({ eq: async () => ({ error: null }) }),
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
      }),
    }),
  }),
}));

const mockConstructEvent = vi.fn(() => {
  throw new Error("No signatures found matching the expected signature");
});
vi.mock("@/lib/stripe/server", () => ({
  getStripe: () => ({
    webhooks: { constructEvent: mockConstructEvent },
    subscriptions: { retrieve: async () => ({}) },
  }),
}));

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test_placeholder");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("/api/stripe/webhook", () => {
  it("rejects requests with no stripe-signature header", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const res = await POST(
      new Request("https://app.example/api/stripe/webhook", {
        method: "POST",
        body: "{}",
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Unable to verify webhook");
  });

  it("rejects requests with an invalid stripe-signature", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const res = await POST(
      new Request("https://app.example/api/stripe/webhook", {
        method: "POST",
        body: "{}",
        headers: { "stripe-signature": "t=1,v1=deadbeef" },
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    // Public message is opaque — does NOT include the raw "No signatures found..." Stripe error.
    expect(body.error).toBe("Unable to verify webhook");
    expect(body.error).not.toContain("signature");
    expect(body.error).not.toContain("Stripe");
  });

  it("returns 500 with opaque message when STRIPE_WEBHOOK_SECRET is unset", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const res = await POST(
      new Request("https://app.example/api/stripe/webhook", {
        method: "POST",
        body: "{}",
        headers: { "stripe-signature": "t=1,v1=deadbeef" },
      }),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Service unavailable");
    expect(body.error).not.toContain("STRIPE_WEBHOOK_SECRET");
  });
});
