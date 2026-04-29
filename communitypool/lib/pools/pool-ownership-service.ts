import { getAddress } from "ethers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export function normalizePoolOwners(
  deployerAddress: string,
  coOwnerAddresses: string[],
): { ownerAddress: string; isDeployer: boolean }[] {
  const deployer = getAddress(deployerAddress);
  const out: { ownerAddress: string; isDeployer: boolean }[] = [
    { ownerAddress: deployer, isDeployer: true },
  ];
  const seen = new Set<string>([deployer]);
  for (const raw of coOwnerAddresses) {
    const owner = getAddress(raw);
    if (seen.has(owner)) continue;
    seen.add(owner);
    out.push({ ownerAddress: owner, isDeployer: false });
  }
  return out;
}

/**
 * Persist the per-pool owner mapping by calling the server route, which
 * verifies each candidate against the pool contract's `isOwner(address)`
 * before writing via the service-role client. Direct client writes to
 * `pool_owner_memberships` are no longer permitted by RLS — the table only
 * exposes SELECT to authenticated users.
 */
export async function upsertPoolOwners(input: {
  chainId: number;
  poolAddress: string;
  deployerAddress: string;
  coOwnerAddresses: string[];
  fetchImpl?: typeof fetch;
}): Promise<{ error: Error | null }> {
  const owners = normalizePoolOwners(
    input.deployerAddress,
    input.coOwnerAddresses,
  );
  const candidates = owners.map((o) => o.ownerAddress);
  const fetchFn = input.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchFn("/api/pools/owners", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chainId: input.chainId,
        poolAddress: getAddress(input.poolAddress),
        candidates,
      }),
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err : new Error("network error"),
    };
  }

  if (!res.ok) {
    let message = `request failed: ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* keep status-derived message */
    }
    return { error: new Error(message) };
  }

  return { error: null };
}

export async function isPersistedPoolOwner(
  client: SupabaseClient<Database>,
  input: {
    chainId: number;
    poolAddress: string;
    ownerAddress: string;
  },
): Promise<{ isOwner: boolean; error: Error | null }> {
  const { data, error } = await client
    .from("pool_owner_memberships")
    .select("owner_address")
    .eq("chain_id", input.chainId)
    .eq("pool_address", getAddress(input.poolAddress))
    .eq("owner_address", getAddress(input.ownerAddress))
    .maybeSingle();
  if (error) return { isOwner: false, error: new Error(error.message) };
  return { isOwner: Boolean(data), error: null };
}
