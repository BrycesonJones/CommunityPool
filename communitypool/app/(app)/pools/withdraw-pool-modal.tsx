"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Contract, formatUnits, getAddress, isAddress, parseUnits } from "ethers";
import { useWallet } from "@/components/wallet-provider";
import {
  poolSupportsPartialWithdraw,
  releaseExpiredFundsToDeployer,
  withdrawPoolEth,
  withdrawPoolEthAmount,
  withdrawPoolToken,
  withdrawPoolTokenAmount,
} from "@/lib/onchain/community-pool";
import communityPoolArtifact from "@/lib/onchain/community-pool-artifact.json";
import { weiForUsdContribution } from "@/lib/onchain/price-math";
import {
  getErc20Presets,
  getPoolChainConfig,
  type Erc20PresetId,
} from "@/lib/onchain/pool-chain-config";
import {
  erc20UsdToHumanAmountString,
  validateFundEthUsdHuman,
} from "@/lib/onchain/tx-economics";
import { postClientSecurityEvent } from "@/lib/security/client-security-event";

type Step = 1 | 2 | 3 | 4;

type WithdrawMode = "eth_only" | "erc20_only" | "both";

type Erc20Pick = Erc20PresetId | "custom";
const ERC20_READ_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
] as const;

export type WithdrawnPoolSummary = {
  poolName: string;
  poolAddress: string;
  chainId: number;
  withdrawTxHashes: string[];
  totalUsdEstimate: number;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onWithdrawn?: (summary: WithdrawnPoolSummary) => void;
  /**
   * Prefill the pool context and jump through the ownership check directly
   * to step 3 ("What would you like to withdraw?"). Used by the Open Pools
   * row-level Withdraw action. Verification still runs; we just advance
   * automatically once it succeeds.
   */
  initialPool?: { name?: string; address: string };
};

function BackIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </svg>
  );
}

type VerificationStatus = "idle" | "pending" | "success" | "error";
type VerificationFailureReason =
  | "not_owner"
  | "provider_unavailable"
  | "wrong_chain"
  | "wallet_unavailable"
  | "invalid_pool";

export default function WithdrawPoolModal({
  open,
  onClose,
  onWithdrawn,
  initialPool,
}: Props) {
  const {
    provider,
    signer,
    walletAddress,
    isConnected,
    chainId,
    isWrongNetwork,
    switchToExpectedNetwork,
  } = useWallet();

  const [step, setStep] = useState<Step>(1);
  const [poolName, setPoolName] = useState("");
  const [poolAddress, setPoolAddress] = useState("");
  const [withdrawMode, setWithdrawMode] = useState<WithdrawMode>("eth_only");
  const [erc20Pick, setErc20Pick] = useState<Erc20Pick>("wbtc");
  const [customToken, setCustomToken] = useState("");
  /** User-entered USD notional, matching deploy/fund flows. Zero-length until typed. */
  const [ethWithdrawUsd, setEthWithdrawUsd] = useState("");
  const [tokenWithdrawUsd, setTokenWithdrawUsd] = useState("");
  /** Flag set by the "Max" button; submit then uses the cheaper full-balance path. Cleared on edit. */
  const [ethMax, setEthMax] = useState(false);
  const [tokenMax, setTokenMax] = useState(false);
  /** Live USD→wei/token preview for the current input, updated as user types. `null` while pending. */
  const [ethPreviewWei, setEthPreviewWei] = useState<bigint | null>(null);
  const [tokenPreviewRaw, setTokenPreviewRaw] = useState<bigint | null>(null);
  const [verificationStatus, setVerificationStatus] =
    useState<VerificationStatus>("idle");
  const [verificationFailureReason, setVerificationFailureReason] =
    useState<VerificationFailureReason | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [withdrawPending, setWithdrawPending] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [lastTxHashes, setLastTxHashes] = useState<string[]>([]);
  /** Past expiresAt on-chain: owner withdraws disabled; use release to deployer. */
  const [poolChainExpired, setPoolChainExpired] = useState(false);
  const [poolDeployerAddress, setPoolDeployerAddress] = useState<string | null>(null);
  /**
   * `true` when the pool bytecode exposes `withdraw(uint256)` +
   * `withdrawTokenAmount(...)`; `false` when it only exposes the full-balance
   * legacy paths. `null` while still probing. Immutable once a pool is
   * deployed, so legacy pools can never do partial withdraw.
   */
  const [supportsPartial, setSupportsPartial] = useState<boolean | null>(null);
  const [ethPoolBalanceWei, setEthPoolBalanceWei] = useState<bigint | null>(null);
  const [tokenPoolBalanceRaw, setTokenPoolBalanceRaw] = useState<bigint | null>(null);
  const [tokenDecimals, setTokenDecimals] = useState<number | null>(null);
  const [tokenSymbol, setTokenSymbol] = useState<string>("");
  /** When opened with `initialPool`, auto-advance past the verify step once it succeeds. */
  const [autoAdvanceAfterVerify, setAutoAdvanceAfterVerify] = useState(false);

  const erc20Presets = useMemo(
    () => (chainId !== null ? getErc20Presets(chainId) : []),
    [chainId],
  );

  useEffect(() => {
    if (erc20Presets.length === 0 && (withdrawMode === "erc20_only" || withdrawMode === "both")) {
      setWithdrawMode("eth_only");
    }
    const ids = new Set(erc20Presets.map((p) => p.id));
    if (erc20Pick !== "custom" && !ids.has(erc20Pick)) {
      const first = erc20Presets[0];
      setErc20Pick(first ? first.id : "custom");
    }
  }, [erc20Presets, withdrawMode, erc20Pick]);

  const resetForm = useCallback(() => {
    setStep(1);
    setPoolName("");
    setPoolAddress("");
    setWithdrawMode("eth_only");
    setErc20Pick("wbtc");
    setCustomToken("");
    setEthWithdrawUsd("");
    setTokenWithdrawUsd("");
    setEthMax(false);
    setTokenMax(false);
    setEthPreviewWei(null);
    setTokenPreviewRaw(null);
    setVerificationStatus("idle");
    setVerificationFailureReason(null);
    setErrors({});
    setWithdrawPending(false);
    setWithdrawError(null);
    setLastTxHashes([]);
    setPoolChainExpired(false);
    setPoolDeployerAddress(null);
    setSupportsPartial(null);
    setEthPoolBalanceWei(null);
    setTokenPoolBalanceRaw(null);
    setTokenDecimals(null);
    setTokenSymbol("");
    setAutoAdvanceAfterVerify(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    resetForm();
    if (initialPool && initialPool.address) {
      setPoolName(initialPool.name ?? "");
      setPoolAddress(initialPool.address);
      setStep(2);
      setAutoAdvanceAfterVerify(true);
    }
    // initialPool is read at open-time only; we don't rebind while open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, resetForm]);

  useEffect(() => {
    if (!open) return;
    if (step !== 2) return;
    if (!autoAdvanceAfterVerify) return;
    if (verificationStatus !== "success") return;
    setAutoAdvanceAfterVerify(false);
    setStep(3);
  }, [open, step, autoAdvanceAfterVerify, verificationStatus]);

  useEffect(() => {
    if (!open || step !== 2) return;
    if (isWrongNetwork) {
      setPoolChainExpired(false);
      setPoolDeployerAddress(null);
      setSupportsPartial(null);
      setVerificationFailureReason("wrong_chain");
      setVerificationStatus("error");
      return;
    }
    if (!provider || !isConnected || !walletAddress || chainId === null) {
      setPoolChainExpired(false);
      setPoolDeployerAddress(null);
      setSupportsPartial(null);
      setVerificationFailureReason("wallet_unavailable");
      setVerificationStatus("error");
      return;
    }
    const addr = poolAddress.trim();
    if (!isAddress(addr)) {
      setPoolChainExpired(false);
      setPoolDeployerAddress(null);
      setSupportsPartial(null);
      setVerificationFailureReason("invalid_pool");
      setVerificationStatus("error");
      return;
    }

    setVerificationStatus("pending");
    setVerificationFailureReason(null);
    setPoolChainExpired(false);
    setPoolDeployerAddress(null);
    setSupportsPartial(null);
    const pool = new Contract(
      getAddress(addr),
      communityPoolArtifact.abi,
      provider,
    );

    (async () => {
      try {
        const expiresAt = (await pool.expiresAt()) as bigint;
        const block = await provider.getBlock("latest");
        if (!block) {
          setVerificationFailureReason("provider_unavailable");
          setVerificationStatus("error");
          return;
        }
        const now = BigInt(block.timestamp);
        const expired = now > expiresAt;
        setPoolChainExpired(expired);
        const dep = (await pool.getOwner()) as string;
        setPoolDeployerAddress(getAddress(dep));

        // Immutable per pool, so probing once at verify time is enough. Used
        // by step 3 to pick the right UI (USD partial input vs full-balance).
        const partial = await poolSupportsPartialWithdraw(provider, addr);
        setSupportsPartial(partial);

        if (expired) {
          setVerificationFailureReason(null);
          setVerificationStatus("success");
        } else {
          // The on-chain contract's `isOwner(address)` view mirrors the exact
          // predicate enforced by `onlyOwner` on withdraw. Using it as the
          // source of truth avoids false-negatives when the app-side
          // `pool_owner_memberships` row is missing (pre-migration pools,
          // silent upsert failures, cross-session deploys, RLS gaps).
          const isOwnerOnChain = (await pool.isOwner(walletAddress)) as boolean;
          setVerificationFailureReason(isOwnerOnChain ? null : "not_owner");
          setVerificationStatus(isOwnerOnChain ? "success" : "error");
        }
      } catch {
        setVerificationFailureReason("provider_unavailable");
        setVerificationStatus("error");
        setPoolChainExpired(false);
        setPoolDeployerAddress(null);
        setSupportsPartial(null);
      }
    })();
  }, [
    open,
    step,
    provider,
    isConnected,
    walletAddress,
    poolAddress,
    chainId,
    isWrongNetwork,
  ]);

  // useCallback so the balance-hydration effect below can list it as a dep
  // without re-firing every render. Closure deps are exactly what the
  // function reads, mirroring the existing per-effect dep set.
  const resolveErc20Token = useCallback((): string => {
    if (erc20Pick === "custom") {
      return getAddress(customToken.trim());
    }
    const p = erc20Presets.find((x) => x.id === erc20Pick);
    if (!p) throw new Error("ERC20 preset not available on this network.");
    return getAddress(p.token);
  }, [erc20Pick, customToken, erc20Presets]);

  function validateStep1(): boolean {
    const next: Record<string, string> = {};
    const addr = poolAddress.trim();
    if (!addr) next.pool = "Enter the pool contract address.";
    else if (!isAddress(addr)) next.pool = "Enter a valid Ethereum address (0x…).";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  useEffect(() => {
    if (!open || (step !== 3 && step !== 4) || poolChainExpired) return;
    if (!provider || chainId === null) return;
    const pool = poolAddress.trim();
    if (!isAddress(pool)) return;

    let cancelled = false;
    (async () => {
      try {
        const ethBal = await provider.getBalance(getAddress(pool));
        if (!cancelled) setEthPoolBalanceWei(ethBal);
      } catch {
        if (!cancelled) setEthPoolBalanceWei(null);
      }

      if (withdrawMode === "erc20_only" || withdrawMode === "both") {
        try {
          const tokenAddr = resolveErc20Token();
          const token = new Contract(tokenAddr, ERC20_READ_ABI, provider);
          const [bal, decs, sym] = await Promise.all([
            token.balanceOf(getAddress(pool)) as Promise<bigint>,
            token.decimals() as Promise<number>,
            token.symbol().catch(() => ""),
          ]);
          if (!cancelled) {
            setTokenPoolBalanceRaw(bal);
            setTokenDecimals(Number(decs));
            setTokenSymbol(
              String(sym || "").trim() ||
                (erc20Pick === "custom"
                  ? getAddress(tokenAddr).slice(0, 6)
                  : (erc20Presets.find((p) => p.id === erc20Pick)?.symbol ?? "ERC20")),
            );
          }
        } catch {
          if (!cancelled) {
            setTokenPoolBalanceRaw(null);
            setTokenDecimals(null);
            setTokenSymbol("");
          }
        }
      } else if (!cancelled) {
        setTokenPoolBalanceRaw(null);
        setTokenDecimals(null);
        setTokenSymbol("");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    open,
    step,
    poolChainExpired,
    provider,
    chainId,
    poolAddress,
    withdrawMode,
    resolveErc20Token,
    erc20Pick,
    erc20Presets,
  ]);

  // Live USD → ETH preview for the partial-withdraw input. Converts at the
  // *current* Chainlink price; the actual submit re-reads the price so the
  // on-chain amount reflects spot at tx time, not preview time.
  useEffect(() => {
    if (!open || step !== 3 || poolChainExpired) return;
    if (supportsPartial !== true) {
      setEthPreviewWei(null);
      return;
    }
    if (withdrawMode !== "eth_only" && withdrawMode !== "both") {
      setEthPreviewWei(null);
      return;
    }
    if (!signer || chainId === null) return;
    const err = validateFundEthUsdHuman(ethWithdrawUsd);
    if (err) {
      setEthPreviewWei(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const cfg = getPoolChainConfig(chainId);
        const wei = await weiForUsdContribution(signer, cfg.ethUsdPriceFeed, ethWithdrawUsd.trim());
        if (!cancelled) setEthPreviewWei(wei);
      } catch {
        if (!cancelled) setEthPreviewWei(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, step, poolChainExpired, supportsPartial, withdrawMode, signer, chainId, ethWithdrawUsd]);

  // Live USD → token preview for the partial-withdraw input. Custom tokens
  // cannot be priced client-side (no Chainlink feed), so the preview is
  // suppressed and partial USD input is disabled for custom picks.
  useEffect(() => {
    if (!open || step !== 3 || poolChainExpired) return;
    if (supportsPartial !== true) {
      setTokenPreviewRaw(null);
      return;
    }
    if (withdrawMode !== "erc20_only" && withdrawMode !== "both") {
      setTokenPreviewRaw(null);
      return;
    }
    if (erc20Pick === "custom") {
      setTokenPreviewRaw(null);
      return;
    }
    if (!signer) return;
    const preset = erc20Presets.find((p) => p.id === erc20Pick);
    if (!preset) return;
    const t = tokenWithdrawUsd.trim();
    if (!t) {
      setTokenPreviewRaw(null);
      return;
    }
    const n = parseFloat(t);
    if (!Number.isFinite(n) || n <= 0) {
      setTokenPreviewRaw(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const human = await erc20UsdToHumanAmountString(signer, preset, t);
        if (cancelled) return;
        if (human === null) {
          setTokenPreviewRaw(null);
          return;
        }
        setTokenPreviewRaw(parseUnits(human, preset.decimals));
      } catch {
        if (!cancelled) setTokenPreviewRaw(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, step, poolChainExpired, supportsPartial, withdrawMode, erc20Pick, tokenWithdrawUsd, signer, erc20Presets]);

  function validateStep3(): boolean {
    if (poolChainExpired) return true;
    const next: Record<string, string> = {};
    if (withdrawMode === "erc20_only" || withdrawMode === "both") {
      if (erc20Presets.length === 0) {
        next.withdrawMode = "No default ERC20s on this network; withdraw ETH only.";
      }
      if (erc20Pick === "custom") {
        const t = customToken.trim();
        if (!t || !isAddress(t)) next.customToken = "Enter a valid ERC20 token address.";
      }
    }

    const runEth = withdrawMode === "eth_only" || withdrawMode === "both";
    const runErc20 = withdrawMode === "erc20_only" || withdrawMode === "both";
    // Legacy pools (partial withdraw unavailable) always withdraw the full
    // balance; USD input is hidden and nothing to validate amount-wise.
    if (supportsPartial === false) {
      setErrors(next);
      return Object.keys(next).length === 0;
    }
    if (runEth && !ethMax) {
      const err = validateFundEthUsdHuman(ethWithdrawUsd);
      if (err) next.ethWithdrawUsd = err;
      else if (
        ethPreviewWei !== null &&
        ethPoolBalanceWei !== null &&
        ethPreviewWei > ethPoolBalanceWei
      ) {
        next.ethWithdrawUsd = "Withdraw amount exceeds pool ETH balance.";
      }
    }
    if (runErc20 && !tokenMax) {
      if (erc20Pick === "custom") {
        // Custom token has no Chainlink feed to convert USD; only Max is
        // available for these. Redirect user accordingly.
        next.tokenWithdrawUsd = "Use Max to withdraw a custom ERC20 (no USD price feed).";
      } else {
        const err = validateFundEthUsdHuman(tokenWithdrawUsd);
        if (err) next.tokenWithdrawUsd = err;
        else if (
          tokenPreviewRaw !== null &&
          tokenPoolBalanceRaw !== null &&
          tokenPreviewRaw > tokenPoolBalanceRaw
        ) {
          next.tokenWithdrawUsd = "Withdraw amount exceeds pool token balance.";
        }
      }
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function withdrawModeLabel(): string {
    const sym =
      erc20Pick === "custom"
        ? (customToken.trim() ? `ERC20 ${customToken.trim()}` : "Custom ERC20")
        : (erc20Presets.find((p) => p.id === erc20Pick)?.symbol ?? "ERC20");
    if (withdrawMode === "eth_only") return "ETH only";
    if (withdrawMode === "erc20_only") return `${sym} only`;
    return `ETH + ${sym}`;
  }

  async function submitWithdraw() {
    setWithdrawError(null);
    setLastTxHashes([]);
    if (!isConnected || !signer || chainId === null) {
      await postClientSecurityEvent({
        event_type: "pool.withdraw.failed",
        severity: "medium",
        error_code: "wallet_not_connected",
        safe_message: "Withdraw blocked because wallet is not connected.",
      });
      setWithdrawError("Connect your wallet first.");
      return;
    }
    if (isWrongNetwork) {
      await postClientSecurityEvent({
        event_type: "pool.withdraw.failed",
        severity: "high",
        chain_id: Number(chainId),
        error_code: "wrong_chain_blocked",
        safe_message: "Withdraw blocked due to wrong chain.",
      });
      try {
        await switchToExpectedNetwork();
      } catch {
        setWithdrawError("Switch to the expected network, then try again.");
      }
      return;
    }
    const pool = getAddress(poolAddress.trim());
    const walletAddressSafe = await signer.getAddress().catch(() => "");
    setWithdrawPending(true);
    const hashes: string[] = [];
    try {
      await postClientSecurityEvent({
        event_type: "pool.withdraw.started",
        severity: "info",
        chain_id: Number(chainId),
        pool_address: pool,
        wallet_address: walletAddressSafe,
        action: "withdraw",
        status: "started",
        safe_message: "Pool withdraw flow started.",
      });
      if (poolChainExpired) {
        const tx = await releaseExpiredFundsToDeployer(signer, pool);
        hashes.push(tx.hash);
        await postClientSecurityEvent({
          event_type: "pool.withdraw.tx_submitted",
          severity: "info",
          chain_id: Number(chainId),
          pool_address: pool,
          tx_hash: tx.hash,
          wallet_address: walletAddressSafe,
          action: "withdraw",
          status: "submitted",
          safe_message: "Release-to-deployer transaction submitted.",
        });
        await tx.wait();
        await postClientSecurityEvent({
          event_type: "pool.withdraw.confirmed",
          severity: "info",
          chain_id: Number(chainId),
          pool_address: pool,
          tx_hash: tx.hash,
          wallet_address: walletAddressSafe,
          action: "withdraw",
          status: "confirmed",
          safe_message: "Release-to-deployer transaction confirmed.",
        });
        setLastTxHashes(hashes);
        onWithdrawn?.({
          poolName: poolName.trim(),
          poolAddress: pool,
          chainId: Number(chainId),
          withdrawTxHashes: hashes,
          totalUsdEstimate: 0,
        });
        onClose();
        resetForm();
        return;
      }
      const legacy = supportsPartial === false;
      const runEth = withdrawMode === "eth_only" || withdrawMode === "both";
      const runErc20 = withdrawMode === "erc20_only" || withdrawMode === "both";

      if (runEth) {
        if (legacy || ethMax) {
          // `cheaperWithdraw()` withdraws the full ETH balance; it is the
          // only ETH-withdraw function on legacy pools and is cheaper gas
          // than `withdraw(balance)` for Max on new pools.
          const tx = await withdrawPoolEth(signer, pool);
          hashes.push(tx.hash);
          await postClientSecurityEvent({
            event_type: "pool.withdraw.tx_submitted",
            severity: "info",
            chain_id: Number(chainId),
            pool_address: pool,
            tx_hash: tx.hash,
            wallet_address: walletAddressSafe,
            action: "withdraw",
            status: "submitted",
            safe_message: "ETH withdraw transaction submitted.",
          });
          await tx.wait();
          await postClientSecurityEvent({
            event_type: "pool.withdraw.confirmed",
            severity: "info",
            chain_id: Number(chainId),
            pool_address: pool,
            tx_hash: tx.hash,
            wallet_address: walletAddressSafe,
            action: "withdraw",
            status: "confirmed",
            safe_message: "ETH withdraw transaction confirmed.",
          });
        } else {
          // Convert USD → wei at submit time using the chain's current ETH/USD
          // price so the tx amount reflects spot at broadcast, not at typing.
          const cfg = getPoolChainConfig(chainId);
          const amountWei = await weiForUsdContribution(signer, cfg.ethUsdPriceFeed, ethWithdrawUsd.trim());
          if (amountWei <= 0n) throw new Error("Invalid ETH withdraw amount.");
          if (ethPoolBalanceWei !== null && amountWei > ethPoolBalanceWei) {
            throw new Error("Withdraw amount exceeds pool ETH balance.");
          }
          const ethTx = await withdrawPoolEthAmount(signer, pool, amountWei);
          hashes.push(ethTx.hash);
          await postClientSecurityEvent({
            event_type: "pool.withdraw.tx_submitted",
            severity: "info",
            chain_id: Number(chainId),
            pool_address: pool,
            tx_hash: ethTx.hash,
            wallet_address: walletAddressSafe,
            action: "withdraw",
            status: "submitted",
            safe_message: "Partial ETH withdraw transaction submitted.",
          });
          await ethTx.wait();
          await postClientSecurityEvent({
            event_type: "pool.withdraw.confirmed",
            severity: "info",
            chain_id: Number(chainId),
            pool_address: pool,
            tx_hash: ethTx.hash,
            wallet_address: walletAddressSafe,
            action: "withdraw",
            status: "confirmed",
            safe_message: "Partial ETH withdraw transaction confirmed.",
          });
        }
      }
      if (runErc20) {
        const token = resolveErc20Token();
        if (legacy || tokenMax) {
          // `withdrawToken(address)` is the only ERC20 withdraw on legacy
          // pools, and is cheaper for Max on new pools.
          const tx = await withdrawPoolToken(signer, pool, token);
          hashes.push(tx.hash);
          await postClientSecurityEvent({
            event_type: "pool.withdraw.tx_submitted",
            severity: "info",
            chain_id: Number(chainId),
            pool_address: pool,
            tx_hash: tx.hash,
            wallet_address: walletAddressSafe,
            action: "withdraw",
            status: "submitted",
            safe_message: "Token withdraw transaction submitted.",
          });
          await tx.wait();
          await postClientSecurityEvent({
            event_type: "pool.withdraw.confirmed",
            severity: "info",
            chain_id: Number(chainId),
            pool_address: pool,
            tx_hash: tx.hash,
            wallet_address: walletAddressSafe,
            action: "withdraw",
            status: "confirmed",
            safe_message: "Token withdraw transaction confirmed.",
          });
        } else {
          const preset = erc20Presets.find((p) => p.id === erc20Pick);
          if (!preset) throw new Error("Token preset not available on this network.");
          if (erc20Pick === "custom") {
            throw new Error("Use Max to withdraw a custom ERC20.");
          }
          const humanToken = await erc20UsdToHumanAmountString(signer, preset, tokenWithdrawUsd.trim());
          if (humanToken === null) throw new Error("Could not price token from USD (feed unavailable).");
          const amount = parseUnits(humanToken, preset.decimals);
          if (amount <= 0n) throw new Error("Invalid token withdraw amount.");
          if (tokenPoolBalanceRaw !== null && amount > tokenPoolBalanceRaw) {
            throw new Error("Withdraw amount exceeds pool token balance.");
          }
          const tTx = await withdrawPoolTokenAmount(signer, pool, token, amount);
          hashes.push(tTx.hash);
          await postClientSecurityEvent({
            event_type: "pool.withdraw.tx_submitted",
            severity: "info",
            chain_id: Number(chainId),
            pool_address: pool,
            tx_hash: tTx.hash,
            wallet_address: walletAddressSafe,
            action: "withdraw",
            status: "submitted",
            safe_message: "Partial token withdraw transaction submitted.",
          });
          await tTx.wait();
          await postClientSecurityEvent({
            event_type: "pool.withdraw.confirmed",
            severity: "info",
            chain_id: Number(chainId),
            pool_address: pool,
            tx_hash: tTx.hash,
            wallet_address: walletAddressSafe,
            action: "withdraw",
            status: "confirmed",
            safe_message: "Partial token withdraw transaction confirmed.",
          });
        }
      }
      setLastTxHashes(hashes);
      onWithdrawn?.({
        poolName: poolName.trim(),
        poolAddress: pool,
        chainId: Number(chainId),
        withdrawTxHashes: hashes,
        totalUsdEstimate: 0,
      });
      onClose();
      resetForm();
    } catch (e) {
      await postClientSecurityEvent({
        event_type: "pool.withdraw.failed",
        severity: "high",
        chain_id: chainId === null ? undefined : Number(chainId),
        pool_address: isAddress(poolAddress.trim()) ? getAddress(poolAddress.trim()) : undefined,
        tx_hash: hashes.at(-1),
        wallet_address: walletAddressSafe,
        error_code: e instanceof Error ? e.message : "withdraw_failed",
        safe_message: "Pool withdraw flow failed.",
      });
      setWithdrawError(e instanceof Error ? e.message : "Withdrawal failed.");
      setLastTxHashes(hashes);
    } finally {
      setWithdrawPending(false);
    }
  }

  function handleContinue() {
    if (step === 1) {
      if (!validateStep1()) return;
      setStep(2);
    } else if (step === 2) {
      if (verificationStatus !== "success") {
        void postClientSecurityEvent({
          event_type: "pool.withdraw.owner_check_failed",
          severity: "high",
          chain_id: chainId === null ? undefined : Number(chainId),
          pool_address: isAddress(poolAddress.trim()) ? getAddress(poolAddress.trim()) : undefined,
          wallet_address: walletAddress ?? undefined,
          error_code: "owner_check_failed",
          safe_message: "Withdrawal blocked due to failed owner verification.",
        });
        return;
      }
      setStep(3);
    } else if (step === 3) {
      if (!validateStep3()) return;
      setStep(4);
    } else {
      void submitWithdraw();
    }
  }

  function handleBack() {
    if (step === 1) return;
    if (step === 2) {
      setVerificationStatus("idle");
      setPoolChainExpired(false);
      setPoolDeployerAddress(null);
      setSupportsPartial(null);
    }
    setStep((current) => (current - 1) as Step);
  }

  function handleClose() {
    onClose();
    resetForm();
  }

  if (!open) return null;

  const isFirstStep = step === 1;
  const primaryLabel =
    step === 4
      ? withdrawPending
        ? "Confirm in wallet…"
        : poolChainExpired
          ? "Release to deployer"
          : "Withdraw"
      : "Continue";

  const stepTitles: Record<Step, string> = {
    1: "Which pool would you like to withdraw from?",
    2: "Verifying pool ownership",
    3: "What would you like to withdraw?",
    4: "Review your withdrawal",
  };

  const ethPreviewHuman =
    ethPreviewWei !== null ? formatUnits(ethPreviewWei, 18) : null;
  const tokenPreviewHuman =
    tokenPreviewRaw !== null && tokenDecimals !== null
      ? formatUnits(tokenPreviewRaw, tokenDecimals)
      : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="withdraw-modal-title"
    >
      <div
        className="absolute inset-0 bg-black/70"
        aria-hidden
        onClick={handleClose}
      />
      <div className="relative w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950/95 shadow-xl">
        <div className="p-6 pb-4">
          <h2
            id="withdraw-modal-title"
            className="text-lg font-semibold text-white mb-4"
          >
            {stepTitles[step]}
          </h2>

          {step === 1 && (
            <>
              <label
                htmlFor="withdraw-pool-name"
                className="block text-sm font-medium text-white mb-2"
              >
                Pool name (optional)
              </label>
              <input
                id="withdraw-pool-name"
                type="text"
                value={poolName}
                onChange={(e) => setPoolName(e.target.value)}
                placeholder="CommunityPool"
                className="mb-4 w-full rounded-lg border border-zinc-700 bg-zinc-900/50 px-4 py-3 text-white placeholder:text-zinc-500 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
              />

              <label
                htmlFor="withdraw-pool-address"
                className="block text-sm font-medium text-white mb-2"
              >
                Pool contract address
              </label>
              <input
                id="withdraw-pool-address"
                type="text"
                value={poolAddress}
                onChange={(e) => setPoolAddress(e.target.value)}
                placeholder="0x…"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900/50 px-4 py-3 text-white placeholder:text-zinc-500 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
              />
              {errors.pool && (
                <p className="mt-2 text-sm text-amber-400">{errors.pool}</p>
              )}
            </>
          )}

          {step === 2 && (
            <div className="flex flex-col items-center justify-center py-6">
              <div className="mb-4 h-10 w-10">
                <span className="block h-10 w-10 animate-spin rounded-full border-2 border-brand-400 border-t-transparent" />
              </div>
              <p className="text-sm text-zinc-300 mb-1">
                Checking on-chain owner access for your connected wallet.
              </p>
              <p className="text-sm text-zinc-500 text-center px-2">
                {verificationStatus === "pending" &&
                  "Reading pool state and on-chain owner set…"}
                {verificationStatus === "success" &&
                  poolChainExpired &&
                  "This pool is past its expiration. You can submit a release transaction; all remaining assets go to the deployer (any wallet may pay gas)."}
                {verificationStatus === "success" &&
                  !poolChainExpired &&
                  "You are a pool owner. Continue."}
                {verificationStatus === "error" &&
                  (verificationFailureReason === "not_owner"
                    ? "This wallet is not an owner of this pool."
                    : verificationFailureReason === "provider_unavailable"
                      ? "Could not verify ownership right now. Please refresh or try again."
                      : verificationFailureReason === "wrong_chain"
                        ? "Switch to the expected network before verifying ownership."
                        : verificationFailureReason === "wallet_unavailable"
                          ? "Connect your wallet to verify ownership."
                          : "Enter a valid pool address to verify ownership.")}
              </p>
            </div>
          )}

          {step === 3 && poolChainExpired && (
            <>
              <p className="text-sm text-zinc-300 mb-3">
                After expiration, owner withdrawals are disabled. Submit one on-chain call to send all remaining
                ETH and every whitelisted ERC20 in this contract to the deployer address below. The transaction
                sender does not receive the funds—the deployer always does.
              </p>
              {poolDeployerAddress && (
                <p className="text-sm text-zinc-400 mb-4">
                  Deployer:{" "}
                  <span className="font-mono text-zinc-200 break-all">{poolDeployerAddress}</span>
                </p>
              )}
            </>
          )}

          {step === 3 && !poolChainExpired && (
            <>
              {supportsPartial === false && (
                <p className="text-sm text-amber-300 mb-4" role="status">
                  This pool only supports full withdrawals. Amount input is disabled; the entire balance of each
                  selected asset will be sent to your wallet.
                </p>
              )}

              <p className="text-sm text-zinc-400 mb-3">Withdrawal</p>
              <div className="flex flex-wrap gap-2 mb-4">
                <button
                  type="button"
                  onClick={() => setWithdrawMode("eth_only")}
                  className={`rounded-lg px-4 py-2 text-sm font-medium ${withdrawMode === "eth_only" ? "bg-brand-600 text-white" : "bg-zinc-800 text-zinc-300"}`}
                >
                  ETH only
                </button>
                {erc20Presets.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setWithdrawMode("erc20_only");
                      if (erc20Pick === "custom" && erc20Presets[0]) setErc20Pick(erc20Presets[0].id);
                    }}
                    className={`rounded-lg px-4 py-2 text-sm font-medium ${withdrawMode === "erc20_only" ? "bg-brand-600 text-white" : "bg-zinc-800 text-zinc-300"}`}
                  >
                    ERC20 only
                  </button>
                )}
                {erc20Presets.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setWithdrawMode("both");
                      if (erc20Pick === "custom" && erc20Presets[0]) setErc20Pick(erc20Presets[0].id);
                    }}
                    className={`rounded-lg px-4 py-2 text-sm font-medium ${withdrawMode === "both" ? "bg-brand-600 text-white" : "bg-zinc-800 text-zinc-300"}`}
                  >
                    ETH + ERC20
                  </button>
                )}
              </div>
              {errors.withdrawMode && (
                <p className="text-sm text-amber-400 mb-2">{errors.withdrawMode}</p>
              )}

              {(withdrawMode === "erc20_only" || withdrawMode === "both") && erc20Presets.length > 0 && (
                <>
                  <p className="text-sm text-zinc-400 mb-2">ERC20 token</p>
                  <div className="flex flex-wrap gap-2 mb-4">
                    {erc20Presets.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setErc20Pick(p.id)}
                        className={`rounded-lg px-4 py-2 text-sm font-medium ${erc20Pick === p.id ? "bg-brand-600 text-white" : "bg-zinc-800 text-zinc-300"}`}
                      >
                        {p.symbol}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setErc20Pick("custom")}
                      className={`rounded-lg px-4 py-2 text-sm font-medium ${erc20Pick === "custom" ? "bg-brand-600 text-white" : "bg-zinc-800 text-zinc-300"}`}
                    >
                      Custom
                    </button>
                  </div>
                </>
              )}

              {(withdrawMode === "erc20_only" || withdrawMode === "both") && erc20Pick === "custom" && (
                <>
                  <label
                    className="block text-sm font-medium text-white mb-2"
                    htmlFor="withdraw-custom-token"
                  >
                    ERC20 token address
                  </label>
                  <input
                    id="withdraw-custom-token"
                    type="text"
                    value={customToken}
                    onChange={(e) => setCustomToken(e.target.value)}
                    placeholder="0x… (whitelisted on the pool)"
                    className="mb-2 w-full rounded-lg border border-zinc-700 bg-zinc-900/50 px-4 py-3 text-white placeholder:text-zinc-500 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
                  />
                  {errors.customToken && (
                    <p className="text-sm text-amber-400 mb-2">{errors.customToken}</p>
                  )}
                </>
              )}

              {(withdrawMode === "eth_only" || withdrawMode === "both") && supportsPartial !== false && (
                <>
                  <div className="flex items-baseline justify-between mb-2">
                    <label
                      htmlFor="withdraw-amount-eth"
                      className="block text-sm font-medium text-white"
                    >
                      ETH amount to withdraw (USD)
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setEthMax(true);
                        setEthWithdrawUsd("");
                        setEthPreviewWei(ethPoolBalanceWei);
                      }}
                      className="text-xs font-medium text-brand-300 hover:text-brand-200 focus:outline-none focus:underline"
                    >
                      Max
                    </button>
                  </div>
                  <input
                    id="withdraw-amount-eth"
                    type="text"
                    inputMode="decimal"
                    value={ethMax ? "Max (full pool balance)" : ethWithdrawUsd}
                    readOnly={ethMax}
                    onChange={(e) => {
                      setEthMax(false);
                      setEthWithdrawUsd(e.target.value);
                    }}
                    placeholder="0.00"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900/50 px-4 py-3 text-white placeholder:text-zinc-500 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
                    aria-invalid={!!errors.ethWithdrawUsd}
                  />
                  {errors.ethWithdrawUsd && (
                    <p className="mt-2 text-sm text-amber-400">{errors.ethWithdrawUsd}</p>
                  )}
                  <p className="mt-1 text-xs text-zinc-500">
                    {ethMax
                      ? ethPoolBalanceWei === null
                        ? "Max: loading…"
                        : `≈ ${formatUnits(ethPoolBalanceWei, 18)} ETH (full pool balance)`
                      : ethPreviewHuman !== null
                        ? `≈ ${ethPreviewHuman} ETH at current price`
                        : "Enter a USD amount to see the ETH equivalent."}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    Pool ETH balance:{" "}
                    {ethPoolBalanceWei === null ? "loading…" : `${formatUnits(ethPoolBalanceWei, 18)} ETH`}
                  </p>
                </>
              )}

              {(withdrawMode === "eth_only" || withdrawMode === "both") && supportsPartial === false && (
                <p className="mt-1 mb-4 text-xs text-zinc-500">
                  Pool ETH balance:{" "}
                  {ethPoolBalanceWei === null ? "loading…" : `${formatUnits(ethPoolBalanceWei, 18)} ETH (will be withdrawn in full)`}
                </p>
              )}

              {(withdrawMode === "erc20_only" || withdrawMode === "both") && supportsPartial !== false && (
                <>
                  <div className="mt-4 flex items-baseline justify-between mb-2">
                    <label
                      htmlFor="withdraw-amount-token"
                      className="block text-sm font-medium text-white"
                    >
                      {tokenSymbol || "ERC20"} amount to withdraw (USD)
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setTokenMax(true);
                        setTokenWithdrawUsd("");
                        setTokenPreviewRaw(tokenPoolBalanceRaw);
                      }}
                      className="text-xs font-medium text-brand-300 hover:text-brand-200 focus:outline-none focus:underline"
                    >
                      Max
                    </button>
                  </div>
                  <input
                    id="withdraw-amount-token"
                    type="text"
                    inputMode="decimal"
                    value={tokenMax ? "Max (full pool balance)" : tokenWithdrawUsd}
                    readOnly={tokenMax || erc20Pick === "custom"}
                    onChange={(e) => {
                      setTokenMax(false);
                      setTokenWithdrawUsd(e.target.value);
                    }}
                    placeholder={erc20Pick === "custom" ? "Use Max for custom ERC20" : "0.00"}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900/50 px-4 py-3 text-white placeholder:text-zinc-500 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
                    aria-invalid={!!errors.tokenWithdrawUsd}
                  />
                  {errors.tokenWithdrawUsd && (
                    <p className="mt-2 text-sm text-amber-400">{errors.tokenWithdrawUsd}</p>
                  )}
                  <p className="mt-1 text-xs text-zinc-500">
                    {tokenMax
                      ? tokenPoolBalanceRaw === null || tokenDecimals === null
                        ? "Max: loading…"
                        : `≈ ${formatUnits(tokenPoolBalanceRaw, tokenDecimals)} ${tokenSymbol || "ERC20"} (full pool balance)`
                      : erc20Pick === "custom"
                        ? "Custom ERC20 has no USD feed; use Max to withdraw the full balance."
                        : tokenPreviewHuman !== null
                          ? `≈ ${tokenPreviewHuman} ${tokenSymbol || "ERC20"} at current price`
                          : "Enter a USD amount to see the token equivalent."}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    Pool {tokenSymbol || "ERC20"} balance:{" "}
                    {tokenPoolBalanceRaw === null || tokenDecimals === null
                      ? "loading…"
                      : `${formatUnits(tokenPoolBalanceRaw, tokenDecimals)} ${tokenSymbol || "ERC20"}`}
                  </p>
                </>
              )}

              {(withdrawMode === "erc20_only" || withdrawMode === "both") && supportsPartial === false && (
                <p className="mt-4 text-xs text-zinc-500">
                  Pool {tokenSymbol || "ERC20"} balance:{" "}
                  {tokenPoolBalanceRaw === null || tokenDecimals === null
                    ? "loading…"
                    : `${formatUnits(tokenPoolBalanceRaw, tokenDecimals)} ${tokenSymbol || "ERC20"} (will be withdrawn in full)`}
                </p>
              )}
            </>
          )}

          {step === 4 && (
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-zinc-500">Pool name</dt>
                <dd className="text-white font-medium">{poolName || "—"}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Pool address</dt>
                <dd className="text-white font-mono text-xs break-all">{poolAddress || "—"}</dd>
              </div>
              {poolChainExpired ? (
                <>
                  <div>
                    <dt className="text-zinc-500">Action</dt>
                    <dd className="text-white">Release all remaining assets to deployer (post-expiry)</dd>
                  </div>
                  {poolDeployerAddress && (
                    <div>
                      <dt className="text-zinc-500">Deployer receives funds</dt>
                      <dd className="text-white font-mono text-xs break-all">{poolDeployerAddress}</dd>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div>
                    <dt className="text-zinc-500">Withdrawal</dt>
                    <dd className="text-white">{withdrawModeLabel()}</dd>
                  </div>
                  {(withdrawMode === "eth_only" || withdrawMode === "both") && (
                    <div>
                      <dt className="text-zinc-500">ETH amount</dt>
                      <dd className="text-white">
                        {supportsPartial === false || ethMax
                          ? ethPoolBalanceWei !== null
                            ? `Full pool balance (≈ ${formatUnits(ethPoolBalanceWei, 18)} ETH)`
                            : "Full pool balance"
                          : `$${ethWithdrawUsd || "0"} USD${ethPreviewHuman ? ` (≈ ${ethPreviewHuman} ETH)` : ""}`}
                      </dd>
                    </div>
                  )}
                  {(withdrawMode === "erc20_only" || withdrawMode === "both") && (
                    <div>
                      <dt className="text-zinc-500">{tokenSymbol || "ERC20"} amount</dt>
                      <dd className="text-white">
                        {supportsPartial === false || tokenMax
                          ? tokenPoolBalanceRaw !== null && tokenDecimals !== null
                            ? `Full pool balance (≈ ${formatUnits(tokenPoolBalanceRaw, tokenDecimals)} ${tokenSymbol || "ERC20"})`
                            : "Full pool balance"
                          : `$${tokenWithdrawUsd || "0"} USD${tokenPreviewHuman ? ` (≈ ${tokenPreviewHuman} ${tokenSymbol || "ERC20"})` : ""}`}
                      </dd>
                    </div>
                  )}
                </>
              )}
              {lastTxHashes.length > 0 && (
                <div>
                  <dt className="text-zinc-500">Transactions</dt>
                  <dd className="text-white font-mono text-xs break-all">
                    {lastTxHashes.join(", ")}
                  </dd>
                </div>
              )}
              {withdrawError && (
                <p className="text-sm text-amber-400" role="alert">
                  {withdrawError}
                </p>
              )}
            </dl>
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-800">
          <button
            type="button"
            onClick={handleBack}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-zinc-400 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-zinc-950 ${
              isFirstStep ? "invisible" : ""
            }`}
            aria-label="Go back"
          >
            <BackIcon />
            Back
          </button>
          <button
            type="button"
            onClick={handleContinue}
            disabled={
              (step === 2 && verificationStatus !== "success") || withdrawPending
            }
            className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-zinc-950"
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
