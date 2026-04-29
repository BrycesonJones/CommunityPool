/**
 * Free vs Pro pool deployment limits — server-side enforcement (OWASP A06 F-02).
 *
 * Pure-logic tests for `decideDeployEligibility` and integration tests for
 * `checkDeployEligibility` against a captured Supabase mock. The route handler
 * is exercised separately in test/security/check-deploy-route.test.ts.
 *
 * Architecture note (OWASP A08 F-02): the count is now read from the
 * service-role-only `user_pool_deployments` ledger, not from the
 * RLS-row-owner-writable `user_pool_activity` table. Rows land in the
 * ledger only after `recordVerifiedDeployment` has confirmed the deploy tx
 * on chain (status=1, contractAddress matches, bytecode at the address).
 * That means:
 *   - Required test 7 (deployed-but-funding-failed counts) is preserved by
 *     the upstream invariant: the ledger row is written when the deploy tx
 *     confirms, before any funding step.
 *   - Required test 8 (failed deploys with no contract address don't count)
 *     is preserved by the upstream verification: such tx's never reach the
 *     ledger. The test of that invariant lives in the deployment-service
 *     layer, not here. At the count layer we just verify "rows in the
 *     ledger count, rows not in the ledger don't."
 */

import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  checkDeployEligibility,
  countDeployedPools,
  decideDeployEligibility,
  FREE_POOL_LIMIT,
} from "@/lib/pools/deploy-eligibility";

type BillingRow = {
  subscription_plan: "free" | "pro";
  subscription_status: string;
  subscription_current_period_end: string | null;
} | null;

type DeploymentRow = { user_id: string; chain_id: number };

/**
 * Minimal Supabase mock that supports the two queries the eligibility helper
 * makes:
 *   - `from("user_billing_state").select(cols).eq("user_id", id).maybeSingle()`
 *   - `from("user_pool_deployments")
 *        .select("id", { count: "exact", head: true })
 *        .eq("user_id", id).eq("chain_id", n)`
 *
 * The chain after both `.eq()` calls is awaitable and resolves to
 * `{ count, error }`. The ledger is service-role-write-only and only ever
 * holds verified deploys (no empty addresses), so this mock doesn't model
 * the deprecated `.neq("pool_address", "")` filter.
 */
function createSupabaseMock(opts: {
  billing?: BillingRow;
  deployments?: DeploymentRow[];
  billingError?: { message: string };
  deploymentsError?: { message: string };
}): SupabaseClient<Database> {
  const billing = opts.billing ?? null;
  const deployments = opts.deployments ?? [];

  const billingBuilder = {
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({
          data: billing,
          error: opts.billingError ?? null,
        }),
      }),
    }),
  };

  const deploymentsBuilder = (() => {
    type Filter = { userId?: string; chainId?: number };
    const filter: Filter = {};
    function applyAndCount(): { count: number } {
      let rows = deployments;
      if (filter.userId !== undefined) {
        rows = rows.filter((r) => r.user_id === filter.userId);
      }
      if (filter.chainId !== undefined) {
        rows = rows.filter((r) => r.chain_id === filter.chainId);
      }
      return { count: rows.length };
    }
    // Self-chaining `.eq()` that's awaitable at the second call.
    type ChainResult = { count: number; error: { message: string } | null };
    type Chain = {
      eq: (col: string, value: unknown) => Chain;
      then: (
        resolve: (v: ChainResult) => unknown,
        reject?: (e: unknown) => unknown,
      ) => unknown;
    };
    const chain: Chain = {
      eq(col, value) {
        if (col === "user_id") filter.userId = value as string;
        if (col === "chain_id") filter.chainId = value as number;
        return chain;
      },
      then(resolve, reject) {
        try {
          const { count } = applyAndCount();
          const result: ChainResult = {
            count,
            error: opts.deploymentsError ?? null,
          };
          return Promise.resolve(result).then(resolve, reject);
        } catch (e) {
          return Promise.reject(e).then(resolve, reject);
        }
      },
    };
    return {
      select: () => chain,
    };
  })();

  return {
    from: (table: string) => {
      if (table === "user_billing_state") return billingBuilder;
      if (table === "user_pool_deployments") return deploymentsBuilder;
      throw new Error(`unexpected table ${table} in test mock`);
    },
  } as unknown as SupabaseClient<Database>;
}

const NOW_MS = Date.parse("2026-04-27T12:00:00Z");
const FUTURE = "2026-05-27T12:00:00Z";
const PAST = "2026-03-27T12:00:00Z";
const USER = "11111111-1111-1111-1111-111111111111";
const CHAIN = 11155111;

function deployment(opts?: { user?: string; chain?: number }): DeploymentRow {
  return {
    user_id: opts?.user ?? USER,
    chain_id: opts?.chain ?? CHAIN,
  };
}

describe("decideDeployEligibility (pure rule)", () => {
  it("Free user with 0 pools is allowed", () => {
    const r = decideDeployEligibility({ isPro: false, deployedPoolCount: 0 });
    expect(r).toEqual({
      allowed: true,
      plan: "free",
      deployedPoolCount: 0,
      freePoolLimit: FREE_POOL_LIMIT,
    });
  });

  it("Free user with 1 pool is allowed", () => {
    const r = decideDeployEligibility({ isPro: false, deployedPoolCount: 1 });
    expect(r.allowed).toBe(true);
    expect(r.plan).toBe("free");
  });

  it("Free user with 2 pools is blocked with reason=free_pool_limit_reached", () => {
    const r = decideDeployEligibility({ isPro: false, deployedPoolCount: 2 });
    expect(r.allowed).toBe(false);
    expect(r.plan).toBe("free");
    expect(r.reason).toBe("free_pool_limit_reached");
    expect(r.deployedPoolCount).toBe(2);
    expect(r.freePoolLimit).toBe(FREE_POOL_LIMIT);
  });

  it("Free user above the limit (e.g. legacy) is still blocked", () => {
    const r = decideDeployEligibility({ isPro: false, deployedPoolCount: 5 });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("free_pool_limit_reached");
  });

  it("Pro user with 0 pools is allowed", () => {
    const r = decideDeployEligibility({ isPro: true, deployedPoolCount: 0 });
    expect(r.allowed).toBe(true);
    expect(r.plan).toBe("pro");
  });

  it("Pro user with 2 pools is allowed (Pro is unlimited)", () => {
    const r = decideDeployEligibility({ isPro: true, deployedPoolCount: 2 });
    expect(r.allowed).toBe(true);
    expect(r.plan).toBe("pro");
    expect(r.reason).toBeUndefined();
  });

  it("Pro user with 100 pools is still allowed", () => {
    const r = decideDeployEligibility({ isPro: true, deployedPoolCount: 100 });
    expect(r.allowed).toBe(true);
    expect(r.reason).toBeUndefined();
  });
});

describe("countDeployedPools", () => {
  it("counts only ledger rows matching user_id + chain_id", async () => {
    const client = createSupabaseMock({
      deployments: [
        deployment(), // matches
        deployment(), // matches
        deployment({ user: "other-user" }), // wrong user
        deployment({ chain: 1 }), // wrong chain
      ],
    });
    const n = await countDeployedPools(client, { userId: USER, chainId: CHAIN });
    expect(n).toBe(2);
  });

  // Required test 7 (deployed-but-funding-failed pool still counts).
  // The architectural invariant: `recordVerifiedDeployment` writes the
  // ledger row when the deploy tx confirms, *before* any funding step. So
  // a pool whose initial fund tx later reverts is still in the ledger and
  // therefore still counts. From the count layer's perspective this is
  // simply "two ledger rows == count of 2."
  it("counts every ledger row (funding-failed orphans are written upstream and still count)", async () => {
    const client = createSupabaseMock({
      deployments: [deployment(), deployment()],
    });
    const n = await countDeployedPools(client, { userId: USER, chainId: CHAIN });
    expect(n).toBe(2);
  });

  // Required test 8 (failed deploys with no contract address don't count)
  // is enforced upstream by `recordVerifiedDeployment`, which rejects
  // `invalid_pool_address` / `tx_reverted` / `contract_address_mismatch`
  // before any insert. From this layer's perspective, those rows simply
  // never reach the ledger — so "no ledger rows == count of 0."
  it("returns 0 when the user has no ledger rows", async () => {
    const client = createSupabaseMock({ deployments: [] });
    const n = await countDeployedPools(client, { userId: USER, chainId: CHAIN });
    expect(n).toBe(0);
  });

  it("propagates supabase errors", async () => {
    const client = createSupabaseMock({
      deploymentsError: { message: "rls denied" },
    });
    await expect(
      countDeployedPools(client, { userId: USER, chainId: CHAIN }),
    ).rejects.toThrow(/rls denied/);
  });
});

describe("checkDeployEligibility (end-to-end against Supabase mock)", () => {
  it("Free user (no billing row) with 0 pools is allowed", async () => {
    const client = createSupabaseMock({ billing: null, deployments: [] });
    const r = await checkDeployEligibility(client, {
      userId: USER,
      chainId: CHAIN,
      nowMs: NOW_MS,
    });
    expect(r.allowed).toBe(true);
    expect(r.plan).toBe("free");
    expect(r.deployedPoolCount).toBe(0);
  });

  it("Free user with 1 pool is allowed", async () => {
    const client = createSupabaseMock({
      billing: null,
      deployments: [deployment()],
    });
    const r = await checkDeployEligibility(client, {
      userId: USER,
      chainId: CHAIN,
      nowMs: NOW_MS,
    });
    expect(r.allowed).toBe(true);
    expect(r.deployedPoolCount).toBe(1);
  });

  // Required test: Free user with 2 pools must be blocked before wallet sig.
  // The route returns this body and the modal short-circuits on `!allowed`.
  it("Free user with 2 pools is blocked with reason=free_pool_limit_reached", async () => {
    const client = createSupabaseMock({
      billing: null,
      deployments: [deployment(), deployment()],
    });
    const r = await checkDeployEligibility(client, {
      userId: USER,
      chainId: CHAIN,
      nowMs: NOW_MS,
    });
    expect(r.allowed).toBe(false);
    expect(r.plan).toBe("free");
    expect(r.deployedPoolCount).toBe(2);
    expect(r.reason).toBe("free_pool_limit_reached");
  });

  // Required test: active Pro with future period_end + many pools is allowed.
  it("active Pro user with 5 pools and future period_end is allowed", async () => {
    const client = createSupabaseMock({
      billing: {
        subscription_plan: "pro",
        subscription_status: "active",
        subscription_current_period_end: FUTURE,
      },
      deployments: [
        deployment(),
        deployment(),
        deployment(),
        deployment(),
        deployment(),
      ],
    });
    const r = await checkDeployEligibility(client, {
      userId: USER,
      chainId: CHAIN,
      nowMs: NOW_MS,
    });
    expect(r.allowed).toBe(true);
    expect(r.plan).toBe("pro");
    expect(r.deployedPoolCount).toBe(5);
  });

  // Required test: expired Pro is treated as Free.
  it("Pro user with expired subscription_current_period_end is treated as Free and blocked at 2 pools", async () => {
    const client = createSupabaseMock({
      billing: {
        subscription_plan: "pro",
        subscription_status: "active",
        subscription_current_period_end: PAST,
      },
      deployments: [deployment(), deployment()],
    });
    const r = await checkDeployEligibility(client, {
      userId: USER,
      chainId: CHAIN,
      nowMs: NOW_MS,
    });
    expect(r.allowed).toBe(false);
    expect(r.plan).toBe("free");
    expect(r.reason).toBe("free_pool_limit_reached");
  });

  it("Pro user with expired period_end and 1 pool is treated as Free but still allowed (under limit)", async () => {
    const client = createSupabaseMock({
      billing: {
        subscription_plan: "pro",
        subscription_status: "active",
        subscription_current_period_end: PAST,
      },
      deployments: [deployment()],
    });
    const r = await checkDeployEligibility(client, {
      userId: USER,
      chainId: CHAIN,
      nowMs: NOW_MS,
    });
    expect(r.allowed).toBe(true);
    expect(r.plan).toBe("free");
    expect(r.deployedPoolCount).toBe(1);
  });

  // Required test: trialing Pro with future period_end is allowed.
  it("trialing Pro user with future period_end is allowed regardless of pool count", async () => {
    const client = createSupabaseMock({
      billing: {
        subscription_plan: "pro",
        subscription_status: "trialing",
        subscription_current_period_end: FUTURE,
      },
      deployments: [deployment(), deployment(), deployment()],
    });
    const r = await checkDeployEligibility(client, {
      userId: USER,
      chainId: CHAIN,
      nowMs: NOW_MS,
    });
    expect(r.allowed).toBe(true);
    expect(r.plan).toBe("pro");
  });

  it("canceled Pro user is treated as Free", async () => {
    const client = createSupabaseMock({
      billing: {
        subscription_plan: "pro",
        subscription_status: "canceled",
        subscription_current_period_end: FUTURE,
      },
      deployments: [deployment(), deployment()],
    });
    const r = await checkDeployEligibility(client, {
      userId: USER,
      chainId: CHAIN,
      nowMs: NOW_MS,
    });
    expect(r.allowed).toBe(false);
    expect(r.plan).toBe("free");
  });

  // Under A08 F-02 the count is from the verified-deploy ledger, which
  // only ever contains rows for tx's whose receipt + bytecode check passed.
  // "Deployed-but-funding-failed" still counts because the ledger row is
  // written when the deploy tx confirms, before the funding step. The
  // counting layer is unaware of funding state — it just counts rows.
  it("counts every verified deployment toward the Free limit (funding state irrelevant)", async () => {
    const client = createSupabaseMock({
      billing: null,
      deployments: [deployment(), deployment()],
    });
    const r = await checkDeployEligibility(client, {
      userId: USER,
      chainId: CHAIN,
      nowMs: NOW_MS,
    });
    expect(r.allowed).toBe(false);
    expect(r.deployedPoolCount).toBe(2);
  });

  // The "failed deploy with no contract address doesn't count" invariant
  // is enforced upstream in `recordVerifiedDeployment` (no contractAddress
  // → ledger insert is rejected). At the count layer there's nothing to
  // exercise — there's no "empty pool_address" representation in the
  // ledger because of the CHECK constraint. We assert the absence: zero
  // rows for a failed deploy means the count remains under the limit.
  it("does not count failed deploys (they never reach the ledger)", async () => {
    const client = createSupabaseMock({
      billing: null,
      // One verified deploy in the ledger; the failed deploy is absent.
      deployments: [deployment()],
    });
    const r = await checkDeployEligibility(client, {
      userId: USER,
      chainId: CHAIN,
      nowMs: NOW_MS,
    });
    expect(r.allowed).toBe(true);
    expect(r.deployedPoolCount).toBe(1);
  });
});
