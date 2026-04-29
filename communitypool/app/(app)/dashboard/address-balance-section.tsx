"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient, getUserSerialized } from "@/lib/supabase/client";
import type { Json, Tables } from "@/lib/supabase/database.types";
import { parseStoredSnapshot, toStoredJson } from "@/lib/onchain/cache";
import { explorerUrlForUserAddressRow } from "@/lib/onchain/explorer-urls";
import { computeSavedAddressesTotals } from "@/lib/onchain/saved-addresses-totals";
import { summarizeLookupUsd } from "@/lib/onchain/summarize";
import { normalizeBitcoinAddressInput } from "@/lib/onchain/bitcoin-address";
import type {
  NormalizedLookupResult,
  NormalizedNativeBalance,
  NormalizedTokenBalance,
  NetworkBundle,
} from "@/lib/onchain/types";

/** Matches EVM preview cap in on-chain providers. */
const TX_PREVIEW_CAP = 40;

type NetworkAmountSection = {
  networkLabel: string;
  assetLines: string[];
  /** One or two lines: total vs sample / partial lower bound. */
  transactionLines: string[];
};

/** Display row for workspace or saved lookup tables. */
type LookupTableRow = {
  id: string;
  address: string;
  tokenType: string;
  /** Block explorer URL when the paste is a recognized address or hash. */
  explorerUrl: string | null;
  /** Plain-text summary (tooltip / copy); mirrors structured sections when present. */
  amount: string;
  amountSections?: NetworkAmountSection[];
  balanceUsd: string;
  amountTitle?: string;
};

type UserAddressBalanceRow = Tables<"user_address_balances">;
type UserSavedLookupRow = Tables<"user_saved_lookups">;

type LookupSnapshotFields = Pick<
  UserAddressBalanceRow,
  "address_id" | "onchain_snapshot" | "address_balance"
>;

const EVM_ADDR = /^0x[a-fA-F0-9]{40}$/;
const EVM_TX = /^0x[a-fA-F0-9]{64}$/;

/** Normalize EVM hex to lowercase; leave BTC unchanged. */
function normalizeForStorage(raw: string): string {
  const t = raw.trim();
  if (EVM_ADDR.test(t) || EVM_TX.test(t)) return t.toLowerCase();
  return normalizeBitcoinAddressInput(t) ?? t;
}

function detectTokenType(stored: string): string {
  const trimmed = stored.trim();
  if (EVM_TX.test(trimmed)) return "EVM TX";
  if (EVM_ADDR.test(trimmed)) return "ETH";
  if (normalizeBitcoinAddressInput(trimmed)) return "BTC";
  return "—";
}

function isValidPaste(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  if (EVM_ADDR.test(t)) return true;
  if (EVM_TX.test(t)) return true;
  if (normalizeBitcoinAddressInput(t)) return true;
  return false;
}

function symbolForTokenType(tokenType: string): string {
  if (tokenType === "BTC") return "BTC";
  if (tokenType === "PAXG") return "PAXG";
  if (tokenType === "EVM TX") return "ETH";
  return "ETH";
}

function shortDecimal(s: string, maxFrac = 6): string {
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return n.toLocaleString(undefined, { maximumFractionDigits: maxFrac });
}

function humanNetworkLabel(networkId: string): string {
  switch (networkId) {
    case "eth-mainnet":
      return "Ethereum Mainnet";
    case "eth-sepolia":
      return "Sepolia";
    case "bitcoin-mainnet":
      return "Bitcoin";
    default:
      return networkId
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
  }
}

function networkHasBalances(n: NetworkBundle): boolean {
  if (n.nativeBalance) return true;
  return n.tokens.length > 0;
}

/** Dashboard copy: never show preview length as the explorer total unless scan completed. */
function transactionSummaryLines(n: NetworkBundle): string[] {
  const sample = n.transactions.length;
  const unique = n.uniqueTransactionCount;
  const complete = n.transactionCountComplete;

  if (complete) {
    return [`Transactions: ${unique}`];
  }

  const lines: string[] = [`Showing ${sample} recent txs`];
  const showAtLeast =
    unique > sample ||
    (sample >= TX_PREVIEW_CAP && unique >= sample && sample > 0);
  if (showAtLeast) {
    lines.push(`At least ${unique} unique txs (fetch limit)`);
  }
  return lines;
}

function nativeAmountLine(nb: NormalizedNativeBalance): string | null {
  const amt =
    nb.formattedBalance ??
    (nb as { balanceDecimal?: string }).balanceDecimal ??
    null;
  if (amt == null) return null;
  return `${shortDecimal(amt)} ${nb.symbol}`;
}

function tokenAmountLine(t: NormalizedTokenBalance): string {
  const amt = t.formattedBalance ?? "0";
  const sym = t.symbol?.trim() || "TOKEN";
  return `${shortDecimal(amt)} ${sym}`;
}

function formatAmountFromRow(row: LookupSnapshotFields): {
  sections: NetworkAmountSection[] | null;
  plainText: string;
  title: string;
} {
  const parsed = parseStoredSnapshot(row.onchain_snapshot);
  if (parsed) {
    return formatAmountFromLookup(parsed);
  }
  const tokenType = detectTokenType(row.address_id);
  const symbol = symbolForTokenType(tokenType);
  const line =
    row.address_balance != null
      ? `${Number(row.address_balance).toLocaleString(undefined, {
          maximumFractionDigits: 8,
        })} ${symbol}`
      : `— ${symbol}`;
  return { sections: null, plainText: line, title: line };
}

function formatAmountFromLookup(parsed: NormalizedLookupResult): {
  sections: NetworkAmountSection[] | null;
  plainText: string;
  title: string;
} {
  const sections: NetworkAmountSection[] = [];
  const titleParts: string[] = [];

  if (parsed.resolvedTx) {
    titleParts.push(
      `Tx on ${parsed.resolvedTx.networkId} → ${parsed.resolvedTx.to ?? parsed.resolvedTx.from ?? "?"}`,
    );
  }

  for (const n of parsed.networks) {
    if (!networkHasBalances(n)) continue;

    const assetLines: string[] = [];
    if (n.nativeBalance) {
      const nl = nativeAmountLine(n.nativeBalance);
      if (nl) assetLines.push(nl);
    }
    for (const t of n.tokens) {
      assetLines.push(tokenAmountLine(t));
    }

    sections.push({
      networkLabel: humanNetworkLabel(n.networkId),
      assetLines,
      transactionLines: transactionSummaryLines(n),
    });

    for (const e of n.errors) {
      titleParts.push(`${n.networkId}: [${e.code}] ${e.message}`);
    }
  }

  for (const n of parsed.networks) {
    if (networkHasBalances(n)) continue;
    for (const e of n.errors) {
      titleParts.push(`${n.networkId}: [${e.code}] ${e.message}`);
    }
  }

  for (const e of parsed.errors) {
    titleParts.push(`[${e.code}] ${e.message}`);
  }

  let plainText: string;
  if (sections.length > 0) {
    plainText = sections
      .map((s) => {
        const txBlock = s.transactionLines.join("\n");
        return `${s.networkLabel}\n${s.assetLines.join("\n")}\n${txBlock}`;
      })
      .join("\n\n");
  } else {
    const errMsg =
      parsed.errors[0]?.message ??
      parsed.networks.flatMap((n) => n.errors.map((e) => e.message))[0];
    plainText = errMsg ?? "No on-chain data yet — refresh";
  }

  const title =
    titleParts.length > 0 ? `${titleParts.join("\n")}\n\n${plainText}` : plainText;

  return {
    sections: sections.length > 0 ? sections : null,
    plainText,
    title,
  };
}

function formatUsdFromRow(row: LookupSnapshotFields): string {
  const parsed = parseStoredSnapshot(row.onchain_snapshot);
  if (parsed) {
    const u = summarizeLookupUsd(parsed);
    if (u != null) {
      return `$${u.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    }
  }
  if (row.address_balance != null) {
    return `$${Number(row.address_balance).toLocaleString(undefined, {
      maximumFractionDigits: 2,
    })}`;
  }
  return "—";
}

function rowToLookupTableRow(id: string, row: LookupSnapshotFields): LookupTableRow {
  const tokenType = detectTokenType(row.address_id);
  const { sections, plainText, title } = formatAmountFromRow(row);
  return {
    id,
    address: row.address_id,
    tokenType,
    explorerUrl: explorerUrlForUserAddressRow(row),
    amount: plainText,
    amountSections: sections ?? undefined,
    amountTitle: title,
    balanceUsd: formatUsdFromRow(row),
  };
}

function usernameFromUser(user: {
  user_metadata?: Record<string, unknown>;
}): string | null {
  const raw = user.user_metadata?.username;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

async function postLookup(body: {
  raw: string;
  /**
   * Workspace row id to persist the snapshot against. Omit for lookups that
   * should not mutate `user_address_balances` (e.g. the Saved Addresses
   * page-load refresh).
   */
  rowId?: string;
  forceRefresh?: boolean;
}): Promise<NormalizedLookupResult> {
  const res = await fetch("/api/onchain/lookup", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as
    | NormalizedLookupResult
    | { error?: string };
  if (!res.ok) {
    const msg =
      typeof json === "object" && json && "error" in json && json.error
        ? String(json.error)
        : `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return json as NormalizedLookupResult;
}

function tableHeadRow() {
  return (
    <tr className="border-b border-zinc-800">
      <th className="text-left py-3 px-2 font-medium text-zinc-400">
        Address / hash
      </th>
      <th className="text-left py-3 px-2 font-medium text-zinc-400">Type</th>
      <th className="text-left py-3 px-2 font-medium text-zinc-400 min-w-[12rem]">
        Amount
      </th>
      <th className="text-left py-3 px-2 font-medium text-zinc-400">
        Balance (USD)
      </th>
      <th className="text-right py-3 px-2 font-medium text-zinc-400 w-32">
        Actions
      </th>
    </tr>
  );
}

function BookmarkIcon({ filled }: { filled: boolean }) {
  if (filled) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-brand-300"
        aria-hidden
      >
        <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z" />
      </svg>
    );
  }
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z" />
    </svg>
  );
}

function LookupTableRowView({
  item,
  showSave,
  isSaved,
  savingLookup,
  onSave,
  onRemoveWorkspace,
  onRemoveSaved,
}: {
  item: LookupTableRow;
  showSave: boolean;
  isSaved: boolean;
  savingLookup: boolean;
  onSave?: () => void;
  onRemoveWorkspace?: () => void;
  onRemoveSaved?: () => void;
}) {
  return (
    <tr className="border-b border-zinc-800/80 hover:bg-zinc-900/40">
      <td className="py-3 px-2 text-white font-mono text-xs">
        {item.explorerUrl ? (
          <a
            href={item.explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-300/90 hover:text-brand-200 hover:underline focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-zinc-950 rounded-sm break-all"
          >
            {item.address}
          </a>
        ) : (
          item.address
        )}
      </td>
      <td className="py-3 px-2 text-zinc-300">{item.tokenType}</td>
      <td
        className="py-3 px-2 text-zinc-300 min-w-[12rem] max-w-[28rem] align-top"
        title={item.amountTitle}
      >
        {item.amountSections && item.amountSections.length > 0 ? (
          <div className="flex flex-col gap-3 text-xs">
            {item.amountSections.map((sec, secIdx) => (
              <div key={secIdx} className="flex flex-col gap-0.5">
                <div className="font-medium text-zinc-200">{sec.networkLabel}</div>
                {sec.assetLines.map((line, lineIdx) => (
                  <div
                    key={lineIdx}
                    className="font-mono tabular-nums break-all"
                  >
                    {line}
                  </div>
                ))}
                <div className="text-zinc-400 flex flex-col gap-0.5">
                  {sec.transactionLines.map((line, txLineIdx) => (
                    <div key={txLineIdx}>{line}</div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <span className="whitespace-pre-line break-words">{item.amount}</span>
        )}
      </td>
      <td className="py-3 px-2 text-zinc-300">{item.balanceUsd}</td>
      <td className="py-3 px-2 text-right whitespace-nowrap">
        <div className="inline-flex items-center justify-end gap-1">
          {showSave && onSave && (
            <button
              type="button"
              onClick={() => void onSave()}
              disabled={savingLookup}
              className="text-zinc-500 hover:text-brand-300 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-zinc-950 rounded p-1 disabled:opacity-50"
              title={
                isSaved
                  ? "Update saved snapshot in Saved Addresses"
                  : "Save to Saved Addresses"
              }
              aria-label={
                isSaved
                  ? `Update saved entry for ${item.address}`
                  : `Save ${item.address} to Saved Addresses`
              }
              aria-pressed={isSaved}
            >
              <BookmarkIcon filled={isSaved} />
            </button>
          )}
          {onRemoveWorkspace && (
            <button
              type="button"
              onClick={() => void onRemoveWorkspace()}
              className="text-zinc-500 hover:text-amber-400 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-zinc-950 rounded p-1"
              aria-label={`Remove ${item.address} from list`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 6h18" />
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
            </button>
          )}
          {onRemoveSaved && (
            <button
              type="button"
              onClick={() => void onRemoveSaved()}
              className="text-zinc-500 hover:text-amber-400 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-zinc-950 rounded p-1"
              aria-label={`Remove ${item.address} from saved`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 6h18" />
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function AddressBalanceSection() {
  const [input, setInput] = useState("");
  const [workspaceRows, setWorkspaceRows] = useState<UserAddressBalanceRow[]>(
    [],
  );
  const [savedRows, setSavedRows] = useState<UserSavedLookupRow[]>([]);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingLookupId, setSavingLookupId] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [refreshingSaved, setRefreshingSaved] = useState(false);
  // Guards against firing the page-load refresh more than once per mount.
  const savedRefreshStartedRef = useRef(false);

  const savedKeys = useMemo(
    () =>
      new Set(
        savedRows.map((r) => normalizeForStorage(r.address_id)),
      ),
    [savedRows],
  );

  const savedTotals = useMemo(
    () => computeSavedAddressesTotals(savedRows),
    [savedRows],
  );

  /**
   * Page-load refresh for Saved Addresses only.
   *
   * Fetches fresh on-chain data for each saved row via the existing lookup
   * pipeline (the server honors its cache TTL, giving a stale-while-revalidate
   * feel) and then persists the updated snapshot into `user_saved_lookups`.
   * The workspace `Public Address Information` table is intentionally NOT
   * refreshed here — that is per the product rule that only saved rows should
   * refresh on page load.
   *
   * Note on tx hashes: saved rows may contain either an address or an EVM tx
   * hash. Re-running the lookup for a tx hash re-resolves the tx's address and
   * fetches its current balances — this is the same behavior as the manual
   * save flow, so no special-casing is needed.
   */
  const refreshSavedAddressesInBackground = useCallback(
    async (userId: string, rows: UserSavedLookupRow[]) => {
      if (rows.length === 0) return;

      setRefreshingSaved(true);
      try {
        const supabase = createClient();

        // Small concurrency cap to avoid hammering providers for users with
        // many saved addresses. Cache-hit paths are cheap; misses hit Alchemy
        // and friends, so cap in-flight work here rather than at the server.
        const CONCURRENCY = 4;
        const updated = new Map<
          string,
          { snapshot: Json; balance: number | null; updatedAt: string }
        >();

        let cursor = 0;
        const worker = async () => {
          while (true) {
            const i = cursor++;
            if (i >= rows.length) return;
            const row = rows[i];
            try {
              const lookup = await postLookup({
                raw: row.address_id,
                // Omit rowId so the server does not write this into the
                // workspace `user_address_balances` table — saved refresh
                // must not mutate workspace rows.
              });
              updated.set(row.id, {
                snapshot: toStoredJson(lookup) as Json,
                balance: summarizeLookupUsd(lookup),
                updatedAt: new Date().toISOString(),
              });
            } catch {
              // Soft-fail: leave the existing cached snapshot in place for
              // this row and continue with the rest.
            }
          }
        };

        const workers = Array.from(
          { length: Math.min(CONCURRENCY, rows.length) },
          () => worker(),
        );
        await Promise.all(workers);

        if (updated.size === 0) return;

        setSavedRows((prev) =>
          prev.map((r) => {
            const u = updated.get(r.id);
            if (!u) return r;
            return {
              ...r,
              onchain_snapshot: u.snapshot,
              address_balance: u.balance,
              updated_at: u.updatedAt,
            };
          }),
        );

        await Promise.all(
          Array.from(updated.entries()).map(([id, u]) =>
            supabase
              .from("user_saved_lookups")
              .update({
                onchain_snapshot: u.snapshot,
                address_balance: u.balance,
                updated_at: u.updatedAt,
              })
              .eq("id", id)
              .eq("user_id", userId),
          ),
        );
      } finally {
        setRefreshingSaved(false);
      }
    },
    [],
  );

  const refreshData = useCallback(async () => {
    const supabase = createClient();
    const user = await getUserSerialized(supabase);

    if (!user) {
      setSignedIn(false);
      setWorkspaceRows([]);
      setSavedRows([]);
      setLoadError("");
      setLoading(false);
      return;
    }

    setSignedIn(true);

    const [balancesRes, savedRes] = await Promise.all([
      supabase
        .from("user_address_balances")
        .select("*")
        .order("created_at", { ascending: true }),
      supabase
        .from("user_saved_lookups")
        .select("*")
        .order("created_at", { ascending: true }),
    ]);

    const errParts: string[] = [];
    if (balancesRes.error) errParts.push(balancesRes.error.message);
    if (savedRes.error) errParts.push(savedRes.error.message);
    setLoadError(errParts.length ? errParts.join(" · ") : "");

    setWorkspaceRows((balancesRes.data ?? []) as UserAddressBalanceRow[]);
    const savedList = (savedRes.data ?? []) as UserSavedLookupRow[];
    setSavedRows(savedList);

    setLoading(false);

    // Kick off the page-load refresh for Saved Addresses exactly once per
    // mount, after cached data has been rendered. The refresh is
    // fire-and-forget so it never blocks the rest of the dashboard.
    if (!savedRefreshStartedRef.current && savedList.length > 0) {
      savedRefreshStartedRef.current = true;
      void refreshSavedAddressesInBackground(user.id, savedList);
    }
  }, [refreshSavedAddressesInBackground]);

  useEffect(() => {
    void refreshData();
  }, [refreshData]);

  async function handleAdd() {
    setError("");
    const trimmed = input.trim();
    if (!trimmed) {
      setError("Please enter an address or transaction hash.");
      return;
    }
    if (!isValidPaste(trimmed)) {
      setError(
        "Invalid format. Use an EVM address, 0x-prefixed EVM tx hash, or BTC address.",
      );
      return;
    }
    const normalized = normalizeForStorage(trimmed);
    const exists = workspaceRows.some(
      (r) => normalizeForStorage(r.address_id) === normalized,
    );
    if (exists) {
      setError("This address or hash is already in your list.");
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const user = await getUserSerialized(supabase);

    if (!user) {
      setSaving(false);
      setError("You must be signed in to save addresses.");
      return;
    }

    const { data, error: insertError } = await supabase
      .from("user_address_balances")
      .insert({
        user_id: user.id,
        username: usernameFromUser(user),
        // address_id: legacy column = user-pasted identifier (address or tx hash). TODO: rename DB column when stable.
        address_id: normalized,
      })
      .select()
      .single();

    if (insertError) {
      setSaving(false);
      if (insertError.code === "23505") {
        setError("This address or hash is already in your list.");
        void refreshData();
        return;
      }
      setError(insertError.message);
      return;
    }

    if (data) {
      try {
        const lookup = await postLookup({ raw: normalized, rowId: data.id });
        if (lookup.errors.length > 0) {
          setError(lookup.errors.map((e) => e.message).join(" "));
        }
        const summary = summarizeLookupUsd(lookup);
        const merged: UserAddressBalanceRow = {
          ...(data as UserAddressBalanceRow),
          onchain_snapshot: toStoredJson(lookup) as Json,
          address_balance: summary,
          last_fetched_at: lookup.fetchedAt,
        };
        setWorkspaceRows((prev) => {
          const others = prev.filter((r) => r.id !== data.id);
          return [...others, merged];
        });
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : "Saved locally but on-chain lookup failed.",
        );
        await refreshData();
      }
    }
    setSaving(false);
    setInput("");
  }

  async function handleRemoveWorkspace(id: string) {
    setError("");
    const supabase = createClient();
    const { error: deleteError } = await supabase
      .from("user_address_balances")
      .delete()
      .eq("id", id);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setWorkspaceRows((prev) => prev.filter((r) => r.id !== id));
  }

  async function handleSaveLookup(row: UserAddressBalanceRow) {
    setError("");
    setSavingLookupId(row.id);
    const supabase = createClient();
    const user = await getUserSerialized(supabase);

    if (!user) {
      setSavingLookupId(null);
      setError("You must be signed in to save addresses.");
      return;
    }

    const now = new Date().toISOString();
    const { error: upsertError } = await supabase.from("user_saved_lookups").upsert(
      {
        user_id: user.id,
        address_id: row.address_id,
        onchain_snapshot: row.onchain_snapshot,
        address_balance: row.address_balance,
        updated_at: now,
      },
      { onConflict: "user_id,address_id" },
    );

    setSavingLookupId(null);

    if (upsertError) {
      setError(upsertError.message);
      return;
    }

    const { data, error: fetchSavedError } = await supabase
      .from("user_saved_lookups")
      .select("*")
      .order("created_at", { ascending: true });

    if (fetchSavedError) {
      setError(fetchSavedError.message);
      return;
    }
    setSavedRows((data ?? []) as UserSavedLookupRow[]);
  }

  async function handleRemoveSaved(id: string) {
    setError("");
    const supabase = createClient();
    const { error: deleteError } = await supabase
      .from("user_saved_lookups")
      .delete()
      .eq("id", id);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setSavedRows((prev) => prev.filter((r) => r.id !== id));
  }

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-6">
      <h2 className="text-lg font-semibold text-white mb-4">
        Public Address Information
      </h2>
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <label htmlFor="address-input" className="sr-only">
          Search or paste address or transaction hash
        </label>
        <input
          id="address-input"
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setError("");
          }}
          onKeyDown={(e) => e.key === "Enter" && void handleAdd()}
          placeholder="Paste BTC address, 0x tx hash, or EVM address"
          className="flex-1 min-w-0 rounded-lg border border-zinc-700 bg-zinc-900/50 px-4 py-3 text-white placeholder:text-zinc-500 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
          aria-invalid={!!error}
          aria-describedby={error ? "address-error" : undefined}
        />
        <button
          type="button"
          onClick={() => void handleAdd()}
          disabled={saving || loading}
          className="shrink-0 rounded-lg border border-zinc-700 px-5 py-3 text-sm font-medium text-zinc-100 hover:border-zinc-500 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-black disabled:opacity-50 disabled:pointer-events-none"
        >
          {saving ? "Saving…" : "Search"}
        </button>
      </div>
      {loadError && (
        <p className="mb-4 text-sm text-amber-400" role="alert">
          {loadError}
        </p>
      )}
      {error && (
        <p id="address-error" className="mb-4 text-sm text-amber-400" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p className="text-sm text-zinc-500 py-8 text-center border border-dashed border-zinc-800 rounded-lg">
          Loading addresses…
        </p>
      ) : !signedIn ? (
        <p className="text-sm text-zinc-500 py-8 text-center border border-dashed border-zinc-800 rounded-lg">
          Sign in to save and sync addresses across devices.
        </p>
      ) : workspaceRows.length === 0 ? (
        <p className="text-sm text-zinc-500 py-8 text-center">
          Click Search to revieve address information
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>{tableHeadRow()}</thead>
            <tbody>
              {workspaceRows.map((row) => {
                const item = rowToLookupTableRow(row.id, row);
                const isSaved = savedKeys.has(
                  normalizeForStorage(row.address_id),
                );
                return (
                  <LookupTableRowView
                    key={row.id}
                    item={item}
                    showSave
                    isSaved={isSaved}
                    savingLookup={savingLookupId === row.id}
                    onSave={() => void handleSaveLookup(row)}
                    onRemoveWorkspace={() => void handleRemoveWorkspace(row.id)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {signedIn && !loading && (
        <div className="mt-10 pt-8 border-t border-zinc-800">
          <div
            className={
              savedRows.length > 0
                ? "mb-4 flex flex-col gap-3"
                : "mb-4"
            }
          >
            <div className="flex items-center gap-2 shrink-0">
              <h3 className="text-base font-semibold text-white">
                Saved Addresses
              </h3>
              {refreshingSaved && (
                <span
                  className="text-xs text-zinc-500"
                  role="status"
                  aria-live="polite"
                >
                  Refreshing…
                </span>
              )}
            </div>
            {savedRows.length > 0 && (
              <div className="mx-auto h-56 w-56 shrink-0 rounded-full border-2 border-brand-400 bg-zinc-900/50 p-6 flex flex-col items-center justify-center text-center">
                <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  Total Saved Balance
                </div>
                <div className="mt-0.5 text-xl font-semibold tabular-nums text-white">
                  {savedTotals.totalUsd != null
                    ? `$${savedTotals.totalUsd.toLocaleString(undefined, {
                        maximumFractionDigits: 2,
                      })}`
                    : "—"}
                </div>
                {savedTotals.tokenTotals.length > 0 && (
                  <ul className="mt-2 max-h-16 w-full space-y-0.5 overflow-y-auto border-t border-zinc-800/80 pt-2 text-xs text-zinc-400">
                    {savedTotals.tokenTotals.map((t) => (
                      <li key={t.symbol}>
                        {shortDecimal(String(t.amount))} {t.symbol}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
          {savedRows.length === 0 ? (
            <p className="text-sm text-zinc-500 py-6 text-center">
              Save rows from the table above with the bookmark control.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>{tableHeadRow()}</thead>
                <tbody>
                  {savedRows.map((row) => {
                    const item = rowToLookupTableRow(row.id, row);
                    return (
                      <LookupTableRowView
                        key={row.id}
                        item={item}
                        showSave={false}
                        isSaved={false}
                        savingLookup={false}
                        onRemoveSaved={() => void handleRemoveSaved(row.id)}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
