/**
 * Route-level test for /api/pools/check-deploy.
 *
 * Asserts:
 *   - unauthenticated users receive 401 with reason=authentication_required
 *   - the authenticated path returns the eligibility helper's result verbatim
 *
 * This is the *trust boundary* test — if the route ever stops calling
 * `supabase.auth.getUser()` or starts trusting a user_id from the request body,
 * F-02 regresses. The eligibility helper itself is exercised in
 * test/app/deploy-eligibility.test.ts; here we only verify the wiring.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Force the chain-id env to a valid testnet value before the route module
// imports `expected-chain.ts` (which throws in production without it).
process.env.NEXT_PUBLIC_EXPECTED_CHAIN_ID = "11155111";

// `vi.mock` factories are hoisted to the top of the file before any other
// code runs, so any value the factory closes over must also be hoisted.
// `vi.hoisted` is the supported way to express that.
const { getUserMock, checkDeployEligibilityMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  checkDeployEligibilityMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
    // The real eligibility helper would query these tables; we stub the
    // helper directly below so this client object only needs to exist.
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
          neq: async () => ({ count: 0, error: null }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/pools/deploy-eligibility", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/pools/deploy-eligibility")
  >("@/lib/pools/deploy-eligibility");
  return {
    ...actual,
    checkDeployEligibility: checkDeployEligibilityMock,
  };
});

vi.mock("@/lib/security/rate-limit", () => ({
  enforceRateLimits: async () => null,
}));

import { POST } from "@/app/api/pools/check-deploy/route";

function makeReq(): Request {
  return new Request("https://app.example/api/pools/check-deploy", {
    method: "POST",
  });
}

describe("POST /api/pools/check-deploy", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    checkDeployEligibilityMock.mockReset();
  });

  it("returns 401 with reason=authentication_required when no session", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await POST(makeReq());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({
      allowed: false,
      plan: "free",
      deployedPoolCount: 0,
      freePoolLimit: 2,
      reason: "authentication_required",
    });
    expect(checkDeployEligibilityMock).not.toHaveBeenCalled();
    const output = warnSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("api.auth_required");
  });

  it("returns the helper's allowed result for an authenticated free user under the limit", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-a" } } });
    checkDeployEligibilityMock.mockResolvedValue({
      allowed: true,
      plan: "free",
      deployedPoolCount: 1,
      freePoolLimit: 2,
    });
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.allowed).toBe(true);
    expect(body.plan).toBe("free");
    expect(body.deployedPoolCount).toBe(1);

    // Critical: the route must pass the user id from the SESSION, not from
    // any request body. There's no request body here, so this just confirms
    // the call shape.
    expect(checkDeployEligibilityMock).toHaveBeenCalledWith(expect.anything(), {
      userId: "user-a",
      chainId: 11155111,
    });
  });

  it("returns blocked result for an authenticated free user at the limit", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-b" } } });
    checkDeployEligibilityMock.mockResolvedValue({
      allowed: false,
      plan: "free",
      deployedPoolCount: 2,
      freePoolLimit: 2,
      reason: "free_pool_limit_reached",
    });
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.allowed).toBe(false);
    expect(body.reason).toBe("free_pool_limit_reached");
  });

  it("returns 500 with sanitized error when the helper throws", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-c" } } });
    checkDeployEligibilityMock.mockRejectedValue(new Error("db down"));
    const res = await POST(makeReq());
    expect(res.status).toBe(500);
    const body = await res.json();
    // publicErrorResponse hides internals behind a stable message.
    expect(body.error).toBe("Unable to verify deploy eligibility");
    expect(JSON.stringify(body)).not.toContain("db down");
  });
});
