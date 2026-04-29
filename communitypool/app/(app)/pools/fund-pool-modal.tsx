"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { isAddress, getAddress } from "ethers";
import { useWallet } from "@/components/wallet-provider";
import {
  fundPoolEth,
  fundPoolErc20Human,
  getPoolWhitelistedTokenAddresses,
} from "@/lib/onchain/community-pool";
import { getErc20Presets, getPoolChainConfig, type Erc20PresetId } from "@/lib/onchain/pool-chain-config";
import {
  erc20UsdToHumanAmountString,
  fundErc20FeeInefficiencyMessage,
  fundEthFeeInefficiencyMessage,
  parsePositiveDecimal,
  validateFundEthUsdHuman,
} from "@/lib/onchain/tx-economics";
import { postClientSecurityEvent } from "@/lib/security/client-security-event";

type Step = 1 | 2 | 3;

type FundKind = "eth" | "erc20";

export type FundedPoolSummary = {
  poolName: string;
  poolAddress: string;
  chainId: number;
  totalUsd: number;
  fundTxHash: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onFunded?: (summary: FundedPoolSummary) => void;
  /**
   * Prefill the pool context and jump directly to step 2 ("How much would you
   * like to fund?"). Used by the Open Pools row-level Fund action.
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

export default function FundPoolModal({ open, onClose, onFunded, initialPool }: Props) {
  const {
    provider,
    signer,
    isConnected,
    chainId,
    isWrongNetwork,
    switchToExpectedNetwork,
  } = useWallet();

  const [step, setStep] = useState<Step>(1);
  const [poolName, setPoolName] = useState("");
  const [poolAddress, setPoolAddress] = useState("");
  const [fundAmount, setFundAmount] = useState("");
  const [fundKind, setFundKind] = useState<FundKind>("eth");
  const [erc20Pick, setErc20Pick] = useState<Erc20PresetId>("wbtc");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [fundPending, setFundPending] = useState(false);
  const [fundError, setFundError] = useState<string | null>(null);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  const [whitelistLower, setWhitelistLower] = useState<Set<string> | null>(null);
  const [whitelistLoading, setWhitelistLoading] = useState(false);
  const [feeWarning, setFeeWarning] = useState<string | null>(null);

  const erc20Presets = useMemo(
    () => (chainId !== null ? getErc20Presets(chainId) : []),
    [chainId],
  );

  useEffect(() => {
    if (erc20Presets.length === 0 && fundKind === "erc20") {
      setFundKind("eth");
    }
    const ids = new Set(erc20Presets.map((p) => p.id));
    if (!ids.has(erc20Pick)) {
      const first = erc20Presets[0];
      if (first) setErc20Pick(first.id);
    }
  }, [erc20Presets, fundKind, erc20Pick]);

  useEffect(() => {
    if (!open || step !== 2 || !provider || chainId === null) {
      setWhitelistLower(null);
      return;
    }
    const addr = poolAddress.trim();
    if (!isAddress(addr)) {
      setWhitelistLower(null);
      return;
    }

    setWhitelistLoading(true);
    setWhitelistLower(null);
    (async () => {
      try {
        const list = await getPoolWhitelistedTokenAddresses(provider, addr);
        setWhitelistLower(new Set(list.map((a) => a.toLowerCase())));
      } catch {
        setWhitelistLower(null);
      } finally {
        setWhitelistLoading(false);
      }
    })();
  }, [open, step, provider, chainId, poolAddress]);

  useEffect(() => {
    if (!open || step !== 2 || !signer || chainId === null) {
      setFeeWarning(null);
      return;
    }
    const addr = poolAddress.trim();
    if (!isAddress(addr) || !fundAmount.trim()) {
      setFeeWarning(null);
      return;
    }
    let cancelled = false;
    const cfg = getPoolChainConfig(chainId);
    (async () => {
      try {
        if (fundKind === "eth") {
          const msg = await fundEthFeeInefficiencyMessage(
            signer,
            addr,
            cfg.ethUsdPriceFeed,
            fundAmount,
          );
          if (!cancelled) setFeeWarning(msg);
          return;
        }
        const preset = erc20Presets.find((p) => p.id === erc20Pick);
        if (!preset) {
          if (!cancelled) setFeeWarning(null);
          return;
        }
        const depositUsd = parsePositiveDecimal(fundAmount);
        const msg = await fundErc20FeeInefficiencyMessage(signer, cfg.ethUsdPriceFeed, depositUsd);
        if (!cancelled) setFeeWarning(msg);
      } catch {
        if (!cancelled) setFeeWarning(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, step, signer, chainId, poolAddress, fundKind, erc20Pick, fundAmount, erc20Presets]);

  const presetNotWhitelisted = useMemo(() => {
    if (!whitelistLower || fundKind !== "erc20") return false;
    const p = erc20Presets.find((x) => x.id === erc20Pick);
    if (!p) return false;
    return !whitelistLower.has(p.token.toLowerCase());
  }, [whitelistLower, fundKind, erc20Pick, erc20Presets]);

  const resetForm = useCallback(() => {
    setStep(1);
    setPoolName("");
    setPoolAddress("");
    setFundAmount("");
    setFundKind("eth");
    setErc20Pick("wbtc");
    setErrors({});
    setFundPending(false);
    setFundError(null);
    setLastTxHash(null);
    setWhitelistLower(null);
    setWhitelistLoading(false);
    setFeeWarning(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    resetForm();
    if (initialPool && initialPool.address) {
      setPoolName(initialPool.name ?? "");
      setPoolAddress(initialPool.address);
      setStep(2);
    }
    // initialPool is read at open-time only; we don't rebind while open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, resetForm]);

  function validateStep1(): boolean {
    const next: Record<string, string> = {};
    const addr = poolAddress.trim();
    if (!addr) next.pool = "Enter the pool contract address.";
    else if (!isAddress(addr)) next.pool = "Enter a valid Ethereum address (0x…).";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function resolveToken(): string {
    const p = erc20Presets.find((x) => x.id === erc20Pick);
    if (!p) throw new Error("Token preset not available on this network.");
    return getAddress(p.token);
  }

  function validateStep2(): boolean {
    const next: Record<string, string> = {};
    if (fundKind === "erc20") {
      if (erc20Presets.length === 0) {
        next.fundKind = "No default ERC20s on this network; fund with ETH.";
      }
    }
    const fe = validateFundEthUsdHuman(fundAmount);
    if (fe) next.fundAmount = fe;
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function advanceFromStep2(): Promise<void> {
    if (!validateStep2()) return;
    if (signer && fundKind === "erc20") {
      const p = erc20Presets.find((x) => x.id === erc20Pick);
      if (p) {
        const humanToken = await erc20UsdToHumanAmountString(signer, p, fundAmount.trim());
        if (humanToken === null) {
          setErrors((e) => ({
            ...e,
            fundAmount:
              "This USD amount is too small to express as this token at current prices, or the price feed could not be read.",
          }));
          return;
        }
      }
    }
    setStep(3);
  }

  function assetSummary(): string {
    if (fundKind === "eth") return "ETH";
    return erc20Presets.find((p) => p.id === erc20Pick)?.symbol ?? "ERC20";
  }

  async function submitFund() {
    setFundError(null);
    if (!isConnected || !signer || chainId === null) {
      await postClientSecurityEvent({
        event_type: "pool.fund.failed",
        severity: "medium",
        error_code: "wallet_not_connected",
        safe_message: "Fund blocked because wallet is not connected.",
      });
      setFundError("Connect your wallet first.");
      return;
    }
    if (isWrongNetwork) {
      await postClientSecurityEvent({
        event_type: "pool.fund.failed",
        severity: "high",
        chain_id: Number(chainId),
        error_code: "wrong_chain_blocked",
        safe_message: "Fund blocked due to wrong chain.",
      });
      try {
        await switchToExpectedNetwork();
      } catch {
        setFundError("Switch to the expected network, then try again.");
      }
      return;
    }
    const pool = getAddress(poolAddress.trim());
    const walletAddress = await signer.getAddress().catch(() => "");
    setFundPending(true);
    try {
      await postClientSecurityEvent({
        event_type: "pool.fund.started",
        severity: "info",
        chain_id: Number(chainId),
        pool_address: pool,
        wallet_address: walletAddress,
        action: "fund",
        status: "started",
        safe_message: "Pool fund flow started.",
      });
      const cfg = getPoolChainConfig(chainId);
      let tx;
      if (fundKind === "eth") {
        tx = await fundPoolEth(signer, pool, cfg.ethUsdPriceFeed, fundAmount.trim());
      } else {
        const token = resolveToken();
        const preset = erc20Presets.find((x) => x.id === erc20Pick);
        if (!preset) throw new Error("Token preset not available on this network.");
        const humanToken = await erc20UsdToHumanAmountString(signer, preset, fundAmount.trim());
        if (humanToken === null) {
          setFundError(
            "Could not convert USD to a token amount (amount may be too small or the price feed unavailable).",
          );
          return;
        }
        tx = await fundPoolErc20Human(signer, pool, token, humanToken);
      }
      setLastTxHash(tx.hash);
      await postClientSecurityEvent({
        event_type: "pool.fund.tx_submitted",
        severity: "info",
        chain_id: Number(chainId),
        pool_address: pool,
        tx_hash: tx.hash,
        wallet_address: walletAddress,
        action: "fund",
        status: "submitted",
        safe_message: "Pool fund transaction submitted.",
      });
      await tx.wait();
      await postClientSecurityEvent({
        event_type: "pool.fund.confirmed",
        severity: "info",
        chain_id: Number(chainId),
        pool_address: pool,
        tx_hash: tx.hash,
        wallet_address: walletAddress,
        action: "fund",
        status: "confirmed",
        safe_message: "Pool fund transaction confirmed.",
      });
      const n = parseFloat(fundAmount.trim());
      const totalUsd = Number.isFinite(n) ? n : 0;
      onFunded?.({
        poolName: poolName.trim(),
        poolAddress: pool,
        chainId: Number(chainId),
        totalUsd,
        fundTxHash: tx.hash,
      });
      onClose();
      resetForm();
    } catch (e) {
      await postClientSecurityEvent({
        event_type: "pool.fund.failed",
        severity: "high",
        chain_id: chainId === null ? undefined : Number(chainId),
        pool_address: isAddress(poolAddress.trim()) ? getAddress(poolAddress.trim()) : undefined,
        tx_hash: lastTxHash ?? undefined,
        wallet_address: walletAddress,
        error_code: e instanceof Error ? e.message : "fund_failed",
        safe_message: "Pool fund flow failed.",
      });
      setFundError(e instanceof Error ? e.message : "Funding transaction failed.");
    } finally {
      setFundPending(false);
    }
  }

  function handleContinue() {
    if (step === 1) {
      if (!validateStep1()) return;
      setStep(2);
    } else if (step === 2) {
      void advanceFromStep2();
    } else {
      void submitFund();
    }
  }

  function handleBack() {
    if (step > 1) setStep((s) => (s - 1) as Step);
  }

  if (!open) return null;

  const isFirstStep = step === 1;
  const primaryLabel = step === 3 ? (fundPending ? "Confirm in wallet…" : "Fund") : "Continue";

  const stepTitles: Record<Step, string> = {
    1: "Which pool would you like to fund?",
    2: "How much would you like to fund?",
    3: "Review your funding",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fund-modal-title"
    >
      <div
        className="absolute inset-0 bg-black/70"
        aria-hidden
        onClick={onClose}
      />
      <div className="relative w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950/95 shadow-xl">
        <div className="p-6 pb-4">
          <h2 id="fund-modal-title" className="text-lg font-semibold text-white mb-4">
            {stepTitles[step]}
          </h2>
          {step === 1 && (
            <>
              <label className="block text-sm font-medium text-white mb-2" htmlFor="pool-name">
                Pool name (optional)
              </label>
              <input
                id="pool-name"
                type="text"
                value={poolName}
                onChange={(e) => setPoolName(e.target.value)}
                placeholder="CommunityPool"
                className="mb-4 w-full rounded-lg border border-zinc-700 bg-zinc-900/50 px-4 py-3 text-white placeholder:text-zinc-500 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
              />
              <label className="block text-sm font-medium text-white mb-2" htmlFor="pool-address">
                Pool contract address
              </label>
              <input
                id="pool-address"
                type="text"
                value={poolAddress}
                onChange={(e) => setPoolAddress(e.target.value)}
                placeholder="0x…"
                className="mb-4 w-full rounded-lg border border-zinc-700 bg-zinc-900/50 px-4 py-3 text-white placeholder:text-zinc-500 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
              />
              {errors.pool && <p className="mt-2 text-sm text-amber-400">{errors.pool}</p>}
            </>
          )}
          {step === 2 && (
            <>
              <p className="text-sm text-zinc-400 mb-3">Asset</p>
              <div className="flex flex-wrap gap-2 mb-4">
                <button
                  type="button"
                  onClick={() => setFundKind("eth")}
                  className={`rounded-lg px-4 py-2 text-sm font-medium ${fundKind === "eth" ? "bg-brand-600 text-white" : "bg-zinc-800 text-zinc-300"}`}
                >
                  ETH
                </button>
                {erc20Presets.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setFundKind("erc20");
                      setErc20Pick(p.id);
                    }}
                    className={`rounded-lg px-4 py-2 text-sm font-medium ${fundKind === "erc20" && erc20Pick === p.id ? "bg-brand-600 text-white" : "bg-zinc-800 text-zinc-300"}`}
                  >
                    {p.symbol}
                  </button>
                ))}
              </div>
              {errors.fundKind && <p className="text-sm text-amber-400 mb-2">{errors.fundKind}</p>}

              {whitelistLoading && (
                <p className="text-xs text-zinc-500 mb-2">Checking pool whitelist…</p>
              )}
              {presetNotWhitelisted && (
                <p className="text-sm text-amber-400 mb-2">
                  This pool’s whitelist does not include {erc20Presets.find((p) => p.id === erc20Pick)?.symbol}.
                  Funding will revert unless the pool was deployed with that token.
                </p>
              )}

              <label className="block text-sm font-medium text-white mb-2" htmlFor="fund-amount">
                Amount (human dollars, USD)
              </label>
              <input
                id="fund-amount"
                type="text"
                inputMode="decimal"
                value={fundAmount}
                onChange={(e) => setFundAmount(e.target.value)}
                placeholder="0.01"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900/50 px-4 py-3 text-white placeholder:text-zinc-500 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
                aria-invalid={!!errors.fundAmount}
              />
              {errors.fundAmount && (
                <p className="mt-2 text-sm text-amber-400">{errors.fundAmount}</p>
              )}
              {feeWarning && (
                <p className="mt-3 text-sm text-amber-400" role="status">
                  {feeWarning}
                </p>
              )}
            </>
          )}
          {step === 3 && (
            <>
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-zinc-500">Pool name</dt>
                  <dd className="text-white font-medium">{poolName || "—"}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Pool address</dt>
                  <dd className="text-white font-mono text-xs break-all">{poolAddress || "—"}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Asset</dt>
                  <dd className="text-white">{assetSummary()}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Amount (human dollars, USD)</dt>
                  <dd className="text-white">{fundAmount || "—"}</dd>
                </div>
                {lastTxHash && (
                  <div>
                    <dt className="text-zinc-500">Last tx</dt>
                    <dd className="text-white font-mono text-xs break-all">{lastTxHash}</dd>
                  </div>
                )}
              </dl>
              {fundError && (
                <p className="mt-4 text-sm text-amber-400" role="alert">
                  {fundError}
                </p>
              )}
            </>
          )}
        </div>
        <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-800">
          <button
            type="button"
            onClick={handleBack}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-zinc-400 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-zinc-950 ${isFirstStep ? "invisible" : ""}`}
            aria-label="Go back"
          >
            <BackIcon />
            Back
          </button>
          <button
            type="button"
            onClick={handleContinue}
            disabled={fundPending}
            className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-zinc-950 disabled:opacity-50"
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
