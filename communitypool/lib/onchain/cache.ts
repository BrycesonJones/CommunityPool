import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import type {
  NetworkBundle,
  NormalizedLookupResult,
  RowPersistStatus,
} from "./types";
import { ONCHAIN_CACHE_TTL_SECONDS, SNAPSHOT_VERSION } from "./constants";

export type StoredSnapshot = {
  v: typeof SNAPSHOT_VERSION;
  result: NormalizedLookupResult;
};

export function parseStoredSnapshot(
  raw: Json | null | undefined,
): NormalizedLookupResult | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== SNAPSHOT_VERSION || o.result == null || typeof o.result !== "object") {
    return null;
  }
  return upgradeLookupResult(o.result as NormalizedLookupResult);
}

/** Best-effort upgrade for snapshots written before NormalizedNativeBalance shape. */
function upgradeLookupResult(result: NormalizedLookupResult): NormalizedLookupResult {
  for (const n of result.networks) {
    const nb = n.nativeBalance as unknown as Record<string, unknown> | null;
    if (nb && typeof nb === "object") {
      if (
        !("formattedBalance" in nb) &&
        "balanceDecimal" in nb &&
        typeof nb.balanceDecimal === "string"
      ) {
        nb.formattedBalance = nb.balanceDecimal;
      }
      if (!("rawBalance" in nb)) {
        nb.rawBalance = "0";
      }
      if (!("network" in nb) && "networkId" in nb && typeof nb.networkId === "string") {
        nb.network = nb.networkId;
      }
      if (!("decimals" in nb)) {
        nb.decimals = 18;
      }
    }
    for (const t of n.tokens) {
      const tok = t as unknown as Record<string, unknown>;
      if (!("formattedBalance" in tok) && "balanceDecimal" in tok) {
        tok.formattedBalance = tok.balanceDecimal;
      }
      if (!("rawBalance" in tok)) {
        tok.rawBalance = "0";
      }
    }

    const b = n as NetworkBundle;
    if (
      typeof b.uniqueTransactionCount !== "number" ||
      !Number.isFinite(b.uniqueTransactionCount) ||
      b.uniqueTransactionCount < 0
    ) {
      b.uniqueTransactionCount = b.transactions.length;
    }
    if (typeof b.transactionCountComplete !== "boolean") {
      b.transactionCountComplete = false;
    }
  }
  return result;
}

export function toStoredJson(result: NormalizedLookupResult): Json {
  const wrapped: StoredSnapshot = { v: SNAPSHOT_VERSION, result };
  return wrapped as unknown as Json;
}

function flattenStructured(result: NormalizedLookupResult): {
  native_balances: Json;
  assets: Json;
  transactions: Json;
} {
  const native_balances: unknown[] = [];
  const assets: unknown[] = [];
  const transactions: unknown[] = [];
  for (const n of result.networks) {
    if (n.nativeBalance) native_balances.push(n.nativeBalance);
    for (const t of n.tokens) assets.push(t);
    for (const tx of n.transactions) transactions.push(tx);
  }
  return {
    native_balances: native_balances as Json,
    assets: assets as Json,
    transactions: transactions as Json,
  };
}

function collectErrorMessages(result: NormalizedLookupResult): string | null {
  const parts: string[] = [];
  for (const e of result.errors) {
    parts.push(e.message);
  }
  for (const n of result.networks) {
    for (const e of n.errors) {
      parts.push(e.message);
    }
  }
  if (parts.length === 0) return null;
  return parts.slice(0, 5).join(" | ");
}

function deriveRowStatus(result: NormalizedLookupResult): RowPersistStatus {
  if (result.errors.length > 0) {
    return "error";
  }
  let anyErr = false;
  let anyData = false;
  for (const n of result.networks) {
    if (n.errors.length > 0) anyErr = true;
    if (n.nativeBalance || n.tokens.length > 0 || n.transactions.length > 0) {
      anyData = true;
    }
  }
  if (anyErr && anyData) return "partial";
  if (anyErr) return "error";
  return "success";
}

function primaryNetworkHint(result: NormalizedLookupResult): string | null {
  if (result.resolvedTx?.networkId) return result.resolvedTx.networkId;
  for (const n of result.networks) {
    if (n.nativeBalance || n.tokens.length > 0) return n.networkId;
  }
  return result.networks[0]?.networkId ?? null;
}

function providerForResult(result: NormalizedLookupResult): string | null {
  if (result.input.chainFamily === "bitcoin") return "mempool";
  if (result.input.chainFamily === "evm") return "alchemy";
  return null;
}

export async function readCacheByCanonicalKey(
  supabase: SupabaseClient<Database>,
  userId: string,
  canonicalKey: string,
): Promise<NormalizedLookupResult | null> {
  const { data, error } = await supabase
    .from("user_address_balances")
    .select("onchain_snapshot, snapshot_expires_at, last_fetched_at")
    .eq("user_id", userId)
    .eq("canonical_key", canonicalKey)
    .maybeSingle();

  if (error || !data?.onchain_snapshot) {
    return null;
  }

  const ttlMs = ONCHAIN_CACHE_TTL_SECONDS * 1000;
  const now = Date.now();

  if (data.last_fetched_at) {
    const fetched = new Date(data.last_fetched_at).getTime();
    if (now - fetched > ttlMs) {
      return null;
    }
  } else if (data.snapshot_expires_at) {
    if (new Date(data.snapshot_expires_at).getTime() <= now) {
      return null;
    }
  } else {
    return null;
  }

  return parseStoredSnapshot(data.onchain_snapshot);
}

export async function updateRowSnapshot(
  supabase: SupabaseClient<Database>,
  args: {
    userId: string;
    rowId: string;
    canonicalKey: string;
    inputType: "address" | "tx_hash";
    /** Legacy column `input_kind` — keep in sync until dropped. */
    inputKind: "address" | "tx_hash";
    result: NormalizedLookupResult;
    expiresAt: Date;
    addressBalanceSummary: number | null;
    transactionHashId: string | null;
  },
): Promise<{ error: string | null }> {
  const {
    userId,
    rowId,
    canonicalKey,
    inputType,
    inputKind,
    result,
    expiresAt,
    addressBalanceSummary,
    transactionHashId,
  } = args;

  const { native_balances, assets, transactions } = flattenStructured(result);
  const status = deriveRowStatus(result);
  const errorMessage = collectErrorMessages(result);
  const nowIso = new Date().toISOString();

  const { error } = await supabase
    .from("user_address_balances")
    .update({
      canonical_key: canonicalKey,
      input_type: inputType,
      input_kind: inputKind,
      chain_family: result.input.chainFamily,
      network: primaryNetworkHint(result),
      provider: providerForResult(result),
      native_balances,
      assets,
      transactions,
      status,
      error_message: errorMessage,
      last_fetched_at: nowIso,
      onchain_snapshot: toStoredJson(result),
      snapshot_expires_at: expiresAt.toISOString(),
      address_balance: addressBalanceSummary,
      transaction_hash_id: transactionHashId,
    })
    .eq("id", rowId)
    .eq("user_id", userId);

  return { error: error?.message ?? null };
}
