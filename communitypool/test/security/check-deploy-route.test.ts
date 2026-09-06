/**
 * Route-level test for /api/pools/check-deploy.
 *
 * Asserts:
 *   - unauthenticated users receive 401 with reason=authentication_required
 *   - the authenticated path returns the eligibility helper's result verbatim,
 *     and that result is `allowed: true` for any pool count — there is no
 *     plan, subscription, or pool-limit gate
 *   - the user id passed to the helper comes from the SESSION, never from
 *     the request body
 *
 * This is the *trust boundary* test — if the route ever stops calling
 * `supabase.auth.getUser()` or starts trusting a user_id from the request
 * body, the auth preflight regresses. The eligibility helper itself is
 * exercised in test/app/deploy-eligibility.test.ts; here we only verify the
 * wiring.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.NEXT_PUBLIC_EXPECTED_CHAIN_ID = "11155111";

const { getUserMock, checkDeployEligibilityMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  checkDeployEligibilityMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: async () => ({ count: 0, error: null }),
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

function makeReq(body?: unknown): Request {
  return new Request("https://app.example/api/pools/check-deploy", {
    method: "POST",
    ...(body !== undefined
      ? {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
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
      deployedPoolCount: 0,
      reason: "authentication_required",
    });
    expect(checkDeployEligibilityMock).not.toHaveBeenCalled();
    const output = warnSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("api.auth_required");
  });

  it.each([0, 1, 2, 3, 40])(
    "returns allowed=true for an authenticated user with %i pools",
    async (deployedPoolCount) => {
      getUserMock.mockResolvedValue({ data: { user: { id: "user-a" } } });
      checkDeployEligibilityMock.mockResolvedValue({
        allowed: true,
        deployedPoolCount,
      });
      const res = await POST(makeReq());
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ allowed: true, deployedPoolCount });
      // No plan / tier / limit fields in the contract.
      expect(body).not.toHaveProperty("plan");
      expect(body).not.toHaveProperty("freePoolLimit");
      expect(body).not.toHaveProperty("reason");

      expect(checkDeployEligibilityMock).toHaveBeenCalledWith(expect.anything(), {
        userId: "user-a",
        chainId: 11155111,
      });
    },
  );

  it("ignores any user_id or chain_id supplied in the request body", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "session-user" } } });
    checkDeployEligibilityMock.mockResolvedValue({
      allowed: true,
      deployedPoolCount: 0,
    });
    const res = await POST(
      makeReq({ userId: "attacker", user_id: "attacker", chainId: 1, chain_id: 1 }),
    );
    expect(res.status).toBe(200);
    expect(checkDeployEligibilityMock).toHaveBeenCalledWith(expect.anything(), {
      userId: "session-user",
      chainId: 11155111,
    });
  });

  it("returns 500 with sanitized error when the helper throws", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-c" } } });
    checkDeployEligibilityMock.mockRejectedValue(new Error("db down"));
    const res = await POST(makeReq());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Unable to verify deploy eligibility");
    expect(JSON.stringify(body)).not.toContain("db down");
  });
});
