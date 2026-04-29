import { describe, expect, it } from "vitest";
import type { Json } from "@/lib/supabase/database.types";
import { SNAPSHOT_VERSION } from "@/lib/onchain/constants";
import { parseStoredSnapshot } from "@/lib/onchain/cache";
import type { NormalizedLookupResult } from "@/lib/onchain/types";

describe("parseStoredSnapshot tx count upgrade", () => {
  it("defaults missing uniqueTransactionCount and transactionCountComplete for old snapshots", () => {
    const legacy = {
      input: {
        kind: "evm_address" as const,
        raw: "0xabc",
        chainFamily: "evm" as const,
        normalized: "0xabc",
      },
      fetchedAt: "2026-01-01T00:00:00.000Z",
      fromCache: true,
      networks: [
        {
          networkId: "eth-mainnet",
          nativeBalance: null,
          tokens: [],
          transactions: [{ networkId: "eth-mainnet", hash: "0x" + "a".repeat(64) }],
          errors: [],
        },
      ],
      errors: [],
    } as unknown as NormalizedLookupResult;

    const raw = { v: SNAPSHOT_VERSION, result: legacy } as unknown as Json;
    const parsed = parseStoredSnapshot(raw);
    expect(parsed).not.toBeNull();
    const n = parsed!.networks[0];
    expect(n.uniqueTransactionCount).toBe(1);
    expect(n.transactionCountComplete).toBe(false);
  });
});
