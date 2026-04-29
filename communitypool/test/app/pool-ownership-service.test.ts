import { describe, expect, it } from "vitest";
import {
  isPersistedPoolOwner,
  normalizePoolOwners,
  upsertPoolOwners,
} from "@/lib/pools/pool-ownership-service";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

function createSupabaseMock(opts: {
  selectResult?: unknown | null;
}) {
  const table = {
    select: () => ({
      eq: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: opts.selectResult ?? null,
              error: null,
            }),
          }),
        }),
      }),
    }),
  };
  return {
    from: () => table,
  } as unknown as SupabaseClient<Database>;
}

describe("pool ownership persistence", () => {
  it("normalizes deployer + co-owners and removes duplicates", () => {
    const owners = normalizePoolOwners(
      "0x1111111111111111111111111111111111111111",
      [
        "0x2222222222222222222222222222222222222222",
        "0x2222222222222222222222222222222222222222",
      ],
    );
    expect(owners).toEqual([
      {
        ownerAddress: "0x1111111111111111111111111111111111111111",
        isDeployer: true,
      },
      {
        ownerAddress: "0x2222222222222222222222222222222222222222",
        isDeployer: false,
      },
    ]);
  });

  it("posts deployer + co-owner candidates to /api/pools/owners", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fakeFetch: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ persistedOwners: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const res = await upsertPoolOwners({
      chainId: 1,
      poolAddress: "0x1234567890123456789012345678901234567890",
      deployerAddress: "0x1111111111111111111111111111111111111111",
      coOwnerAddresses: [
        "0x2222222222222222222222222222222222222222",
        "0x3333333333333333333333333333333333333333",
      ],
      fetchImpl: fakeFetch,
    });

    expect(res.error).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/pools/owners");
    expect(calls[0].init?.method).toBe("POST");
    const body = JSON.parse(String(calls[0].init?.body)) as {
      chainId: number;
      poolAddress: string;
      candidates: string[];
    };
    expect(body).toEqual({
      chainId: 1,
      poolAddress: "0x1234567890123456789012345678901234567890",
      candidates: [
        "0x1111111111111111111111111111111111111111",
        "0x2222222222222222222222222222222222222222",
        "0x3333333333333333333333333333333333333333",
      ],
    });
  });

  it("surfaces server error responses", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ error: "no rpc" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });

    const res = await upsertPoolOwners({
      chainId: 1,
      poolAddress: "0x1234567890123456789012345678901234567890",
      deployerAddress: "0x1111111111111111111111111111111111111111",
      coOwnerAddresses: [],
      fetchImpl: fakeFetch,
    });

    expect(res.error?.message).toBe("no rpc");
  });

  it("authorizes when owner membership row exists", async () => {
    const client = createSupabaseMock({
      selectResult: { owner_address: "0x1111111111111111111111111111111111111111" },
    });
    const out = await isPersistedPoolOwner(client, {
      chainId: 1,
      poolAddress: "0x1234567890123456789012345678901234567890",
      ownerAddress: "0x1111111111111111111111111111111111111111",
    });
    expect(out.error).toBeNull();
    expect(out.isOwner).toBe(true);
  });

  it("denies when owner membership row is missing", async () => {
    const client = createSupabaseMock({ selectResult: null });
    const out = await isPersistedPoolOwner(client, {
      chainId: 1,
      poolAddress: "0x1234567890123456789012345678901234567890",
      ownerAddress: "0x3333333333333333333333333333333333333333",
    });
    expect(out.error).toBeNull();
    expect(out.isOwner).toBe(false);
  });
});
