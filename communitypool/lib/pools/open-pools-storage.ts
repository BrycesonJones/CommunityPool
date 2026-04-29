/**
 * Persist pools the user deploys from the app (Open Pools list).
 * Browser localStorage only — no server sync.
 */

export type StoredOpenPool = {
  id: string;
  name: string;
  address: string;
  chainId: number;
  status: "Active";
  totalUsd: number;
  deployedAt: number;
  description?: string;
  expiresAtUnix?: number;
  lastActivity?: "deploy" | "fund" | "withdraw";
  minimumUsdWei?: string;
  assetType?: string;
  fundedAmountHuman?: string;
  deployTxHash?: string;
  fundTxHash?: string;
  fundingStatus?: "funding_pending" | "funded" | "funding_failed";
};

const STORAGE_KEY = "communitypool.openPools.v1";

/** Stable empty list for SSR and `useSyncExternalStore` getServerSnapshot (must not allocate each call). */
export const EMPTY_OPEN_POOLS_SNAPSHOT: StoredOpenPool[] = [];

const POOLS_UPDATED_EVENT = "communitypool-open-pools-updated";

function dispatchPoolsUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(POOLS_UPDATED_EVENT));
}

let snapshotJson: string | null = null;
let snapshotPools: StoredOpenPool[] = [];

function invalidateOpenPoolsSnapshot() {
  snapshotJson = null;
}

/** Server snapshot for `useSyncExternalStore` — always the same empty-array reference. */
export function getOpenPoolsServerSnapshot(): StoredOpenPool[] {
  return EMPTY_OPEN_POOLS_SNAPSHOT;
}

/** Stable snapshot for `useSyncExternalStore` (same array ref if JSON unchanged). */
export function getOpenPoolsSnapshot(): StoredOpenPool[] {
  if (typeof window === "undefined") return EMPTY_OPEN_POOLS_SNAPSHOT;
  const raw = window.localStorage.getItem(STORAGE_KEY) ?? "[]";
  if (raw !== snapshotJson) {
    snapshotJson = raw;
    snapshotPools = safeParse(raw);
  }
  return snapshotPools;
}

/** Subscribe to same-tab pool list updates and cross-tab `localStorage` sync. */
export function subscribeOpenPoolsFromStorage(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => onChange();
  window.addEventListener(POOLS_UPDATED_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(POOLS_UPDATED_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

function safeParse(raw: string | null): StoredOpenPool[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter(isStoredOpenPool);
  } catch {
    return [];
  }
}

function isStoredOpenPool(x: unknown): x is StoredOpenPool {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (
    typeof o.id !== "string" ||
    typeof o.name !== "string" ||
    typeof o.address !== "string" ||
    typeof o.chainId !== "number" ||
    o.status !== "Active" ||
    typeof o.totalUsd !== "number" ||
    typeof o.deployedAt !== "number"
  ) {
    return false;
  }
  if (o.description !== undefined && typeof o.description !== "string") return false;
  if (o.expiresAtUnix !== undefined && typeof o.expiresAtUnix !== "number") return false;
  if (
    o.lastActivity !== undefined &&
    o.lastActivity !== "deploy" &&
    o.lastActivity !== "fund" &&
    o.lastActivity !== "withdraw"
  ) {
    return false;
  }
  if (o.minimumUsdWei !== undefined && typeof o.minimumUsdWei !== "string") return false;
  if (o.assetType !== undefined && typeof o.assetType !== "string") return false;
  if (o.fundedAmountHuman !== undefined && typeof o.fundedAmountHuman !== "string") return false;
  if (o.deployTxHash !== undefined && typeof o.deployTxHash !== "string") return false;
  if (o.fundTxHash !== undefined && typeof o.fundTxHash !== "string") return false;
  if (
    o.fundingStatus !== undefined &&
    o.fundingStatus !== "funding_pending" &&
    o.fundingStatus !== "funded" &&
    o.fundingStatus !== "funding_failed"
  ) {
    return false;
  }
  return true;
}

export function loadOpenPoolsFromStorage(): StoredOpenPool[] {
  if (typeof window === "undefined") return [];
  return safeParse(window.localStorage.getItem(STORAGE_KEY));
}

export function saveOpenPoolsToStorage(pools: StoredOpenPool[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pools));
    invalidateOpenPoolsSnapshot();
  } catch {
    // Best-effort only; on-chain state remains source of truth.
  }
}

/**
 * OWASP A08 F-03: drop the cached pool list on logout / SIGNED_OUT so a
 * shared browser does not show User A's pools to User B during the window
 * before the new user's DB rows replace the cache. Wallet localStorage is
 * cleared by `clearPersistedWallet`; this is the parallel for pools.
 *
 * Emits the same `communitypool-open-pools-updated` event used by
 * `appendOpenPoolToStorage` so any active `useSyncExternalStore` subscriber
 * re-renders immediately, even before the auth-state-change listener fires.
 */
export function clearOpenPoolsFromStorage(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* quota / private mode — nothing else we can do */
  }
  invalidateOpenPoolsSnapshot();
  dispatchPoolsUpdated();
}

export function appendOpenPoolToStorage(entry: StoredOpenPool): StoredOpenPool[] {
  const existing = loadOpenPoolsFromStorage();
  const key = `${entry.chainId}-${entry.address.toLowerCase()}`;
  const filtered = existing.filter(
    (p) => `${p.chainId}-${p.address.toLowerCase()}` !== key,
  );
  const next = [entry, ...filtered];
  saveOpenPoolsToStorage(next);
  dispatchPoolsUpdated();
  return next;
}

export type MergeOpenPoolInput = Partial<StoredOpenPool> &
  Pick<StoredOpenPool, "chainId" | "address">;

/** Merge with an existing entry for the same pool (fund / withdraw) so deploy-time fields stay. */
export function mergeAppendOpenPool(partial: MergeOpenPoolInput): StoredOpenPool[] {
  const existing = loadOpenPoolsFromStorage();
  const key = `${partial.chainId}-${partial.address.toLowerCase()}`;
  const prev = existing.find(
    (p) => `${p.chainId}-${p.address.toLowerCase()}` === key,
  );
  const merged: StoredOpenPool = {
    id: partial.id ?? `${partial.chainId}-${partial.address.toLowerCase()}`,
    name: partial.name ?? prev?.name ?? "Pool",
    address: partial.address,
    chainId: partial.chainId,
    status: "Active",
    totalUsd:
      partial.totalUsd !== undefined ? partial.totalUsd : (prev?.totalUsd ?? 0),
    deployedAt: partial.deployedAt ?? prev?.deployedAt ?? Date.now(),
    description: partial.description ?? prev?.description,
    expiresAtUnix: partial.expiresAtUnix ?? prev?.expiresAtUnix,
    lastActivity: partial.lastActivity ?? prev?.lastActivity,
    minimumUsdWei: partial.minimumUsdWei ?? prev?.minimumUsdWei,
    assetType: partial.assetType ?? prev?.assetType,
    fundedAmountHuman: partial.fundedAmountHuman ?? prev?.fundedAmountHuman,
    deployTxHash: partial.deployTxHash ?? prev?.deployTxHash,
    fundTxHash: partial.fundTxHash ?? prev?.fundTxHash,
    fundingStatus: partial.fundingStatus ?? prev?.fundingStatus,
  };
  return appendOpenPoolToStorage(merged);
}
