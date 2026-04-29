import { beforeEach, describe, expect, it, vi } from "vitest";

const shared = vi.hoisted(() => ({
  // Mocks intentionally accept the same args as the real pool.isOwner(addr)
  // and admin.from(...).upsert(rows) so call-site assertions can read them.
  // The leading-underscore names tell eslint the args are deliberate.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  isOwnerImpl: vi.fn(async (_candidate?: string) => false),
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  upsert: vi.fn(async (_rows: unknown) => ({ error: null })),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user_1" } } }) },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({ upsert: shared.upsert }),
  }),
}));

vi.mock("@/lib/security/rate-limit", () => ({
  enforceRateLimits: async () => null,
}));

vi.mock("@/lib/onchain/server-providers", () => ({
  getServerReadOnlyProviderForChain: () => ({}),
}));

vi.mock("ethers", async () => {
  const actual = await vi.importActual<typeof import("ethers")>("ethers");
  class MockContract {
    async getOwner() {
      return "0x1111111111111111111111111111111111111111";
    }
    async isOwner(candidate: string) {
      return shared.isOwnerImpl(candidate);
    }
  }
  return {
    ...actual,
    Contract: MockContract,
  };
});

describe("POST /api/pools/owners exceptional handling", () => {
  beforeEach(() => {
    shared.isOwnerImpl.mockReset();
    shared.upsert.mockClear();
  });

  it("rejects non-owner candidates without writing them", async () => {
    shared.isOwnerImpl.mockResolvedValue(false);
    const { POST } = await import("@/app/api/pools/owners/route");
    const res = await POST(
      new Request("https://app.example/api/pools/owners", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chainId: 1,
          poolAddress: "0x1234567890123456789012345678901234567890",
          candidates: ["0x2222222222222222222222222222222222222222"],
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(shared.upsert).toHaveBeenCalledTimes(1);
    const firstCall = shared.upsert.mock.calls.at(0);
    const rows = ((firstCall ? firstCall[0] : []) ?? []) as Array<{
      owner_address: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].owner_address).toBe(
      "0x1111111111111111111111111111111111111111",
    );
  });

  it("returns 502 when candidate verification RPC fails", async () => {
    shared.isOwnerImpl.mockRejectedValue(new Error("rpc unavailable"));
    const { POST } = await import("@/app/api/pools/owners/route");
    const res = await POST(
      new Request("https://app.example/api/pools/owners", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chainId: 1,
          poolAddress: "0x1234567890123456789012345678901234567890",
          candidates: ["0x2222222222222222222222222222222222222222"],
        }),
      }),
    );
    expect(res.status).toBe(502);
    expect(shared.upsert).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({
      error: "Unable to verify pool ownership",
    });
  });
});
