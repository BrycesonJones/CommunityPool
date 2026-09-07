"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { isAddress, getAddress, parseUnits } from "ethers";
import { useWallet } from "@/components/wallet-provider";
import {
  fundPoolErc20Exact,
  fundPoolEthExact,
  fundPoolEthUsd,
  getPoolWhitelistedTokenAddresses,
} from "@/lib/onchain/community-pool";
import {
  AllowanceBelowAmountError,
  classifyFundingError,
} from "@/lib/onchain/funding-errors";
import {
  getErc20PresetsForPoolChain,
  getPoolChainConfig,
  type Erc20PresetId,
} from "@/lib/onchain/pool-chain-config";
import {
  erc20UsdToHumanAmountString,
  fundErc20FeeInefficiencyMessage,
  fundEthFeeInefficiencyMessage,
  parsePositiveDecimal,
  validateFundEthUsdHuman,
} from "@/lib/onchain/tx-economics";
import {
  buildFundingPreview,
  formatFeeBpsPercent,
  formatTokenAmount,
  readLiveProtocolFee,
  type FundingPreview,
} from "@/lib/onchain/protocol-fee";
import { weiForUsdContribution } from "@/lib/onchain/price-math";
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
   * like to fund?"). Used by the Open Pools row-level Fund action. When
   * `chainId` is provided, the modal uses it to resolve the ERC20 preset
   * buttons so PAXG / WBTC / XAU₮ render correctly even if the wallet
   * isn't connected yet (the pool's deploy chain is the source of truth).
   */
  initialPool?: { name?: string; address: string; chainId?: number };
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
  const [feePreview, setFeePreview] = useState<FundingPreview | null>(null);
  const [feePreviewLoading, setFeePreviewLoading] = useState(false);
  /** Set when the live rate moved between preview and submit; cleared once the user re-reviews. */
  const [feeRateChanged, setFeeRateChanged] = useState(false);

  const erc20Presets = useMemo(
    () => getErc20PresetsForPoolChain(initialPool?.chainId, chainId),
    [initialPool?.chainId, chainId],
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
    setFeePreview(null);
    setFeePreviewLoading(false);
    setFeeRateChanged(false);
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

  /**
   * Protocol-fee preview for the review step. Uses the same gross amount the funding transaction
   * will send, so what the user sees is what settles. Prices can move between this read and the
   * signature, which shifts the gross slightly; the fee *rate* shown stays exact either way.
   */
  const loadFeePreview = useCallback(async (clearRateChange = true): Promise<void> => {
    setFeePreview(null);
    if (clearRateChange) setFeeRateChanged(false);
    if (!signer || chainId === null) return;
    const addr = poolAddress.trim();
    if (!isAddress(addr)) return;
    setFeePreviewLoading(true);
    try {
      let grossAmount: bigint;
      let symbol: string;
      let decimals: number;
      let tokenAddress: string | undefined;
      if (fundKind === "eth") {
        const cfg = getPoolChainConfig(chainId);
        grossAmount = await weiForUsdContribution(signer, cfg.ethUsdPriceFeed, fundAmount.trim());
        symbol = "ETH";
        decimals = 18;
      } else {
        const preset = erc20Presets.find((x) => x.id === erc20Pick);
        if (!preset) return;
        const human = await erc20UsdToHumanAmountString(signer, preset, fundAmount.trim());
        if (human === null) return;
        grossAmount = parseUnits(human, preset.decimals);
        symbol = preset.symbol;
        decimals = preset.decimals;
        tokenAddress = getAddress(preset.token);
      }
      setFeePreview(
        await buildFundingPreview({
          provider: signer.provider!,
          poolAddress: getAddress(addr),
          grossAmount,
          symbol,
          decimals,
          tokenAddress,
        }),
      );
    } catch {
      setFeePreview({
        kind: "unavailable",
        message: "Could not read this pool's current protocol fee from the network.",
      });
    } finally {
      setFeePreviewLoading(false);
    }
  }, [signer, chainId, poolAddress, fundKind, fundAmount, erc20Presets, erc20Pick]);

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
    void loadFeePreview();
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
    // Fail closed: never open a wallet prompt while the economics of this contribution are
    // unknown. A V1 pool has no fee to resolve; a V2 pool must have produced a successful split.
    if (!feePreview || feePreviewLoading || feePreview.kind === "unavailable") {
      setFundError(
        "The protocol fee for this pool has not been read yet. Review the funding details before continuing.",
      );
      return;
    }
    const pool = getAddress(poolAddress.trim());

    // Defence in depth: the rate is protocol state that an admin can change at any time, so
    // re-read it immediately before signing. If it moved since the preview, refresh and make the
    // user look at the new numbers rather than signing for economics they never saw.
    if (feePreview.kind === "split") {
      let liveBps: bigint;
      try {
        liveBps = (await readLiveProtocolFee(signer.provider!, pool)).feeBps;
      } catch {
        setFeePreview({
          kind: "unavailable",
          message: "Could not re-check this pool's protocol fee before signing.",
        });
        setFundError("Could not confirm the current protocol fee. Retry before funding.");
        return;
      }
      setFeeRateChanged(false);
      if (liveBps !== feePreview.split.feeBps) {
        setFeeRateChanged(true);
        setFundError(
          `The protocol fee changed from ${formatFeeBpsPercent(feePreview.split.feeBps)} to ` +
            `${formatFeeBpsPercent(liveBps)} while you were reviewing. Check the updated amounts, then fund again.`,
        );
        await loadFeePreview(false);
        return;
      }
    }

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
      // The amount the user reviewed is the amount that gets sent. Re-deriving it from the USD
      // input here is what broke the first production ERC-20 contribution: a price update between
      // review and submit produced a larger token amount than the spending cap just approved.
      let tx;
      if (feePreview.kind === "split") {
        const gross = feePreview.split.grossAmount;
        tx =
          fundKind === "eth"
            ? await fundPoolEthExact(signer, pool, gross)
            : await fundPoolErc20Exact(signer, pool, feePreview.tokenAddress ?? resolveToken(), gross);
      } else {
        // V1 pool: no fee preview to bind to, so convert at submit as before.
        const cfg = getPoolChainConfig(chainId);
        if (fundKind === "eth") {
          tx = await fundPoolEthUsd(signer, pool, cfg.ethUsdPriceFeed, fundAmount.trim());
        } else {
          const preset = erc20Presets.find((x) => x.id === erc20Pick);
          if (!preset) throw new Error("Token preset not available on this network.");
          const humanToken = await erc20UsdToHumanAmountString(signer, preset, fundAmount.trim());
          if (humanToken === null) {
            setFundError(
              "Could not convert USD to a token amount (amount may be too small or the price feed unavailable).",
            );
            return;
          }
          tx = await fundPoolErc20Exact(
            signer,
            pool,
            resolveToken(),
            parseUnits(humanToken, preset.decimals),
          );
        }
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
      // Never surface the raw provider exception: it carries calldata, nested provider objects
      // and stack traces. The redacted original still reaches the security-event pipeline above.
      if (e instanceof AllowanceBelowAmountError) {
        const symbol = feePreview?.kind === "split" ? feePreview.symbol : "this token";
        const decimals = feePreview?.kind === "split" ? feePreview.decimals : 18;
        setFundError(
          `The spending cap you approved (${formatTokenAmount(e.allowance, decimals)} ${symbol}) is ` +
            `below this contribution of ${formatTokenAmount(e.required, decimals)} ${symbol}. ` +
            `No funding transaction was sent. Press Fund again and approve at least the funding amount, or go back to change it.`,
        );
      } else {
        const stage: "approval" | "funding" = lastTxHash ? "funding" : "approval";
        const symbol = feePreview?.kind === "split" ? feePreview.symbol : undefined;
        setFundError(classifyFundingError(e, fundKind === "eth" ? "funding" : stage, symbol).message);
      }
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
  /**
   * Funding may only be signed once the economics are known: a V1 pool has no protocol fee, and a
   * V2 pool must have produced a successful live-rate split. Loading, a failed read, or a rate
   * change awaiting re-review all keep the button disabled.
   */
  const feeResolved =
    feePreview !== null &&
    !feePreviewLoading &&
    (feePreview.kind === "no-fee" || feePreview.kind === "split");
  const canSubmitFunding = step !== 3 || feeResolved;
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
                {feePreviewLoading && (
                  <p className="text-xs text-zinc-500" role="status">
                    Reading this pool’s current protocol fee…
                  </p>
                )}
                {feePreview?.kind === "split" && (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                    <div className="flex justify-between gap-4">
                      <span className="text-zinc-400">Funding amount</span>
                      <span className="text-white font-mono">
                        {formatTokenAmount(feePreview.split.grossAmount, feePreview.decimals)}{" "}
                        {feePreview.symbol}
                      </span>
                    </div>
                    <div className="mt-1 flex justify-between gap-4">
                      <span className="text-zinc-400">
                        Protocol fee ({formatFeeBpsPercent(feePreview.split.feeBps)})
                      </span>
                      <span className="text-white font-mono">
                        {formatTokenAmount(feePreview.split.feeAmount, feePreview.decimals)}{" "}
                        {feePreview.symbol}
                      </span>
                    </div>
                    <div className="mt-1 flex justify-between gap-4">
                      <span className="text-zinc-400">Pool receives</span>
                      <span className="text-white font-mono">
                        {formatTokenAmount(feePreview.split.netAmount, feePreview.decimals)}{" "}
                        {feePreview.symbol}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-zinc-500">
                      The protocol fee comes out of the amount you fund — it is not added on top.
                      Your wallet is debited the funding amount, plus network gas. Amounts are
                      estimated from the current price and settle at the price when your
                      transaction is mined. The fee rate lives on-chain and is re-checked when you
                      press Fund; it can still change before your transaction is mined, and can
                      never exceed the contract’s 3% maximum.
                    </p>
                  </div>
                )}
                {feePreview?.kind === "unavailable" && !feePreviewLoading && (
                  <div
                    className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3"
                    role="alert"
                  >
                    <p className="text-sm text-amber-400">
                      {feePreview.message} Funding is blocked until the current protocol fee can be
                      read, so you are never asked to sign for economics we could not confirm.
                    </p>
                    <button
                      type="button"
                      onClick={() => void loadFeePreview()}
                      className="mt-2 rounded-lg bg-zinc-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-brand-400"
                    >
                      Retry
                    </button>
                  </div>
                )}
                {feeRateChanged && (
                  <p className="text-sm text-amber-400" role="alert">
                    The protocol fee changed while you were reviewing. Check the updated amounts
                    above, then press Fund again.
                  </p>
                )}
                {lastTxHash && (
                  <div>
                    <dt className="text-zinc-500">Last tx</dt>
                    <dd className="text-white font-mono text-xs break-all">{lastTxHash}</dd>
                  </div>
                )}
              </dl>
              {fundKind === "erc20" && (
                <p className="mt-4 text-xs text-zinc-400" role="status">
                  ERC20 funding requires a one-time approval transaction the first time you
                  fund this pool with {assetSummary()}. Subsequent funds of the same pool will
                  be a single transaction. MetaMask will show the spending cap as Unlimited
                  for that approval — only this pool can pull from your allowance, and only
                  when you initiate a fund.
                </p>
              )}
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
            disabled={fundPending || !canSubmitFunding}
            className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-zinc-950 disabled:opacity-50"
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
