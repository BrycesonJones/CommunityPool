/**
 * OWASP A08 F-02 — route-level guard test for /api/pools/record-deployment.
 *
 * Trust boundaries this exercises:
 *   - 401 when no Supabase session (the user_id MUST come from the cookie,
 *     never from the body)
 *   - 400 when chainId differs from the build's expected chain (so a
 *     client cannot record cross-chain pools to bypass the env-pinned
 *     deploy gate)
 *   - 400 on malformed body fields before the on-chain verifier runs
 *   - on a verified happy path, the helper is called with the session
 *     user id (not anything from the body)
 *
 * The on-chain verifier itself (`recordVerifiedDeployment`) has its own
 * unit tests in test/app/pool-deployment-service.test.ts; here we mock it
 * out and just confirm the route wires identity + chain pinning correctly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Pin the env BEFORE the route imports `expected-chain`, otherwise the
// helper throws in production-like configurations.
process.env.NEXT_PUBLIC_EXPECTED_CHAIN_ID = "11155111";

const { getUserMock, recordMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  recordMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({}),
}));

vi.mock("@/lib/pools/pool-deployment-service", () => ({
  recordVerifiedDeployment: recordMock,
}));

vi.mock("@/lib/security/rate-limit", () => ({
  enforceRateLimits: async () => null,
}));

import { POST } from "@/app/api/pools/record-deployment/route";

const VALID_BODY = {
  chainId: 11155111,
  poolAddress: "0x1234567890123456789012345678901234567890",
  deployTxHash: "0x" + "a".repeat(64),
};

function makeRequest(body: unknown): Request {
  return new Request("https://app.example/api/pools/record-deployment", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/pools/record-deployment", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    recordMock.mockReset();
  });

  it("returns 401 when no session — never reaches the verifier", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(401);
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed JSON body", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-a" } } });
    const res = await POST(makeRequest("{not-json"));
    expect(res.status).toBe(400);
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("returns 400 when poolAddress is malformed", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-a" } } });
    const res = await POST(
      makeRequest({ ...VALID_BODY, poolAddress: "not-an-address" }),
    );
    expect(res.status).toBe(400);
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("returns 400 when deployTxHash is malformed", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-a" } } });
    const res = await POST(
      makeRequest({ ...VALID_BODY, deployTxHash: "0xshort" }),
    );
    expect(res.status).toBe(400);
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("rejects a chainId that differs from the build's expected chain", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-a" } } });
    // The build expects 11155111 (Sepolia); refuse anything else, even if
    // valid for ledger schema. This prevents a client on a mainnet build
    // from recording Sepolia deploys (or vice-versa).
    const res = await POST(makeRequest({ ...VALID_BODY, chainId: 1 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("chainId");
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("forwards verifier 'tx_pending' as 202 so the client can retry", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-a" } } });
    recordMock.mockResolvedValue({
      ok: false,
      reason: "tx_pending",
      message: "tx is in mempool but not yet mined",
    });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.reason).toBe("tx_pending");
  });

  it("forwards verifier 'no_provider' as 503", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-a" } } });
    recordMock.mockResolvedValue({
      ok: false,
      reason: "no_provider",
      message: "no rpc",
    });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(503);
  });

  it("forwards other verifier rejections as 400", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-a" } } });
    recordMock.mockResolvedValue({
      ok: false,
      reason: "tx_reverted",
      message: "deploy tx reverted",
    });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toBe("tx_reverted");
  });

  it("on a verified deploy, calls the helper with the session user id (NOT the body)", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-from-session" } } });
    recordMock.mockResolvedValue({ ok: true, status: "recorded", rowId: "r1" });
    // Even if the client *tries* to smuggle a different user_id, the route
    // ignores it (it's not in the parser) and uses the session. Cast to
    // unknown so the test compiles without a typed extra-field hack.
    const bodyWithExtra = {
      ...VALID_BODY,
      userId: "attacker-user",
    } as unknown as typeof VALID_BODY;
    const res = await POST(makeRequest(bodyWithExtra));
    expect(res.status).toBe(200);
    expect(recordMock).toHaveBeenCalledTimes(1);
    expect(recordMock).toHaveBeenCalledWith(expect.anything(), {
      userId: "user-from-session",
      chainId: VALID_BODY.chainId,
      poolAddress: VALID_BODY.poolAddress,
      deployTxHash: VALID_BODY.deployTxHash,
    });
  });

  it("returns ok=true for an idempotent re-call (already_recorded)", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-a" } } });
    recordMock.mockResolvedValue({
      ok: true,
      status: "already_recorded",
      rowId: "existing",
    });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("already_recorded");
  });
});
