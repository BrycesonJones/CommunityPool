/**
 * @vitest-environment jsdom
 *
 * Integration-style test for the deploy-logging flow:
 *  - appends the deployed pool into localStorage (via appendOpenPoolToStorage)
 *  - upserts into Supabase with typed columns (asset_type, funded_amount_human,
 *    deploy_tx_hash, fund_tx_hash)
 *  - renders the pool in Open Pools after a simulated "refresh" re-read of the
 *    snapshot
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  appendOpenPoolToStorage,
  getOpenPoolsSnapshot,
  type StoredOpenPool,
} from "@/lib/pools/open-pools-storage";
import {
  poolCardsFromLocal,
  upsertPoolActivity,
} from "@/lib/pools/pool-activity-service";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

// Node 25 ships a built-in localStorage stub that vitest's jsdom env does not
// fully replace; provide a minimal in-memory Storage so open-pools-storage.ts
// (which reads/writes window.localStorage) behaves deterministically here.
class MemoryStorage {
  private readonly store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }
}

const mem = new MemoryStorage();
vi.stubGlobal("localStorage", mem);
Object.defineProperty(window, "localStorage", {
  value: mem,
  configurable: true,
});

type ExistingRow = {
  last_tx_hashes: string[];
  asset_type: string | null;
  funded_amount_human: string | null;
  deploy_tx_hash: string | null;
  fund_tx_hash: string | null;
} | null;

function createSupabaseMock(opts: {
  existing: ExistingRow;
  captureUpsert: (row: unknown) => void;
}): SupabaseClient<Database> {
  const builder = {
    select: () => ({
      eq: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: opts.existing, error: null }),
          }),
        }),
      }),
    }),
    upsert: (row: unknown) => {
      opts.captureUpsert(row);
      return { error: null };
    },
  };
  return { from: () => builder } as unknown as SupabaseClient<Database>;
}

const DEPLOY_TX = "0x" + "a".repeat(64);
const FUND_TX = "0x" + "b".repeat(64);
const POOL_ADDR = "0x1234567890123456789012345678901234567890";

describe("deployed-pool logging", () => {
  beforeEach(() => {
    mem.clear();
  });

  it("logs the deployed pool into Open Pools (localStorage) immediately", () => {
    const entry: StoredOpenPool = {
      id: `11155111-${POOL_ADDR.toLowerCase()}`,
      name: "Deploy Test",
      address: POOL_ADDR,
      chainId: 11155111,
      status: "Active",
      totalUsd: 100,
      deployedAt: Date.now(),
      description: "desc",
      expiresAtUnix: Math.floor(Date.now() / 1000) + 86_400,
      lastActivity: "deploy",
      minimumUsdWei: "5000000000000000000",
      assetType: "ETH",
      fundedAmountHuman: "0.0321",
      deployTxHash: DEPLOY_TX,
      fundTxHash: FUND_TX,
    };
    appendOpenPoolToStorage(entry);

    const cards = poolCardsFromLocal(
      getOpenPoolsSnapshot(),
      Math.floor(Date.now() / 1000),
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].assetType).toBe("ETH");
    expect(cards[0].fundedAmountHuman).toBe("0.0321");
    expect(cards[0].explorerAddressUrl).toBe(
      `https://sepolia.etherscan.io/address/${POOL_ADDR.toLowerCase()}`,
    );
    expect(cards[0].explorerDeployTxUrl).toBe(
      `https://sepolia.etherscan.io/tx/${DEPLOY_TX.toLowerCase()}`,
    );
    expect(cards[0].explorerFundTxUrl).toBe(
      `https://sepolia.etherscan.io/tx/${FUND_TX.toLowerCase()}`,
    );
  });

  it("persists across a simulated page refresh (localStorage survives module re-import semantics)", () => {
    const entry: StoredOpenPool = {
      id: `11155111-${POOL_ADDR.toLowerCase()}`,
      name: "Refresh Test",
      address: POOL_ADDR,
      chainId: 11155111,
      status: "Active",
      totalUsd: 7,
      deployedAt: Date.now(),
      lastActivity: "deploy",
      assetType: "WBTC",
      fundedAmountHuman: "0.00012",
      deployTxHash: DEPLOY_TX,
    };
    appendOpenPoolToStorage(entry);

    const afterRefresh = getOpenPoolsSnapshot();
    expect(afterRefresh).toHaveLength(1);
    expect(afterRefresh[0].assetType).toBe("WBTC");
    expect(afterRefresh[0].deployTxHash).toBe(DEPLOY_TX);
  });

  it("writes typed columns into Supabase on deploy upsert", async () => {
    const captured: unknown[] = [];
    const client = createSupabaseMock({
      existing: null,
      captureUpsert: (row) => captured.push(row),
    });
    await upsertPoolActivity(client, {
      userId: "user-a",
      chainId: 11155111,
      poolAddress: POOL_ADDR,
      lastActivity: "deploy",
      newTxHashes: [DEPLOY_TX, FUND_TX],
      name: "Deploy Test",
      description: "desc",
      expiresAtUnix: Math.floor(Date.now() / 1000) + 86_400,
      minimumUsdWei: "5000000000000000000",
      totalUsdEstimate: 100,
      assetType: "ETH",
      fundedAmountHuman: "0.0321",
      deployTxHash: DEPLOY_TX,
      fundTxHash: FUND_TX,
    });
    const row = captured[0] as {
      asset_type: string | null;
      funded_amount_human: string | null;
      deploy_tx_hash: string | null;
      fund_tx_hash: string | null;
      last_tx_hashes: string[];
      user_id: string;
    };
    expect(row.asset_type).toBe("ETH");
    expect(row.funded_amount_human).toBe("0.0321");
    expect(row.deploy_tx_hash).toBe(DEPLOY_TX);
    expect(row.fund_tx_hash).toBe(FUND_TX);
    expect(row.last_tx_hashes).toEqual([DEPLOY_TX, FUND_TX]);
    expect(row.user_id).toBe("user-a");
  });
});
