import { NextResponse } from "next/server";
import { Contract, getAddress, isAddress } from "ethers";
import { createClient as createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getServerReadOnlyProviderForChain } from "@/lib/onchain/server-providers";
import communityPoolArtifact from "@/lib/onchain/community-pool-artifact.json";
import type { TablesInsert } from "@/lib/supabase/database.types";
import { enforceRateLimits } from "@/lib/security/rate-limit";
import { apiErrorResponse, publicErrorResponse } from "@/lib/security/public-error";
import {
  hashIdentifier,
  requestContextForSecurityEvent,
  securityEvent,
} from "@/lib/security/security-event";

// Each verified candidate triggers a separate `isOwner()` RPC call. Cap the
// list size before any chain read happens so one request can't fan out into
// hundreds of provider hits. CommunityPool deployments rarely have more than a
// handful of co-owners; 20 leaves ample headroom.
const MAX_CANDIDATES = 20;

/**
 * `POST /api/pools/owners`
 *
 * Persists the per-pool owner mapping used by the app's withdraw permission
 * gate. The mapping was previously written directly from the browser, which
 * meant the only RLS check was `auth.uid() = created_by_user_id` — any
 * authenticated user could insert a row claiming any wallet as an owner of
 * any pool. Writes now flow through this route and are gated by an on-chain
 * `isOwner(address)` check against the pool contract itself, so candidate
 * addresses that aren't actually owners are dropped before any row is
 * persisted. The service-role client is then used to bypass RLS for the
 * insert (the table's INSERT/UPDATE/DELETE policies have been removed).
 */
export async function POST(request: Request) {
  const ctx = requestContextForSecurityEvent(request);
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    securityEvent({
      ...ctx,
      event_type: "api.auth_required",
      severity: "medium",
      status_code: 401,
      safe_message: "Authenticated API access required.",
    });
    return apiErrorResponse({
      error: "Authentication required",
      code: "authentication_required",
      status: 401,
      request,
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiErrorResponse({
      error: "Invalid request",
      code: "invalid_request",
      status: 400,
      request,
    });
  }

  const parsed = parseRequestBody(body);
  if (!parsed.ok) {
    return apiErrorResponse({
      error: "Invalid request",
      code: "invalid_request",
      status: 400,
      request,
    });
  }
  const { chainId, poolAddress, candidates } = parsed.value;
  securityEvent({
    ...ctx,
    event_type: "pool.owner_sync.started",
    severity: "info",
    user_id_hash: hashIdentifier(user.id),
    chain_id: chainId,
    pool_address: poolAddress,
    metadata: { candidate_count: candidates.length },
  });

  const limited = await enforceRateLimits([
    {
      name: "pool_owners_user_pool",
      identifier: `${user.id}:${chainId}:${poolAddress.toLowerCase()}`,
    },
  ]);
  if (limited) return limited;

  const provider = getServerReadOnlyProviderForChain(chainId);
  if (!provider) {
    securityEvent({
      ...ctx,
      event_type: "pool.owner_sync.provider_unavailable",
      severity: "high",
      status_code: 503,
      chain_id: chainId,
      pool_address: poolAddress,
      safe_message: "Provider unavailable for owner verification.",
    });
    return apiErrorResponse({
      error: "Service unavailable",
      code: "service_unavailable",
      status: 503,
      request,
    });
  }

  const pool = new Contract(poolAddress, communityPoolArtifact.abi, provider);

  let chainDeployer: string;
  try {
    chainDeployer = getAddress((await pool.getOwner()) as string);
  } catch (err) {
    return publicErrorResponse(err, "Unable to verify pool ownership", 502);
  }

  // Always include the on-chain deployer; merge with caller-supplied
  // candidates so co-owners (which the contract doesn't enumerate) get
  // verified individually.
  const seen = new Set<string>([chainDeployer]);
  const verified: { ownerAddress: string; isDeployer: boolean }[] = [
    { ownerAddress: chainDeployer, isDeployer: true },
  ];
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    let isOwner: boolean;
    try {
      isOwner = (await pool.isOwner(candidate)) as boolean;
    } catch (err) {
      securityEvent({
        ...ctx,
        event_type: "pool.owner_sync.provider_failure",
        severity: "high",
        status_code: 502,
        user_id_hash: hashIdentifier(user.id),
        chain_id: chainId,
        pool_address: poolAddress,
        wallet_address_hash: hashIdentifier(candidate),
        safe_message:
          "Provider failure prevented owner candidate verification.",
      });
      return publicErrorResponse(err, "Unable to verify pool ownership", 502);
    }
    if (!isOwner) {
      securityEvent({
        ...ctx,
        event_type: "pool.owner_sync.candidate_rejected",
        severity: "medium",
        user_id_hash: hashIdentifier(user.id),
        chain_id: chainId,
        pool_address: poolAddress,
        wallet_address_hash: hashIdentifier(candidate),
        safe_message: "Owner candidate rejected by on-chain verification.",
      });
      continue;
    }
    seen.add(candidate);
    verified.push({ ownerAddress: candidate, isDeployer: false });
  }

  const admin = createAdminClient();
  const rows: TablesInsert<"pool_owner_memberships">[] = verified.map((o) => ({
    chain_id: chainId,
    pool_address: poolAddress,
    owner_address: o.ownerAddress,
    is_deployer: o.isDeployer,
    created_by_user_id: user.id,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await admin.from("pool_owner_memberships").upsert(rows, {
    onConflict: "chain_id,pool_address,owner_address",
  });
  if (error) {
    securityEvent({
      ...ctx,
      event_type: "pool.owner_sync.failed",
      severity: "high",
      status_code: 500,
      user_id_hash: hashIdentifier(user.id),
      chain_id: chainId,
      pool_address: poolAddress,
      safe_message: "Failed to persist verified owner memberships.",
    });
    return publicErrorResponse(error, "Unable to verify pool ownership", 500);
  }

  securityEvent({
    ...ctx,
    event_type: "pool.owner_sync.succeeded",
    severity: "info",
    status_code: 200,
    user_id_hash: hashIdentifier(user.id),
    chain_id: chainId,
    pool_address: poolAddress,
    metadata: { persisted_count: verified.length },
  });

  return NextResponse.json({
    persistedOwners: verified.map((o) => o.ownerAddress),
    deployer: chainDeployer,
  });
}

type ParsedBody =
  | {
      ok: true;
      value: { chainId: number; poolAddress: string; candidates: string[] };
    }
  | { ok: false; error: string };

function parseRequestBody(body: unknown): ParsedBody {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "body must be a json object" };
  }
  const obj = body as Record<string, unknown>;

  const chainIdRaw = obj.chainId;
  const chainId = typeof chainIdRaw === "number" ? chainIdRaw : Number.NaN;
  if (!Number.isFinite(chainId) || chainId <= 0 || !Number.isInteger(chainId)) {
    return { ok: false, error: "chainId must be a positive integer" };
  }

  const poolAddressRaw = obj.poolAddress;
  if (typeof poolAddressRaw !== "string" || !isAddress(poolAddressRaw)) {
    return { ok: false, error: "poolAddress must be a valid EVM address" };
  }
  const poolAddress = getAddress(poolAddressRaw);

  const candidatesRaw = obj.candidates;
  if (!Array.isArray(candidatesRaw)) {
    return { ok: false, error: "candidates must be an array of EVM addresses" };
  }
  if (candidatesRaw.length > MAX_CANDIDATES) {
    return {
      ok: false,
      error: `candidates array exceeds the maximum of ${MAX_CANDIDATES} entries`,
    };
  }
  const candidates: string[] = [];
  for (const raw of candidatesRaw) {
    if (typeof raw !== "string" || !isAddress(raw)) {
      return {
        ok: false,
        error: "every candidate entry must be a valid EVM address",
      };
    }
    candidates.push(getAddress(raw));
  }

  return { ok: true, value: { chainId, poolAddress, candidates } };
}
