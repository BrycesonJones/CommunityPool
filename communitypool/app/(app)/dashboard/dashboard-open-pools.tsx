"use client";

import { useCallback, useState } from "react";
import { usePoolActivity } from "@/components/pool-activity-provider";
import { useWallet } from "@/components/wallet-provider";
import { createClient } from "@/lib/supabase/client";
import {
  OpenPoolsSection,
  type PoolRowAction,
} from "@/app/(app)/pools/pools-list-sections";
import FundPoolModal, {
  type FundedPoolSummary,
} from "@/app/(app)/pools/fund-pool-modal";
import WithdrawPoolModal, {
  type WithdrawnPoolSummary,
} from "@/app/(app)/pools/withdraw-pool-modal";
import { mergeAppendOpenPool } from "@/lib/pools/open-pools-storage";
import {
  readPoolSnapshotFromChain,
  upsertPoolActivity,
} from "@/lib/pools/pool-activity-service";
import {
  readPoolOnChainBalances,
  type PoolOnChainBalances,
} from "@/lib/onchain/pool-balances";

export default function DashboardOpenPools() {
  const { provider } = useWallet();
  const { openPools, emptyOpenHint, refreshDbPools, refreshOnChainBalances } =
    usePoolActivity();
  const [openModal, setOpenModal] = useState<"none" | "fund" | "withdraw">(
    "none",
  );
  const [rowActionPool, setRowActionPool] = useState<PoolRowAction | null>(
    null,
  );

  const closeModal = useCallback(() => {
    setOpenModal("none");
    setRowActionPool(null);
  }, []);

  const handleFundPoolRow = useCallback((pool: PoolRowAction) => {
    setRowActionPool(pool);
    setOpenModal("fund");
  }, []);

  const handleWithdrawPoolRow = useCallback((pool: PoolRowAction) => {
    setRowActionPool(pool);
    setOpenModal("withdraw");
  }, []);

  // Mirror the pools-content persistence flow so dashboard row actions keep
  // Supabase + local storage in sync after fund/withdraw.
  const persistToSupabase = useCallback(
    async (input: {
      lastActivity: "fund" | "withdraw";
      newTxHashes: string[];
      chainId: number;
      poolAddress: string;
      name: string;
      totalUsdEstimate: number | null;
      fundTxHash?: string | null;
    }) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const name = input.name;
      const description = "";
      let expiresAtUnix = 0;
      let minimumUsdWei: string | null = null;
      let onChainBalances: PoolOnChainBalances | undefined;

      if (provider) {
        try {
          const snap = await readPoolSnapshotFromChain(
            provider,
            input.poolAddress,
          );
          expiresAtUnix = snap.expiresAtUnix;
          minimumUsdWei = snap.minimumUsdWei;
        } catch {
          /* keep row values */
        }
        try {
          onChainBalances = await readPoolOnChainBalances(
            provider,
            input.chainId,
            input.poolAddress,
          );
        } catch {
          /* keep whatever caller supplied */
        }
      }

      if (expiresAtUnix <= 0) return;

      await upsertPoolActivity(supabase, {
        userId: user.id,
        chainId: input.chainId,
        poolAddress: input.poolAddress,
        lastActivity: input.lastActivity,
        newTxHashes: input.newTxHashes,
        name,
        description,
        expiresAtUnix,
        minimumUsdWei,
        totalUsdEstimate: input.totalUsdEstimate,
        fundTxHash: input.fundTxHash,
        onChainBalances,
      });
      await refreshDbPools();
      await refreshOnChainBalances();
    },
    [provider, refreshDbPools, refreshOnChainBalances],
  );

  const handlePoolFunded = useCallback(
    async (summary: FundedPoolSummary) => {
      mergeAppendOpenPool({
        name: summary.poolName,
        address: summary.poolAddress,
        chainId: summary.chainId,
        totalUsd: summary.totalUsd,
        lastActivity: "fund",
        fundTxHash: summary.fundTxHash,
      });
      await persistToSupabase({
        lastActivity: "fund",
        newTxHashes: [summary.fundTxHash],
        chainId: summary.chainId,
        poolAddress: summary.poolAddress,
        name: summary.poolName,
        // Chain read inside persistToSupabase is the source of truth.
        totalUsdEstimate: null,
        fundTxHash: summary.fundTxHash || null,
      });
    },
    [persistToSupabase],
  );

  const handlePoolWithdrawn = useCallback(
    async (summary: WithdrawnPoolSummary) => {
      mergeAppendOpenPool({
        name: summary.poolName,
        address: summary.poolAddress,
        chainId: summary.chainId,
        lastActivity: "withdraw",
      });
      await persistToSupabase({
        lastActivity: "withdraw",
        newTxHashes: summary.withdrawTxHashes,
        chainId: summary.chainId,
        poolAddress: summary.poolAddress,
        name: summary.poolName,
        // Chain read reconciles against remaining balance; pass null to
        // preserve prior when chain is unreachable instead of zeroing.
        totalUsdEstimate: null,
      });
    },
    [persistToSupabase],
  );

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-6">
      <OpenPoolsSection
        openPools={[...openPools]}
        emptyOpenHint={emptyOpenHint}
        listTopMarginClass=""
        onFundPool={handleFundPoolRow}
        onWithdrawPool={handleWithdrawPoolRow}
      />

      <FundPoolModal
        open={openModal === "fund"}
        onClose={closeModal}
        onFunded={handlePoolFunded}
        initialPool={
          rowActionPool
            ? { name: rowActionPool.name, address: rowActionPool.address }
            : undefined
        }
      />
      <WithdrawPoolModal
        open={openModal === "withdraw"}
        onClose={closeModal}
        onWithdrawn={handlePoolWithdrawn}
        initialPool={
          rowActionPool
            ? { name: rowActionPool.name, address: rowActionPool.address }
            : undefined
        }
      />
    </section>
  );
}
