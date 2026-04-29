import type { Json } from "@/lib/supabase/database.types";
import { parseStoredSnapshot } from "@/lib/onchain/cache";
import { summarizeLookupUsd } from "@/lib/onchain/summarize";
import { normalizeBitcoinAddressInput } from "@/lib/onchain/bitcoin-address";
import type {
  NetworkBundle,
  NormalizedLookupResult,
  NormalizedNativeBalance,
  NormalizedTokenBalance,
} from "@/lib/onchain/types";

export type SavedSnapshotRow = {
  address_id: string;
  onchain_snapshot: Json | null;
  address_balance: number | null;
};

export type SavedTokenTotal = {
  /** Display symbol (preserved casing from first occurrence). */
  symbol: string;
  amount: number;
  /** Sum of known USD parts for this symbol (sorting hint only). */
  usdHint: number;
};

export type SavedAddressesTotals = {
  /** Sum of per-row USD values; null when no row contributed a usable USD figure. */
  totalUsd: number | null;
  /** Combined token/native amounts by symbol, sorted by USD hint then amount. */
  tokenTotals: SavedTokenTotal[];
};

const EVM_ADDR = /^0x[a-fA-F0-9]{40}$/;
const EVM_TX = /^0x[a-fA-F0-9]{64}$/;

function legacySymbolForPaste(addressId: string): string {
  const t = addressId.trim();
  if (EVM_TX.test(t)) return "ETH";
  if (EVM_ADDR.test(t)) return "ETH";
  if (normalizeBitcoinAddressInput(t)) return "BTC";
  return "—";
}

/** Avoid double-counting duplicate network bundles in one snapshot. */
export function dedupeNetworksById(networks: NetworkBundle[]): NetworkBundle[] {
  const seen = new Set<string>();
  const out: NetworkBundle[] = [];
  for (const n of networks) {
    if (seen.has(n.networkId)) continue;
    seen.add(n.networkId);
    out.push(n);
  }
  return out;
}

/** Avoid duplicate token lines within one network (same contract + symbol). */
function dedupeTokensInNetwork(tokens: NormalizedTokenBalance[]): NormalizedTokenBalance[] {
  const seen = new Set<string>();
  const out: NormalizedTokenBalance[] = [];
  for (const t of tokens) {
    const ca = (t.contractAddress ?? "").toLowerCase();
    const sym = t.symbol.trim().toUpperCase();
    const key = `${ca}|${sym}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function rowUsdContribution(row: SavedSnapshotRow): number | null {
  const parsed = parseStoredSnapshot(row.onchain_snapshot);
  if (parsed) {
    const networks = dedupeNetworksById(parsed.networks);
    const u = summarizeLookupUsd({ ...parsed, networks });
    if (u != null) return u;
  }
  if (row.address_balance != null) {
    const n = Number(row.address_balance);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function addTokenBucket(
  buckets: Map<string, { displaySymbol: string; amount: number; usdHint: number }>,
  symbolRaw: string,
  formattedBalance: string,
  usdValue: number | null | undefined,
) {
  const display = symbolRaw.trim() || "TOKEN";
  const key = display.toUpperCase();
  const amt = Number(formattedBalance);
  if (!Number.isFinite(amt) || amt === 0) return;
  const usd = usdValue != null && Number.isFinite(usdValue) ? usdValue : 0;
  const prev = buckets.get(key);
  if (prev) {
    prev.amount += amt;
    prev.usdHint += usd;
  } else {
    buckets.set(key, { displaySymbol: display, amount: amt, usdHint: usd });
  }
}

function accumulateFromParsed(
  parsed: NormalizedLookupResult,
  buckets: Map<string, { displaySymbol: string; amount: number; usdHint: number }>,
) {
  for (const n of dedupeNetworksById(parsed.networks)) {
    const nb = n.nativeBalance as NormalizedNativeBalance | null;
    if (nb?.formattedBalance) {
      const sym = nb.symbol?.trim() || "ETH";
      addTokenBucket(buckets, sym, nb.formattedBalance, nb.usdValue);
    }
    for (const t of dedupeTokensInNetwork(n.tokens)) {
      addTokenBucket(buckets, t.symbol, t.formattedBalance, t.usdValue);
    }
  }
}

/**
 * Aggregates USD and token/native amounts from saved lookup rows only.
 * - USD: sum of per-row values matching dashboard logic: snapshot USD from
 *   `summarizeLookupUsd` on networks deduped by `networkId`, else legacy `address_balance`.
 * - Tokens: sum `formattedBalance` by symbol; per snapshot, networks deduped by `networkId`,
 *   tokens per network deduped by `(contractAddress, symbol)`.
 * - Legacy rows without a parseable snapshot: optional `address_balance` adds USD and one token bucket.
 */
export function computeSavedAddressesTotals(rows: SavedSnapshotRow[]): SavedAddressesTotals {
  let totalUsd = 0;
  let anyUsd = false;
  const buckets = new Map<
    string,
    { displaySymbol: string; amount: number; usdHint: number }
  >();

  for (const row of rows) {
    const u = rowUsdContribution(row);
    if (u != null) {
      totalUsd += u;
      anyUsd = true;
    }

    const parsed = parseStoredSnapshot(row.onchain_snapshot);
    if (parsed) {
      accumulateFromParsed(parsed, buckets);
    } else if (row.address_balance != null) {
      const n = Number(row.address_balance);
      if (Number.isFinite(n) && n !== 0) {
        const sym = legacySymbolForPaste(row.address_id);
        if (sym !== "—") {
          addTokenBucket(buckets, sym, String(n), n);
        }
      }
    }
  }

  const tokenTotals: SavedTokenTotal[] = [...buckets.values()]
    .map((b) => ({
      symbol: b.displaySymbol,
      amount: b.amount,
      usdHint: b.usdHint,
    }))
    .sort((a, b) => {
      if (b.usdHint !== a.usdHint) return b.usdHint - a.usdHint;
      return b.amount - a.amount;
    });

  return {
    totalUsd: anyUsd ? totalUsd : null,
    tokenTotals,
  };
}
