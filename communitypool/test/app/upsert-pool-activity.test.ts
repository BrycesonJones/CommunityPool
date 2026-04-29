import { describe, it, expect } from "vitest";
import { upsertPoolActivity } from "@/lib/pools/pool-activity-service";
import type { PoolOnChainBalances } from "@/lib/onchain/pool-balances";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type ExistingRow = {
  last_tx_hashes: string[];
  asset_type: string | null;
  funded_amount_human: string | null;
  deploy_tx_hash: string | null;
  fund_tx_hash: string | null;
  total_usd_estimate: number | null;
} | null;

/** Minimal chain matching `.from().select().eq().eq().eq().maybeSingle()` and `.upsert()` */
function createSupabaseMock(opts: {
  existing: ExistingRow;
  captureUpsert: (row: unknown) => void;
}): SupabaseClient<Database> {
  const builder = {
    select: () => ({
      eq: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: opts.existing,
              error: null,
            }),
          }),
        }),
      }),
    }),
    upsert: (row: unknown) => {
      opts.captureUpsert(row);
      return { error: null };
    },
  };
  return {
    from: () => builder,
  } as unknown as SupabaseClient<Database>;
}

describe("upsertPoolActivity", () => {
  it("merges new tx hashes with existing rows", async () => {
    const captured: unknown[] = [];
    const client = createSupabaseMock({
      existing: {
        last_tx_hashes: ["0x1111"],
        asset_type: null,
        funded_amount_human: null,
        deploy_tx_hash: null,
        fund_tx_hash: null,
        total_usd_estimate: null,
      },
      captureUpsert: (row) => captured.push(row),
    });
    const { error } = await upsertPoolActivity(client, {
      userId: "user-a",
      chainId: 1,
      poolAddress: "0x1234567890123456789012345678901234567890",
      lastActivity: "fund",
      newTxHashes: ["0x2222", "0x1111"],
      name: "P",
      description: "",
      expiresAtUnix: 2_000_000_000,
      minimumUsdWei: "1",
      totalUsdEstimate: 5,
    });
    expect(error).toBeNull();
    const row = captured[0] as { last_tx_hashes: string[]; user_id: string };
    expect(row.user_id).toBe("user-a");
    expect(row.last_tx_hashes).toContain("0x1111");
    expect(row.last_tx_hashes).toContain("0x2222");
  });

  it("records withdraw as last_activity", async () => {
    const captured: unknown[] = [];
    const client = createSupabaseMock({
      existing: {
        last_tx_hashes: ["0x1"],
        asset_type: "ETH",
        funded_amount_human: "0.1",
        deploy_tx_hash: "0xdeploy",
        fund_tx_hash: null,
        total_usd_estimate: 42,
      },
      captureUpsert: (row) => captured.push(row),
    });
    await upsertPoolActivity(client, {
      userId: "user-a",
      chainId: 1,
      poolAddress: "0x1234567890123456789012345678901234567890",
      lastActivity: "withdraw",
      newTxHashes: ["0x9"],
      name: "P",
      description: "",
      expiresAtUnix: 2_000_000_000,
      minimumUsdWei: "1",
      totalUsdEstimate: 0,
    });
    const row = captured[0] as { last_activity: string };
    expect(row.last_activity).toBe("withdraw");
  });

  it("stores user_id on the row for RLS WITH CHECK (auth.uid() = user_id)", async () => {
    const captured: unknown[] = [];
    const client = createSupabaseMock({
      existing: null,
      captureUpsert: (row) => captured.push(row),
    });
    await upsertPoolActivity(client, {
      userId: "11111111-1111-1111-1111-111111111111",
      chainId: 31337,
      poolAddress: "0x1234567890123456789012345678901234567890",
      lastActivity: "deploy",
      newTxHashes: ["0xabc"],
      name: "X",
      description: "d",
      expiresAtUnix: 2_100_000_000,
      minimumUsdWei: "0",
      totalUsdEstimate: 0,
    });
    const row = captured[0] as { user_id: string };
    expect(row.user_id).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("writes asset_type, funded_amount_human, deploy_tx_hash, fund_tx_hash on deploy", async () => {
    const captured: unknown[] = [];
    const client = createSupabaseMock({
      existing: null,
      captureUpsert: (row) => captured.push(row),
    });
    await upsertPoolActivity(client, {
      userId: "user-a",
      chainId: 11155111,
      poolAddress: "0x1234567890123456789012345678901234567890",
      lastActivity: "deploy",
      newTxHashes: ["0xdeploy", "0xfund"],
      name: "DeployTest",
      description: "",
      expiresAtUnix: 2_100_000_000,
      minimumUsdWei: "0",
      totalUsdEstimate: 100,
      assetType: "ETH",
      fundedAmountHuman: "0.0321",
      deployTxHash: "0xdeploy",
      fundTxHash: "0xfund",
    });
    const row = captured[0] as {
      asset_type: string | null;
      funded_amount_human: string | null;
      deploy_tx_hash: string | null;
      fund_tx_hash: string | null;
    };
    expect(row.asset_type).toBe("ETH");
    expect(row.funded_amount_human).toBe("0.0321");
    expect(row.deploy_tx_hash).toBe("0xdeploy");
    expect(row.fund_tx_hash).toBe("0xfund");
  });

  it("reconciles funded_amount_human and total_usd_estimate from onChainBalances", async () => {
    const captured: unknown[] = [];
    const client = createSupabaseMock({
      existing: {
        last_tx_hashes: ["0xdeploy"],
        asset_type: "ETH",
        funded_amount_human: "0.01",
        deploy_tx_hash: "0xdeploy",
        fund_tx_hash: null,
        total_usd_estimate: 100,
      },
      captureUpsert: (row) => captured.push(row),
    });
    const balances: PoolOnChainBalances = {
      pool: "0x1234567890123456789012345678901234567890",
      chainId: 1,
      blockNumber: 123,
      nativeEth: {
        symbol: "ETH",
        isNative: true,
        tokenAddress: null,
        decimals: 18,
        raw: BigInt("30000000000000000"),
        human: "0.03",
        usdPerUnit: 2000,
        usd: 60,
      },
      tokens: [],
      totalUsd: 60,
      readAt: Date.now(),
    };
    await upsertPoolActivity(client, {
      userId: "user-a",
      chainId: 1,
      poolAddress: "0x1234567890123456789012345678901234567890",
      lastActivity: "fund",
      newTxHashes: ["0xfund2"],
      name: "P",
      description: "",
      expiresAtUnix: 2_000_000_000,
      minimumUsdWei: "1",
      // Caller-supplied user-typed USD is intentionally ignored when chain
      // balances are present.
      totalUsdEstimate: 999,
      fundedAmountHuman: "0.01",
      onChainBalances: balances,
    });
    const row = captured[0] as {
      funded_amount_human: string | null;
      total_usd_estimate: number | null;
      asset_type: string | null;
    };
    expect(row.funded_amount_human).toBe("0.03");
    expect(row.total_usd_estimate).toBe(60);
    expect(row.asset_type).toBe("ETH");
  });

  it("withdraw reconciles to remaining on-chain balance instead of zeroing", async () => {
    const captured: unknown[] = [];
    const client = createSupabaseMock({
      existing: {
        last_tx_hashes: ["0xdeploy", "0xfund"],
        asset_type: "ETH",
        funded_amount_human: "0.05",
        deploy_tx_hash: "0xdeploy",
        fund_tx_hash: "0xfund",
        total_usd_estimate: 150,
      },
      captureUpsert: (row) => captured.push(row),
    });
    const balances: PoolOnChainBalances = {
      pool: "0x1234567890123456789012345678901234567890",
      chainId: 1,
      blockNumber: 200,
      nativeEth: {
        symbol: "ETH",
        isNative: true,
        tokenAddress: null,
        decimals: 18,
        raw: BigInt("20000000000000000"),
        human: "0.02",
        usdPerUnit: 2000,
        usd: 40,
      },
      tokens: [],
      totalUsd: 40,
      readAt: Date.now(),
    };
    await upsertPoolActivity(client, {
      userId: "user-a",
      chainId: 1,
      poolAddress: "0x1234567890123456789012345678901234567890",
      lastActivity: "withdraw",
      newTxHashes: ["0xw1"],
      name: "P",
      description: "",
      expiresAtUnix: 2_000_000_000,
      minimumUsdWei: "1",
      // Handlers now pass null after withdraw — but chain balances win anyway.
      totalUsdEstimate: null,
      onChainBalances: balances,
    });
    const row = captured[0] as {
      funded_amount_human: string | null;
      total_usd_estimate: number | null;
    };
    expect(row.funded_amount_human).toBe("0.02");
    expect(row.total_usd_estimate).toBe(40);
  });

  it("preserves prior total_usd_estimate when caller passes null and no chain balances", async () => {
    const captured: unknown[] = [];
    const client = createSupabaseMock({
      existing: {
        last_tx_hashes: ["0xdeploy"],
        asset_type: "ETH",
        funded_amount_human: "0.1",
        deploy_tx_hash: "0xdeploy",
        fund_tx_hash: null,
        total_usd_estimate: 200,
      },
      captureUpsert: (row) => captured.push(row),
    });
    await upsertPoolActivity(client, {
      userId: "user-a",
      chainId: 1,
      poolAddress: "0x1234567890123456789012345678901234567890",
      lastActivity: "fund",
      newTxHashes: ["0xf"],
      name: "P",
      description: "",
      expiresAtUnix: 2_000_000_000,
      minimumUsdWei: "1",
      totalUsdEstimate: null,
    });
    const row = captured[0] as { total_usd_estimate: number | null };
    expect(row.total_usd_estimate).toBe(200);
  });

  it("preserves existing typed columns when fund upsert does not supply them", async () => {
    const captured: unknown[] = [];
    const client = createSupabaseMock({
      existing: {
        last_tx_hashes: ["0xdeploy"],
        asset_type: "WBTC",
        funded_amount_human: "0.01",
        deploy_tx_hash: "0xdeploy",
        fund_tx_hash: null,
        total_usd_estimate: 500,
      },
      captureUpsert: (row) => captured.push(row),
    });
    await upsertPoolActivity(client, {
      userId: "user-a",
      chainId: 1,
      poolAddress: "0x1234567890123456789012345678901234567890",
      lastActivity: "fund",
      newTxHashes: ["0xfund"],
      name: "P",
      description: "",
      expiresAtUnix: 2_000_000_000,
      minimumUsdWei: "1",
      totalUsdEstimate: 50,
      fundTxHash: "0xfund",
    });
    const row = captured[0] as {
      asset_type: string | null;
      funded_amount_human: string | null;
      deploy_tx_hash: string | null;
      fund_tx_hash: string | null;
    };
    expect(row.asset_type).toBe("WBTC");
    expect(row.funded_amount_human).toBe("0.01");
    expect(row.deploy_tx_hash).toBe("0xdeploy");
    expect(row.fund_tx_hash).toBe("0xfund");
  });
});
