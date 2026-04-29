"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createClient, getUserSerialized } from "@/lib/supabase/client";
import {
  getOpenPoolsServerSnapshot,
  getOpenPoolsSnapshot,
  subscribeOpenPoolsFromStorage,
} from "@/lib/pools/open-pools-storage";
import {
  applyOnChainBalancesToCard,
  fetchUserPoolActivities,
  partitionOpenClosed,
  poolCardsFromLocal,
  rowsToCards,
  type PoolCardView,
} from "@/lib/pools/pool-activity-service";
import type { Tables } from "@/lib/supabase/database.types";
import { useWallet } from "@/components/wallet-provider";
import {
  fetchPoolBalancesViaApi,
  readOnlyProviderForChain,
  readPoolOnChainBalances,
  type PoolOnChainBalances,
} from "@/lib/onchain/pool-balances";

const DEBUG =
  process.env.NODE_ENV !== "production" &&
  process.env.NEXT_PUBLIC_POOL_DEBUG === "1";

function balanceKey(chainId: number, addrLower: string): string {
  return `${chainId}-${addrLower}`;
}

export type PoolActivityContextValue = {
  sessionUserId: string | null;
  dbLoading: boolean;
  openPools: PoolCardView[];
  closedPools: PoolCardView[];
  refreshDbPools: () => Promise<void>;
  /**
   * Re-read on-chain balances for all currently-active pools that are on the
   * connected wallet's chain. Safe to call repeatedly; errors are swallowed
   * per-pool (stored values remain as fallback).
   */
  refreshOnChainBalances: () => Promise<void>;
  emptyOpenHint: string;
  emptyClosedHint: string;
};

const PoolActivityContext = createContext<PoolActivityContextValue | null>(
  null,
);

export function PoolActivityProvider({ children }: { children: ReactNode }) {
  const { provider, chainId: walletChainIdRaw } = useWallet();
  const walletChainId = walletChainIdRaw !== null ? Number(walletChainIdRaw) : null;

  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [dbPools, setDbPools] = useState<Tables<"user_pool_activity">[] | null>(
    null,
  );
  const [dbLoading, setDbLoading] = useState(true);
  const [balancesByKey, setBalancesByKey] = useState<
    Map<string, PoolOnChainBalances>
  >(() => new Map());

  const userOpenPools = useSyncExternalStore(
    subscribeOpenPoolsFromStorage,
    getOpenPoolsSnapshot,
    getOpenPoolsServerSnapshot,
  );

  const refreshDbPools = useCallback(async () => {
    const supabase = createClient();
    const user = await getUserSerialized(supabase);
    if (!user) return;
    const { data, error } = await fetchUserPoolActivities(supabase);
    setDbPools(!error ? data : []);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const user = await getUserSerialized(supabase);
      if (cancelled) return;
      if (!user) {
        setSessionUserId(null);
        setDbPools(null);
        setDbLoading(false);
        return;
      }
      setSessionUserId(user.id);
      const { data, error } = await fetchUserPoolActivities(supabase);
      if (!cancelled) {
        setDbPools(!error ? data : []);
        setDbLoading(false);
      }
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) {
        setSessionUserId(null);
        setDbPools(null);
        setDbLoading(false);
        return;
      }
      setSessionUserId(session.user.id);
      setDbLoading(true);
      void fetchUserPoolActivities(supabase).then(({ data, error }) => {
        setDbPools(!error ? data : []);
        setDbLoading(false);
      });
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  // Base cards = partitioned open/closed lists built from DB or localStorage.
  // They carry cached values for `fundedAmountHuman` / `balanceUsd` that get
  // overlaid with fresh chain reads from `balancesByKey` where available.
  const { baseOpen, baseClosed } = useMemo(() => {
    const nowSec = Math.floor(Date.now() / 1000);
    if (sessionUserId) {
      if (dbPools === null) {
        return {
          baseOpen: [] as PoolCardView[],
          baseClosed: [] as PoolCardView[],
        };
      }
      const cards = rowsToCards(dbPools, nowSec);
      const { open, closed } = partitionOpenClosed(cards);
      return { baseOpen: open, baseClosed: closed };
    }
    const cards = poolCardsFromLocal(userOpenPools, nowSec);
    const { open, closed } = partitionOpenClosed(cards);
    return { baseOpen: open, baseClosed: closed };
  }, [sessionUserId, dbPools, userOpenPools]);

  const { openPools, closedPools } = useMemo(() => {
    const overlay = (cards: PoolCardView[]): PoolCardView[] =>
      cards.map((c) => {
        const key = balanceKey(c.chainId, c.contractAddress.toLowerCase());
        const b = balancesByKey.get(key);
        return b ? applyOnChainBalancesToCard(c, b) : c;
      });
    return {
      openPools: overlay(baseOpen),
      closedPools: overlay(baseClosed),
    };
  }, [baseOpen, baseClosed, balancesByKey]);

  // Hydration: hydrate EVERY open pool, not just pools on the connected chain.
  // For each pool we try the wallet provider first (fastest, already authed)
  // and fall back to a read-only public RPC when the wallet isn't available
  // or is on a different chain. Without this fallback, a user viewing Pools
  // without a wallet connected (or on the wrong network) sees the stale
  // deploy-time `funded_amount_human` from the DB even after the chain has
  // moved on.
  const poolsToHydrate = baseOpen;

  const hydrateKey = useMemo(
    () =>
      poolsToHydrate
        .map((c) => `${c.chainId}-${c.contractAddress.toLowerCase()}`)
        .sort()
        .join("|"),
    [poolsToHydrate],
  );

  const latestProviderRef = useRef(provider);
  const latestWalletChainRef = useRef(walletChainId);
  useEffect(() => {
    latestProviderRef.current = provider;
  }, [provider]);
  useEffect(() => {
    latestWalletChainRef.current = walletChainId;
  }, [walletChainId]);

  /**
   * Read balances for a single card with a three-tier fallback:
   *   1. wallet provider (fastest; only when the wallet is on the same chain)
   *   2. server API route `/api/pools/balances` (uses Alchemy key, always
   *      available regardless of wallet state — the primary path for users
   *      viewing Pools without connecting a wallet)
   *   3. public RPC via `readOnlyProviderForChain` (last-resort fallback;
   *      often flaky but useful for local Anvil or if the server route is
   *      disabled)
   */
  const readBalancesForCard = useCallback(
    async (card: PoolCardView): Promise<PoolOnChainBalances | null> => {
      const wallet = latestProviderRef.current;
      const walletChain = latestWalletChainRef.current;
      if (wallet && walletChain === card.chainId) {
        try {
          return await readPoolOnChainBalances(
            wallet,
            card.chainId,
            card.contractAddress,
          );
        } catch {
          /* fall through to server route */
        }
      }
      const viaApi = await fetchPoolBalancesViaApi(
        card.chainId,
        card.contractAddress,
      );
      if (viaApi) return viaApi;
      const fallback = readOnlyProviderForChain(card.chainId);
      if (!fallback) return null;
      try {
        return await readPoolOnChainBalances(
          fallback,
          card.chainId,
          card.contractAddress,
        );
      } catch {
        return null;
      }
    },
    [],
  );

  const hydrateBalances = useCallback(
    async (targets: PoolCardView[]) => {
      const results = await Promise.allSettled(
        targets.map(async (c) => {
          const balances = await readBalancesForCard(c);
          if (!balances) {
            throw new Error(`no provider for chain ${c.chainId}`);
          }
          return { card: c, balances };
        }),
      );
      setBalancesByKey((prev) => {
        const next = new Map(prev);
        for (const r of results) {
          if (r.status !== "fulfilled") continue;
          const { card, balances } = r.value;
          next.set(
            balanceKey(card.chainId, card.contractAddress.toLowerCase()),
            balances,
          );
          if (DEBUG) {
            console.log("[pool-debug] reconcile", {
              pool: card.contractAddress,
              chainId: card.chainId,
              storedAmount: card.fundedAmountHuman,
              storedUsd: card.totalUsd,
              chainBlock: balances.blockNumber,
              chainNativeEth: balances.nativeEth.human,
              chainTokens: balances.tokens.map(
                (t) => `${t.symbol}:${t.human} ($${t.usd.toFixed(2)})`,
              ),
              chainTotalUsd: balances.totalUsd,
              lastTxHash: card.fundTxHash ?? card.deployTxHash,
              lastActivity: card.lastActivity,
            });
          }
        }
        return next;
      });
      if (DEBUG) {
        const failures = results.filter((r) => r.status === "rejected");
        if (failures.length > 0) {
          console.warn("[pool-debug] reconcile failures", failures.length);
        }
      }
    },
    [readBalancesForCard],
  );

  useEffect(() => {
    if (poolsToHydrate.length === 0) return;
    void hydrateBalances(poolsToHydrate);
    // Intentionally key on `hydrateKey` (a stable string), not `poolsToHydrate`
    // (an array reference), to avoid re-firing on every render. We also
    // re-hydrate whenever the wallet connects or switches chains so a
    // freshly-available wallet provider can replace a slower public RPC.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrateKey, hydrateBalances, walletChainId, provider]);

  const refreshOnChainBalances = useCallback(async () => {
    await hydrateBalances(poolsToHydrate);
  }, [hydrateBalances, poolsToHydrate]);

  const emptyOpenHint =
    sessionUserId && dbLoading
      ? "Loading your pools…"
      : sessionUserId
        ? "You don't have any open pools yet. Deploy or fund a pool while signed in to sync here."
        : "You don't have any open pools yet. Deploy one above (saved in this browser when logged out).";

  const emptyClosedHint =
    sessionUserId && dbLoading
      ? "Loading…"
      : "You don't have any expired pools yet.";

  const value = useMemo(
    () => ({
      sessionUserId,
      dbLoading,
      openPools,
      closedPools,
      refreshDbPools,
      refreshOnChainBalances,
      emptyOpenHint,
      emptyClosedHint,
    }),
    [
      sessionUserId,
      dbLoading,
      openPools,
      closedPools,
      refreshDbPools,
      refreshOnChainBalances,
      emptyOpenHint,
      emptyClosedHint,
    ],
  );

  return (
    <PoolActivityContext.Provider value={value}>
      {children}
    </PoolActivityContext.Provider>
  );
}

export function usePoolActivity(): PoolActivityContextValue {
  const ctx = useContext(PoolActivityContext);
  if (!ctx) {
    throw new Error("usePoolActivity must be used within PoolActivityProvider");
  }
  return ctx;
}
