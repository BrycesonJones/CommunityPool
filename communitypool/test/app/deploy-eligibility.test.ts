/**
 * Pool deployment eligibility — unlimited for every authenticated user.
 *
 * CommunityPool has no Free/Pro tiers and no per-plan pool ceiling. These
 * tests pin that:
 *   - `decideDeployEligibility` allows any pool count (0, 1, 2, >2)
 *   - `checkDeployEligibility` never queries a billing / subscription
 *     table — the only read is the verified-deploy ledger, and its result
 *     is informational
 *   - a ledger read failure surfaces as an error (route returns 500) rather
 *     than silently allowing or denying
 *
 * The route handler is exercised separately in
 * test/security/check-deploy-route.test.ts.
 *
 * Architecture note (OWASP A08 F-02, still relevant for the count): rows
 * land in `user_pool_deployments` only after `recordVerifiedDeployment`
 * has confirmed the deploy tx on chain. The count is therefore trustworthy
 * even though nothing gates on it any more.
 */

import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  checkDeployEligibility,
  countDeployedPools,
  decideDeployEligibility,
} from "@/lib/pools/deploy-eligibility";

type DeploymentRow = { user_id: string; chain_id: number };

/**
 * Minimal Supabase mock. Supports only
 *   `from("user_pool_deployments")
 *      .select("id", { count: "exact", head: true })
 *      .eq("user_id", id).eq("chain_id", n)`
 * and records every table name passed to `from()` so the tests can prove no
 * billing / subscription table is ever consulted.
 */
function createSupabaseMock(opts: {
  deployments?: DeploymentRow[];
  deploymentsError?: { message: string };
}): { client: SupabaseClient<Database>; tablesQueried: string[] } {
  const deployments = opts.deployments ?? [];
  const tablesQueried: string[] = [];

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
        const { count } = applyAndCount();
        const result: ChainResult = {
          count,
          error: opts.deploymentsError ?? null,
        };
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return { select: () => chain };
  })();

  const client = {
    from: (table: string) => {
      tablesQueried.push(table);
      if (table === "user_pool_deployments") return deploymentsBuilder;
      throw new Error(`unexpected table ${table} in test mock`);
    },
  } as unknown as SupabaseClient<Database>;

  return { client, tablesQueried };
}

const USER = "11111111-1111-1111-1111-111111111111";
const CHAIN = 11155111;

function deployment(opts?: { user?: string; chain?: number }): DeploymentRow {
  return {
    user_id: opts?.user ?? USER,
    chain_id: opts?.chain ?? CHAIN,
  };
}

function manyDeployments(n: number): DeploymentRow[] {
  return Array.from({ length: n }, () => deployment());
}

describe("decideDeployEligibility (pure rule)", () => {
  it.each([0, 1, 2, 3, 10, 100])(
    "authenticated user with %i deployed pools is allowed",
    (deployedPoolCount) => {
      const r = decideDeployEligibility({ deployedPoolCount });
      expect(r.allowed).toBe(true);
      expect(r.deployedPoolCount).toBe(deployedPoolCount);
      expect(r.reason).toBeUndefined();
    },
  );

  it("exposes no plan, tier, or limit fields", () => {
    const r = decideDeployEligibility({ deployedPoolCount: 2 });
    expect(r).toEqual({ allowed: true, deployedPoolCount: 2 });
    expect(Object.keys(r).sort()).toEqual(["allowed", "deployedPoolCount"]);
  });
});

describe("countDeployedPools", () => {
  it("counts only ledger rows matching user_id + chain_id", async () => {
    const { client } = createSupabaseMock({
      deployments: [
        deployment(),
        deployment(),
        deployment({ user: "22222222-2222-2222-2222-222222222222" }),
        deployment({ chain: 1 }),
      ],
    });
    await expect(
      countDeployedPools(client, { userId: USER, chainId: CHAIN }),
    ).resolves.toBe(2);
  });

  it("returns 0 when the user has no ledger rows", async () => {
    const { client } = createSupabaseMock({ deployments: [] });
    await expect(
      countDeployedPools(client, { userId: USER, chainId: CHAIN }),
    ).resolves.toBe(0);
  });

  it("propagates supabase errors", async () => {
    const { client } = createSupabaseMock({
      deploymentsError: { message: "ledger unavailable" },
    });
    await expect(
      countDeployedPools(client, { userId: USER, chainId: CHAIN }),
    ).rejects.toThrow(/countDeployedPools failed: ledger unavailable/);
  });
});

describe("checkDeployEligibility (end-to-end against Supabase mock)", () => {
  it.each([0, 1, 2, 3, 25])(
    "authenticated user with %i verified pools is allowed",
    async (n) => {
      const { client } = createSupabaseMock({ deployments: manyDeployments(n) });
      const r = await checkDeployEligibility(client, {
        userId: USER,
        chainId: CHAIN,
      });
      expect(r).toEqual({ allowed: true, deployedPoolCount: n });
    },
  );

  it("never queries a billing, subscription, or profile table", async () => {
    const { client, tablesQueried } = createSupabaseMock({
      deployments: manyDeployments(5),
    });
    await checkDeployEligibility(client, { userId: USER, chainId: CHAIN });
    expect(tablesQueried).toEqual(["user_pool_deployments"]);
  });

  it("is chain-scoped: pools on another chain do not affect the count", async () => {
    const { client } = createSupabaseMock({
      deployments: [deployment({ chain: 1 }), deployment({ chain: 1 })],
    });
    const r = await checkDeployEligibility(client, {
      userId: USER,
      chainId: CHAIN,
    });
    expect(r).toEqual({ allowed: true, deployedPoolCount: 0 });
  });

  it("surfaces a ledger read failure as an error rather than a silent allow/deny", async () => {
    const { client } = createSupabaseMock({
      deploymentsError: { message: "db down" },
    });
    await expect(
      checkDeployEligibility(client, { userId: USER, chainId: CHAIN }),
    ).rejects.toThrow(/db down/);
  });
});
