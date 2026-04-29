"use client";

import { useState, useCallback } from "react";
import DeployPoolModal, { type DeployedPoolSummary } from "./deploy-pool-modal";
import FundPoolModal, { type FundedPoolSummary } from "./fund-pool-modal";
import WithdrawPoolModal, { type WithdrawnPoolSummary } from "./withdraw-pool-modal";
import PoolsListSections, { type PoolRowAction } from "./pools-list-sections";
import KycRequiredModal from "./kyc-required-modal";
import { usePoolActivity } from "@/components/pool-activity-provider";
import { useWallet } from "@/components/wallet-provider";
import { createClient } from "@/lib/supabase/client";
import { fetchKycStatus } from "@/lib/profile/kyc";
import {
  mergeAppendOpenPool,
  appendOpenPoolToStorage,
  type StoredOpenPool,
} from "@/lib/pools/open-pools-storage";
import {
  readPoolSnapshotFromChain,
  upsertPoolActivity,
} from "@/lib/pools/pool-activity-service";
import { upsertPoolOwners } from "@/lib/pools/pool-ownership-service";
import {
  readPoolOnChainBalances,
  type PoolOnChainBalances,
} from "@/lib/onchain/pool-balances";
import { explorerUrlForChainTx } from "@/lib/onchain/explorer-urls";
import { postClientSecurityEvent } from "@/lib/security/client-security-event";

export default function PoolsContent() {
  const { provider } = useWallet();
  const {
    openPools,
    closedPools,
    refreshDbPools,
    refreshOnChainBalances,
    emptyOpenHint,
    emptyClosedHint,
  } = usePoolActivity();
  const [openModal, setOpenModal] = useState<
    "none" | "deploy" | "fund" | "withdraw"
  >("none");
  const [kycRequiredOpen, setKycRequiredOpen] = useState(false);
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  /**
   * Pool context bound to row-level Fund/Withdraw actions. Passed as
   * `initialPool` to the modal so it prefills + jumps past the address step.
   * Cleared when the modal closes.
   */
  const [rowActionPool, setRowActionPool] = useState<PoolRowAction | null>(
    null,
  );

  const closeModal = useCallback(() => {
    setOpenModal("none");
    setRowActionPool(null);
  }, []);

  const handleDeployClick = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setOpenModal("deploy");
      return;
    }
    try {
      const status = await fetchKycStatus(supabase, user);
      if (!status.complete) {
        setKycRequiredOpen(true);
        return;
      }
    } catch {
      // If profile lookup fails, fall through and let the deploy modal's
      // own runDeploy() guard re-check before submitting on-chain.
    }
    setOpenModal("deploy");
  }, []);

  const handleFundPoolRow = useCallback((pool: PoolRowAction) => {
    setRowActionPool(pool);
    setOpenModal("fund");
  }, []);

  const handleWithdrawPoolRow = useCallback((pool: PoolRowAction) => {
    setRowActionPool(pool);
    setOpenModal("withdraw");
  }, []);

  const persistToSupabase = useCallback(
    async (input: {
      lastActivity: "deploy" | "fund" | "withdraw";
      newTxHashes: string[];
      chainId: number;
      poolAddress: string;
      name: string;
      description: string;
      expiresAtUnix: number;
      minimumUsdWei: string | null;
      /**
       * Only honored when we cannot reach chain. When `onChainBalances` is
       * read below, it supersedes this value entirely. Pass `null` to
       * preserve the prior persisted value.
       */
      totalUsdEstimate: number | null;
      assetType?: string | null;
      fundedAmountHuman?: string | null;
      deployTxHash?: string | null;
      fundTxHash?: string | null;
      fundingStatus?: "funding_pending" | "funded" | "funding_failed" | null;
    }) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const name = input.name;
      const description = input.description;
      let expiresAtUnix = input.expiresAtUnix;
      let minimumUsdWei = input.minimumUsdWei;
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
          /* use form / row values */
        }
        try {
          onChainBalances = await readPoolOnChainBalances(
            provider,
            input.chainId,
            input.poolAddress,
          );
        } catch {
          /* fall back to caller-supplied fields */
        }
      }

      if (expiresAtUnix <= 0) {
        throw new Error("Could not verify pool expiration for persistence");
      }

      const persisted = await upsertPoolActivity(supabase, {
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
        assetType: input.assetType,
        fundedAmountHuman: input.fundedAmountHuman,
        deployTxHash: input.deployTxHash,
        fundTxHash: input.fundTxHash,
        fundingStatus: input.fundingStatus,
        onChainBalances,
      });
      if (persisted.error) {
        throw persisted.error;
      }
      await refreshDbPools();
      await refreshOnChainBalances();
    },
    [provider, refreshDbPools, refreshOnChainBalances],
  );

  const handlePoolDeployed = useCallback(
    async (pool: DeployedPoolSummary) => {
      const entry: StoredOpenPool = {
        id: `${pool.chainId}-${pool.address.toLowerCase()}`,
        name: pool.name,
        address: pool.address,
        chainId: pool.chainId,
        status: "Active",
        totalUsd: pool.totalUsd,
        deployedAt: Date.now(),
        description: pool.description,
        expiresAtUnix: pool.expiresAtUnix,
        lastActivity: "deploy",
        minimumUsdWei: pool.minimumUsdWei,
        assetType: pool.assetType,
        fundedAmountHuman: pool.fundedAmountHuman,
        deployTxHash: pool.deployTxHash,
        fundTxHash: pool.fundTxHash ?? undefined,
        fundingStatus: pool.fundingStatus,
      };
      try {
        appendOpenPoolToStorage(entry);
      } catch {
        setRecoveryNotice(
          `Your transaction was confirmed on-chain, but CommunityPool could not save local app state. Save this transaction hash (${pool.fundTxHash ?? pool.deployTxHash}) and refresh.`,
        );
      }

      await postClientSecurityEvent({
        event_type: "pool.deploy.confirmed",
        severity: "info",
        chain_id: pool.chainId,
        pool_address: pool.address,
        tx_hash: pool.fundTxHash ?? pool.deployTxHash,
        safe_message:
          pool.fundingStatus === "funded"
            ? "Pool deploy and initial funding confirmed on-chain."
            : "Pool deploy confirmed on-chain.",
      });

      try {
        await persistToSupabase({
          lastActivity: "deploy",
          newTxHashes: [pool.deployTxHash, pool.fundTxHash].filter(
            (h): h is string => Boolean(h),
          ),
          chainId: pool.chainId,
          poolAddress: pool.address,
          name: pool.name,
          description: pool.description,
          expiresAtUnix: pool.expiresAtUnix,
          minimumUsdWei: pool.minimumUsdWei,
          totalUsdEstimate: pool.totalUsd,
          assetType: pool.assetType || null,
          fundedAmountHuman: pool.fundedAmountHuman || null,
          deployTxHash: pool.deployTxHash || null,
          fundTxHash: pool.fundTxHash || null,
          fundingStatus: pool.fundingStatus,
        });
      } catch (error) {
        const explorer = explorerUrlForChainTx(pool.chainId, pool.deployTxHash);
        await postClientSecurityEvent({
          event_type: "pool.deploy.db_persist_failed",
          severity: "critical",
          chain_id: pool.chainId,
          pool_address: pool.address,
          tx_hash: pool.deployTxHash,
          db_persist_ok: false,
          needs_recovery: true,
          explorer_url: explorer ?? undefined,
          safe_message: "Pool deployment persisted on-chain but app record write failed.",
          error_code: error instanceof Error ? error.message : "persist_failed",
        });
        await postClientSecurityEvent({
          event_type: "pool.deploy.recovery_needed",
          severity: "critical",
          chain_id: pool.chainId,
          pool_address: pool.address,
          tx_hash: pool.deployTxHash,
          needs_recovery: true,
          explorer_url: explorer ?? undefined,
          safe_message: "Deployment recovery required after persistence failure.",
        });
        setRecoveryNotice(
          `Your transaction was confirmed on-chain, but CommunityPool could not save the app record. Your funds are not lost. Save this transaction hash (${pool.deployTxHash}) and use Recover Pool, or contact support.`,
        );
      }

      // OWASP A08 F-02: write the deploy into the service-role-only
      // ledger via /api/pools/record-deployment. The route re-verifies the
      // tx receipt on the server's RPC before inserting, so this is the
      // authoritative quota source — `user_pool_activity` (above) is just
      // a UX cache and is no longer trusted for the Free-tier limit.
      // The server route reads the user from the session and rejects 401
      // when logged out, so skip the call in that case.
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        try {
          const res = await fetch("/api/pools/record-deployment", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              chainId: pool.chainId,
              poolAddress: pool.address,
              deployTxHash: pool.deployTxHash,
            }),
          });
          if (!res.ok && res.status !== 202) {
            // 202 = tx_pending, the server route asks the client to retry
            // once the receipt is visible to its provider. Other non-2xx
            // statuses are logged as a security event but do NOT roll back
            // the on-chain deploy — the user can re-trigger the recording
            // by re-running their next deploy or via a future recovery UI.
            await postClientSecurityEvent({
              event_type: "pool.deploy.ledger_record_failed",
              severity: "high",
              chain_id: pool.chainId,
              pool_address: pool.address,
              tx_hash: pool.deployTxHash,
              error_code: `http_${res.status}`,
              safe_message:
                "Pool deploy confirmed on-chain but ledger record write failed.",
            });
          }
        } catch (recordError) {
          await postClientSecurityEvent({
            event_type: "pool.deploy.ledger_record_failed",
            severity: "high",
            chain_id: pool.chainId,
            pool_address: pool.address,
            tx_hash: pool.deployTxHash,
            error_code:
              recordError instanceof Error ? recordError.message : "record_failed",
            safe_message:
              "Pool deploy confirmed on-chain but ledger record request failed.",
          });
        }

        const ownerPersist = await upsertPoolOwners({
          chainId: pool.chainId,
          poolAddress: pool.address,
          deployerAddress: pool.deployerAddress,
          coOwnerAddresses: pool.coOwners,
        });
        if (ownerPersist.error) {
          await postClientSecurityEvent({
            event_type: "pool.owner_sync.failed",
            severity: "high",
            chain_id: pool.chainId,
            pool_address: pool.address,
            tx_hash: pool.deployTxHash,
            error_code: ownerPersist.error.message,
            safe_message: "Pool owner sync failed after confirmed deployment.",
          });
          setRecoveryNotice(
            `Your transaction was confirmed on-chain, but CommunityPool could not save owner sync data. Save this transaction hash (${pool.deployTxHash}) and retry sync.`,
          );
        }
      }
    },
    [persistToSupabase],
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
        fundingStatus: "funded",
      });

      await postClientSecurityEvent({
        event_type: "pool.fund.confirmed",
        severity: "info",
        chain_id: summary.chainId,
        pool_address: summary.poolAddress,
        tx_hash: summary.fundTxHash,
        safe_message: "Pool funding confirmed on-chain.",
      });
      try {
        await persistToSupabase({
          lastActivity: "fund",
          newTxHashes: [summary.fundTxHash],
          chainId: summary.chainId,
          poolAddress: summary.poolAddress,
          name: summary.poolName,
          description: "",
          expiresAtUnix: 0,
          minimumUsdWei: null,
          // Chain read inside persistToSupabase is the source of truth. The
          // user-typed `summary.totalUsd` is only the contribution size, not
          // the pool's aggregate balance; passing null preserves prior when
          // the chain read fails.
          totalUsdEstimate: null,
          fundTxHash: summary.fundTxHash || null,
          fundingStatus: "funded",
        });
      } catch (error) {
        const explorer = explorerUrlForChainTx(summary.chainId, summary.fundTxHash);
        await postClientSecurityEvent({
          event_type: "pool.fund.db_persist_failed",
          severity: "critical",
          chain_id: summary.chainId,
          pool_address: summary.poolAddress,
          tx_hash: summary.fundTxHash,
          db_persist_ok: false,
          needs_recovery: true,
          explorer_url: explorer ?? undefined,
          error_code: error instanceof Error ? error.message : "persist_failed",
          safe_message: "Pool fund persisted on-chain but app record write failed.",
        });
        setRecoveryNotice(
          `Your transaction was confirmed on-chain, but CommunityPool could not save the app record. Your funds are not lost. Save this transaction hash (${summary.fundTxHash}) and use Recover Pool, or contact support.`,
        );
      }
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

      const latestHash = summary.withdrawTxHashes.at(-1);
      await postClientSecurityEvent({
        event_type: "pool.withdraw.confirmed",
        severity: "info",
        chain_id: summary.chainId,
        pool_address: summary.poolAddress,
        tx_hash: latestHash,
        safe_message: "Pool withdrawal confirmed on-chain.",
      });
      try {
        await persistToSupabase({
          lastActivity: "withdraw",
          newTxHashes: summary.withdrawTxHashes,
          chainId: summary.chainId,
          poolAddress: summary.poolAddress,
          name: summary.poolName,
          description: "",
          expiresAtUnix: 0,
          minimumUsdWei: null,
          // Withdraw previously hard-coded 0 here which zeroed the row even on
          // partial withdraws. Chain read inside persistToSupabase reconciles
          // against actual remaining balance.
          totalUsdEstimate: null,
        });
      } catch (error) {
        const explorer = latestHash
          ? explorerUrlForChainTx(summary.chainId, latestHash)
          : null;
        await postClientSecurityEvent({
          event_type: "pool.withdraw.db_persist_failed",
          severity: "critical",
          chain_id: summary.chainId,
          pool_address: summary.poolAddress,
          tx_hash: latestHash ?? undefined,
          db_persist_ok: false,
          needs_recovery: true,
          explorer_url: explorer ?? undefined,
          error_code: error instanceof Error ? error.message : "persist_failed",
          safe_message: "Pool withdraw persisted on-chain but app record write failed.",
        });
        await postClientSecurityEvent({
          event_type: "pool.withdraw.recovery_needed",
          severity: "critical",
          chain_id: summary.chainId,
          pool_address: summary.poolAddress,
          tx_hash: latestHash ?? undefined,
          needs_recovery: true,
          explorer_url: explorer ?? undefined,
          safe_message: "Withdrawal recovery required after persistence failure.",
        });
        setRecoveryNotice(
          `Your transaction was confirmed on-chain, but CommunityPool could not save the app record. Your funds are not lost. Save this transaction hash (${latestHash ?? "unknown"}) and use Recover Pool, or contact support.`,
        );
      }
    },
    [persistToSupabase],
  );

  return (
    <>
      <div className="relative flex-1 max-w-6xl mx-auto w-full px-4 py-8">
        {recoveryNotice ? (
          <p
            className="mb-4 rounded-lg border border-amber-700/60 bg-amber-950/30 p-3 text-sm text-amber-200"
            role="alert"
          >
            {recoveryNotice}
          </p>
        ) : null}
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            onClick={() => void handleDeployClick()}
            className="rounded-lg border border-zinc-700 px-6 py-3 text-base font-medium text-zinc-100 hover:border-zinc-500 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-black"
          >
            Deploy a CommunityPool
          </button>
          <button
            type="button"
            onClick={() => setOpenModal("fund")}
            className="rounded-lg border border-zinc-700 px-6 py-3 text-base font-medium text-zinc-100 hover:border-zinc-500 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-black"
          >
            Fund a Pool
          </button>
          <button
            type="button"
            onClick={() => setOpenModal("withdraw")}
            className="rounded-lg border border-zinc-700 px-6 py-3 text-base font-medium text-zinc-100 hover:border-zinc-500 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-black"
          >
            Withdraw from Pool
          </button>
        </div>

        <PoolsListSections
          openPools={[...openPools]}
          closedPools={[...closedPools]}
          emptyOpenHint={emptyOpenHint}
          emptyClosedHint={emptyClosedHint}
          onFundPool={handleFundPoolRow}
          onWithdrawPool={handleWithdrawPoolRow}
        />
      </div>

      <DeployPoolModal
        open={openModal === "deploy"}
        onClose={closeModal}
        onDeployed={handlePoolDeployed}
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
      <KycRequiredModal
        open={kycRequiredOpen}
        onClose={() => setKycRequiredOpen(false)}
      />
    </>
  );
}
