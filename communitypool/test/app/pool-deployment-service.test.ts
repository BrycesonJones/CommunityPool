/**
 * OWASP A08 F-02 — verified deployment recording.
 *
 * The Free-tier quota's integrity hinges on `recordVerifiedDeployment`:
 * a Free user must NOT be able to "claim" a pool they didn't deploy or
 * record a non-deploy tx. These tests exercise the on-chain verification
 * gate by mocking the server-side RPC provider.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

const provider = vi.hoisted(() => ({
  getTransactionReceipt: vi.fn(),
  getTransaction: vi.fn(),
  getCode: vi.fn(),
}));

vi.mock("@/lib/onchain/server-providers", () => ({
  getServerReadOnlyProviderForChain: () => provider,
}));

import { recordVerifiedDeployment } from "@/lib/pools/pool-deployment-service";

const POOL = "0x1234567890123456789012345678901234567890";
const POOL_CHECKSUMMED = "0x1234567890123456789012345678901234567890";
const TX = "0x" + "a".repeat(64);
const USER = "11111111-1111-1111-1111-111111111111";
const CHAIN = 11155111;

type Captured = {
  inserts: unknown[];
  selectsAfterConflict: number;
};

function createCapturingAdmin(opts: {
  insertError?: { code?: string; message: string } | null;
  insertReturns?: { id: string };
  existingRow?: { id: string } | null;
}): { client: SupabaseClient<Database>; captured: Captured } {
  const captured: Captured = { inserts: [], selectsAfterConflict: 0 };
  const insertReturns = opts.insertReturns ?? { id: "row-1" };
  const existingRow = opts.existingRow ?? null;

  const client = {
    from(table: string) {
      if (table !== "user_pool_deployments") {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        insert(row: unknown) {
          captured.inserts.push(row);
          return {
            select: () => ({
              maybeSingle: async () =>
                opts.insertError
                  ? { data: null, error: opts.insertError }
                  : { data: insertReturns, error: null },
            }),
          };
        },
        select() {
          // Used by the unique-violation lookup branch.
          captured.selectsAfterConflict += 1;
          return {
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: existingRow, error: null }),
              }),
            }),
          };
        },
      };
    },
  } as unknown as SupabaseClient<Database>;

  return { client, captured };
}

beforeEach(() => {
  provider.getTransactionReceipt.mockReset();
  provider.getTransaction.mockReset();
  provider.getCode.mockReset();
});

describe("recordVerifiedDeployment — input validation", () => {
  it("rejects an invalid pool address before touching chain or DB", async () => {
    const { client, captured } = createCapturingAdmin({});
    const r = await recordVerifiedDeployment(client, {
      userId: USER,
      chainId: CHAIN,
      poolAddress: "not-an-address",
      deployTxHash: TX,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid_pool_address");
    expect(captured.inserts).toHaveLength(0);
    expect(provider.getTransactionReceipt).not.toHaveBeenCalled();
  });

  it("rejects an invalid tx hash before touching chain or DB", async () => {
    const { client, captured } = createCapturingAdmin({});
    const r = await recordVerifiedDeployment(client, {
      userId: USER,
      chainId: CHAIN,
      poolAddress: POOL,
      deployTxHash: "0xshort",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid_tx_hash");
    expect(captured.inserts).toHaveLength(0);
    expect(provider.getTransactionReceipt).not.toHaveBeenCalled();
  });
});

describe("recordVerifiedDeployment — on-chain verification", () => {
  it("rejects a tx whose receipt does not exist on the supplied chain", async () => {
    provider.getTransactionReceipt.mockResolvedValue(null);
    provider.getTransaction.mockResolvedValue(null);
    const { client, captured } = createCapturingAdmin({});
    const r = await recordVerifiedDeployment(client, {
      userId: USER,
      chainId: CHAIN,
      poolAddress: POOL,
      deployTxHash: TX,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("tx_not_found");
    expect(captured.inserts).toHaveLength(0);
  });

  it("rejects a tx that is in the mempool but not yet mined (client should retry)", async () => {
    provider.getTransactionReceipt.mockResolvedValue(null);
    provider.getTransaction.mockResolvedValue({ blockNumber: null });
    const { client, captured } = createCapturingAdmin({});
    const r = await recordVerifiedDeployment(client, {
      userId: USER,
      chainId: CHAIN,
      poolAddress: POOL,
      deployTxHash: TX,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("tx_pending");
    expect(captured.inserts).toHaveLength(0);
  });

  it("rejects a reverted deploy tx", async () => {
    provider.getTransactionReceipt.mockResolvedValue({
      status: 0,
      contractAddress: POOL,
    });
    const { client, captured } = createCapturingAdmin({});
    const r = await recordVerifiedDeployment(client, {
      userId: USER,
      chainId: CHAIN,
      poolAddress: POOL,
      deployTxHash: TX,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("tx_reverted");
    expect(captured.inserts).toHaveLength(0);
  });

  it("rejects a tx that is not a contract creation (no receipt.contractAddress)", async () => {
    provider.getTransactionReceipt.mockResolvedValue({
      status: 1,
      contractAddress: null,
    });
    const { client, captured } = createCapturingAdmin({});
    const r = await recordVerifiedDeployment(client, {
      userId: USER,
      chainId: CHAIN,
      poolAddress: POOL,
      deployTxHash: TX,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("contract_address_mismatch");
    expect(captured.inserts).toHaveLength(0);
  });

  it("rejects when receipt.contractAddress does not match the supplied pool", async () => {
    provider.getTransactionReceipt.mockResolvedValue({
      status: 1,
      contractAddress: "0x9999999999999999999999999999999999999999",
    });
    const { client, captured } = createCapturingAdmin({});
    const r = await recordVerifiedDeployment(client, {
      userId: USER,
      chainId: CHAIN,
      poolAddress: POOL,
      deployTxHash: TX,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("contract_address_mismatch");
    expect(captured.inserts).toHaveLength(0);
  });

  it("rejects when the pool address has no bytecode (selfdestructed)", async () => {
    provider.getTransactionReceipt.mockResolvedValue({
      status: 1,
      contractAddress: POOL,
    });
    provider.getCode.mockResolvedValue("0x");
    const { client, captured } = createCapturingAdmin({});
    const r = await recordVerifiedDeployment(client, {
      userId: USER,
      chainId: CHAIN,
      poolAddress: POOL,
      deployTxHash: TX,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no_bytecode_at_pool");
    expect(captured.inserts).toHaveLength(0);
  });
});

describe("recordVerifiedDeployment — service-role insert", () => {
  beforeEach(() => {
    // Happy-path on-chain state: tx is a successful contract creation
    // for the supplied pool address, and the pool has bytecode.
    provider.getTransactionReceipt.mockResolvedValue({
      status: 1,
      contractAddress: POOL,
    });
    provider.getCode.mockResolvedValue("0xdead");
  });

  it("inserts a verified row with deployment_status='deployed'", async () => {
    const { client, captured } = createCapturingAdmin({
      insertReturns: { id: "row-1" },
    });
    const r = await recordVerifiedDeployment(client, {
      userId: USER,
      chainId: CHAIN,
      poolAddress: POOL,
      deployTxHash: TX,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.status).toBe("recorded");
      expect(r.rowId).toBe("row-1");
    }
    expect(captured.inserts).toHaveLength(1);
    const row = captured.inserts[0] as {
      user_id: string;
      chain_id: number;
      pool_address: string;
      deploy_tx_hash: string;
      deployment_status: string;
    };
    expect(row.user_id).toBe(USER);
    expect(row.chain_id).toBe(CHAIN);
    expect(row.pool_address).toBe(POOL_CHECKSUMMED);
    expect(row.deploy_tx_hash).toBe(TX.toLowerCase());
    expect(row.deployment_status).toBe("deployed");
  });

  it("treats a unique-violation as 'already_recorded' (idempotent re-call)", async () => {
    const { client } = createCapturingAdmin({
      insertError: { code: "23505", message: "duplicate key" },
      existingRow: { id: "existing-row" },
    });
    const r = await recordVerifiedDeployment(client, {
      userId: USER,
      chainId: CHAIN,
      poolAddress: POOL,
      deployTxHash: TX,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.status).toBe("already_recorded");
      expect(r.rowId).toBe("existing-row");
    }
  });

  it("returns db_error for non-conflict insert failures", async () => {
    const { client } = createCapturingAdmin({
      insertError: { code: "42501", message: "permission denied" },
    });
    const r = await recordVerifiedDeployment(client, {
      userId: USER,
      chainId: CHAIN,
      poolAddress: POOL,
      deployTxHash: TX,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("db_error");
  });
});
