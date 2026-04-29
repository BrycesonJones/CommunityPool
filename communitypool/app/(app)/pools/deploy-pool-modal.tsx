"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import Link from "next/link";
import { getAddress, isAddress } from "ethers";
import { useWallet } from "@/components/wallet-provider";
import { formatUnits } from "ethers";
import { createClient } from "@/lib/supabase/client";
import { fetchKycStatus } from "@/lib/profile/kyc";
import type { CheckDeployResult } from "@/lib/pools/deploy-eligibility";
import {
  dateInputToExpiresAtUnix,
  deployCommunityPool,
  fundPoolEth,
  fundPoolErc20Human,
  getMinExpirationYmd,
  parseMinimumUsdHuman,
  validateExpirationDateYmd,
  weiForUsdContribution,
} from "@/lib/onchain/community-pool";
import {
  describePlatformAcceptedAssetsForDeploy,
  getErc20PresetsForDeployModal,
  getPoolChainConfig,
  PLATFORM_DEFAULT_SUPPORTED_ASSETS_DISPLAY,
  type Erc20PresetId,
} from "@/lib/onchain/pool-chain-config";
import {
  deployFlowEthFundFeeInefficiencyMessage,
  erc20UsdToHumanAmountString,
  formatUsdHumanForPoolMinimum,
  fundErc20FeeInefficiencyMessage,
  validateFundEthUsdHuman,
  validatePoolMinimumUsdHuman,
} from "@/lib/onchain/tx-economics";
import {
  normalizeUsdAmountInput,
  sanitizeUsdAmountInputPaste,
  sanitizeUsdAmountInputTyping,
  validateUsdAmountInputMessage,
} from "@/lib/onchain/usd-amount-input";
import { postClientSecurityEvent } from "@/lib/security/client-security-event";

type Step = 1 | 2 | 3 | 4;

type InitialFundKind = "eth" | "erc20";

type Erc20Selection = Erc20PresetId;

export type DeployedPoolSummary = {
  name: string;
  description: string;
  address: string;
  chainId: number;
  totalUsd: number;
  expiresAtUnix: number;
  minimumUsdWei: string;
  deployTxHash: string;
  fundTxHash: string | null;
  fundingStatus: "funding_pending" | "funded" | "funding_failed";
  needsRecovery?: boolean;
  coOwners: string[];
  deployerAddress: string;
  /** Token type of the initial funding ("ETH" / "WBTC" / "PAXG" / "XAU\u20ae"). */
  assetType: string;
  /** Human-readable token amount funded (e.g. "0.12345"). Empty string if unavailable. */
  fundedAmountHuman: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onDeployed?: (pool: DeployedPoolSummary) => void;
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

export default function DeployPoolModal({ open, onClose, onDeployed }: Props) {
  const { signer, isConnected, chainId, isWrongNetwork, switchToExpectedNetwork } = useWallet();

  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [initialFundKind, setInitialFundKind] = useState<InitialFundKind>("eth");
  const [initialErc20Selection, setInitialErc20Selection] = useState<Erc20Selection>("wbtc");
  const [fundAmount, setFundAmount] = useState("");
  const [owners, setOwners] = useState<string[]>([]);
  const [ownerInput, setOwnerInput] = useState("");
  const [expirationDate, setExpirationDate] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [deployTxHash, setDeployTxHash] = useState<string | null>(null);
  const [fundTxHash, setFundTxHash] = useState<string | null>(null);
  const [deployedAddress, setDeployedAddress] = useState<string | null>(null);
  const [feeWarning, setFeeWarning] = useState<string | null>(null);
  const [planLimitBlocked, setPlanLimitBlocked] = useState(false);

  const erc20Presets = useMemo(
    () => getErc20PresetsForDeployModal(chainId),
    [chainId],
  );

  const supportedAssetsLine = useMemo(() => {
    if (chainId === null) return PLATFORM_DEFAULT_SUPPORTED_ASSETS_DISPLAY;
    return describePlatformAcceptedAssetsForDeploy(chainId);
  }, [chainId]);

  const minExpirationYmd = getMinExpirationYmd();

  const normalizedFundAmount = useMemo<string | null>(() => {
    const r = normalizeUsdAmountInput(fundAmount);
    return r.ok ? r.canonical : null;
  }, [fundAmount]);

  useEffect(() => {
    if (erc20Presets.length === 0 && initialFundKind === "erc20") {
      setInitialFundKind("eth");
    }
    const ids = new Set(erc20Presets.map((p) => p.id));
    if (!ids.has(initialErc20Selection)) {
      const first = erc20Presets[0];
      if (first) setInitialErc20Selection(first.id);
    }
  }, [erc20Presets, initialFundKind, initialErc20Selection]);

  useEffect(() => {
    if (!open || step !== 2 || !signer || chainId === null) {
      setFeeWarning(null);
      return;
    }
    if (normalizedFundAmount === null) {
      setFeeWarning(null);
      return;
    }
    let cancelled = false;
    const cfg = getPoolChainConfig(chainId);
    (async () => {
      try {
        if (initialFundKind === "eth") {
          const msg = await deployFlowEthFundFeeInefficiencyMessage(
            signer,
            cfg.ethUsdPriceFeed,
            normalizedFundAmount,
          );
          if (!cancelled) setFeeWarning(msg);
          return;
        }
        const preset = erc20Presets.find((p) => p.id === initialErc20Selection);
        if (!preset) {
          if (!cancelled) setFeeWarning(null);
          return;
        }
        const usd = parseFloat(normalizedFundAmount);
        const msg = await fundErc20FeeInefficiencyMessage(
          signer,
          cfg.ethUsdPriceFeed,
          Number.isFinite(usd) ? usd : null,
        );
        if (!cancelled) setFeeWarning(msg);
      } catch {
        if (!cancelled) setFeeWarning(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    open,
    step,
    signer,
    chainId,
    initialFundKind,
    initialErc20Selection,
    normalizedFundAmount,
    erc20Presets,
  ]);

  const resetForm = useCallback(() => {
    setStep(1);
    setName("");
    setDescription("");
    setInitialFundKind("eth");
    setInitialErc20Selection("wbtc");
    setFundAmount("");
    setOwners([]);
    setOwnerInput("");
    setExpirationDate("");
    setErrors({});
    setDeploying(false);
    setDeployError(null);
    setDeployTxHash(null);
    setFundTxHash(null);
    setDeployedAddress(null);
    setFeeWarning(null);
    setPlanLimitBlocked(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    resetForm();
  }, [open, resetForm]);

  function validateStep1(): boolean {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = "Pool name is required";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function validateStep2(): boolean {
    const next: Record<string, string> = {};
    if (initialFundKind === "erc20" && erc20Presets.length === 0) {
      next.initialFund = "No default ERC20s on this network; fund with ETH or use another network.";
    }
    const inputMsg = validateUsdAmountInputMessage(fundAmount);
    if (inputMsg) {
      next.fundAmount = inputMsg;
    } else {
      const fe = validateFundEthUsdHuman(normalizedFundAmount ?? "");
      if (fe) next.fundAmount = fe;
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function advanceFromStep2(): Promise<void> {
    if (!validateStep2()) return;
    const canonical = normalizedFundAmount;
    if (canonical === null) return;
    if (signer && initialFundKind === "erc20") {
      const p = erc20Presets.find((x) => x.id === initialErc20Selection);
      if (p) {
        const humanToken = await erc20UsdToHumanAmountString(signer, p, canonical);
        if (humanToken === null) {
          setErrors((e) => ({
            ...e,
            fundAmount: "Could not read this token’s USD price. Try again or switch network.",
          }));
          return;
        }
        const usd = parseFloat(canonical);
        const minHuman = formatUsdHumanForPoolMinimum(usd);
        const pm = validatePoolMinimumUsdHuman(minHuman);
        if (pm) {
          setErrors((e) => ({ ...e, fundAmount: pm }));
          return;
        }
      }
    }
    setStep(3);
  }

  function validateStep3(): boolean {
    const next: Record<string, string> = {};
    const expirationError = validateExpirationDateYmd(expirationDate);
    if (expirationError) next.expirationDate = expirationError;
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function onExpirationDateChange(value: string) {
    setExpirationDate(value);
    if (errors.expirationDate && !validateExpirationDateYmd(value)) {
      setErrors((prev) => {
        if (!prev.expirationDate) return prev;
        const next = { ...prev };
        delete next.expirationDate;
        return next;
      });
    }
  }

  async function runDeploy() {
    setDeployError(null);
    setPlanLimitBlocked(false);
    if (!isConnected || !signer || chainId === null) {
      await postClientSecurityEvent({
        event_type: "pool.deploy.failed",
        severity: "medium",
        error_code: "wallet_not_connected",
        safe_message: "Deploy blocked because wallet is not connected.",
      });
      setDeployError("Connect a wallet to deploy.");
      return;
    }
    if (isWrongNetwork) {
      await postClientSecurityEvent({
        event_type: "pool.deploy.failed",
        severity: "high",
        chain_id: Number(chainId),
        error_code: "wrong_chain_blocked",
        safe_message: "Deploy blocked due to wrong chain.",
      });
      try {
        await switchToExpectedNetwork();
      } catch {
        setDeployError("Switch to the expected network in your wallet, then try again.");
      }
      return;
    }
    // Defense-in-depth KYC gate. The primary check happens at the "Deploy a
    // CommunityPool" button in pools-content; this catches the case where the
    // modal was opened via stale state or a profile field was cleared after.
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const status = await fetchKycStatus(supabase, user);
        if (!status.complete) {
          setDeployError(
            "Complete your name, address, and phone number in Account → Personal information before deploying.",
          );
          return;
        }
      }
    } catch {
      // Profile lookup unavailable — allow the deploy to proceed rather than
      // hard-blocking on a transient Supabase error.
    }
    // Server-side preflight: confirms the user is authenticated, resolves
    // Pro entitlement from Stripe-driven billing state, and counts deployed
    // pools. Free users are capped at FREE_POOL_LIMIT. Block here so the
    // wallet signature prompt never opens when the user is over the limit.
    try {
      const res = await fetch("/api/pools/check-deploy", { method: "POST" });
      if (res.status === 401) {
        setDeployError("Sign in to deploy a pool.");
        return;
      }
      if (!res.ok) {
        setDeployError(
          "Could not verify your plan eligibility. Please try again.",
        );
        return;
      }
      const result = (await res.json()) as CheckDeployResult;
      if (!result.allowed) {
        setPlanLimitBlocked(true);
        return;
      }
    } catch {
      setDeployError(
        "Could not verify your plan eligibility. Please try again.",
      );
      return;
    }
    setDeploying(true);
    setFundTxHash(null);
    const walletAddress = await signer.getAddress().catch(() => "");
    await postClientSecurityEvent({
      event_type: "pool.deploy.started",
      severity: "info",
      chain_id: Number(chainId),
      wallet_address: walletAddress,
      action: "deploy",
      status: "started",
      safe_message: "Pool deploy flow started.",
    });
    let confirmedPoolAddress: string | null = null;
    let confirmedDeployTxHash: string | null = null;
    let confirmedMinimumUsdWei: string | null = null;
    let confirmedTotalUsd = 0;
    let confirmedDeployerAddress: string | null = null;
    try {
      const canonical = normalizedFundAmount;
      if (canonical === null) {
        setDeployError("Enter a valid USD amount before deploying.");
        return;
      }
      let minimumUsdHuman: string;
      if (initialFundKind === "eth") {
        minimumUsdHuman = canonical;
      } else {
        const p = erc20Presets.find((x) => x.id === initialErc20Selection);
        if (!p) throw new Error("Token preset unavailable on this network.");
        const usd = parseFloat(canonical);
        minimumUsdHuman = formatUsdHumanForPoolMinimum(usd);
      }

      const { contract, deployTx } = await deployCommunityPool(signer, {
        name,
        description,
        minimumUsdHuman,
        coOwnerAddresses: owners.map((o) => getAddress(o.trim())),
        expirationDateYmd: expirationDate,
      });
      await postClientSecurityEvent({
        event_type: "pool.deploy.tx_submitted",
        severity: "info",
        chain_id: Number(chainId),
        tx_hash: deployTx.hash,
        wallet_address: walletAddress,
        action: "deploy",
        status: "submitted",
        safe_message: "Deploy transaction submitted.",
      });
      setDeployTxHash(deployTx.hash);
      await deployTx.wait();
      await contract.waitForDeployment();
      const poolAddr = await contract.getAddress();
      setDeployedAddress(poolAddr);
      confirmedPoolAddress = getAddress(poolAddr);
      confirmedDeployTxHash = deployTx.hash;

      let totalUsd = 0;
      if (initialFundKind === "eth" || initialFundKind === "erc20") {
        const n = parseFloat(canonical);
        totalUsd = Number.isFinite(n) ? n : 0;
      }
      confirmedTotalUsd = totalUsd;
      const deployerAddress = getAddress(await signer.getAddress());
      confirmedDeployerAddress = deployerAddress;
      const minimumUsdWei = parseMinimumUsdHuman(minimumUsdHuman).toString();
      confirmedMinimumUsdWei = minimumUsdWei;
      const initialAssetType =
        initialFundKind === "eth"
          ? "ETH"
          : (erc20Presets.find((p) => p.id === initialErc20Selection)?.symbol ?? "");

      // Persist deployment immediately after confirmation so a later fund
      // failure cannot orphan a real on-chain pool in app state.
      onDeployed?.({
        name: name.trim(),
        description: description.trim(),
        address: getAddress(poolAddr),
        chainId: Number(chainId),
        totalUsd,
        expiresAtUnix: Number(dateInputToExpiresAtUnix(expirationDate)),
        minimumUsdWei,
        deployTxHash: deployTx.hash,
        fundTxHash: null,
        fundingStatus: "funding_pending",
        coOwners: owners.map((o) => getAddress(o.trim())),
        deployerAddress,
        assetType: initialAssetType,
        fundedAmountHuman: "",
      });
      await postClientSecurityEvent({
        event_type: "pool.deploy.confirmed",
        severity: "info",
        chain_id: Number(chainId),
        pool_address: getAddress(poolAddr),
        tx_hash: deployTx.hash,
        wallet_address: walletAddress,
        action: "deploy",
        status: "confirmed",
        safe_message: "Deploy transaction confirmed.",
      });

      const cfg = getPoolChainConfig(chainId);
      let fundTx;
      let assetType = "";
      let fundedAmountHuman = "";
      await postClientSecurityEvent({
        event_type: "pool.fund.started",
        severity: "info",
        chain_id: Number(chainId),
        pool_address: getAddress(poolAddr),
        wallet_address: walletAddress,
        action: "fund",
        status: "started",
        safe_message: "Initial fund flow started.",
      });
      if (initialFundKind === "eth") {
        assetType = "ETH";
        try {
          const wei = await weiForUsdContribution(
            signer,
            cfg.ethUsdPriceFeed,
            canonical,
          );
          fundedAmountHuman = formatUnits(wei, 18);
        } catch {
          fundedAmountHuman = "";
        }
        fundTx = await fundPoolEth(signer, poolAddr, cfg.ethUsdPriceFeed, canonical);
      } else {
        const p = erc20Presets.find((x) => x.id === initialErc20Selection);
        if (!p) throw new Error("Token preset unavailable on this network.");
        const humanToken = await erc20UsdToHumanAmountString(signer, p, canonical);
        if (humanToken === null) {
          throw new Error("Could not compute token amount for this USD value.");
        }
        assetType = p.symbol;
        fundedAmountHuman = humanToken;
        fundTx = await fundPoolErc20Human(signer, poolAddr, getAddress(p.token), humanToken);
      }
      setFundTxHash(fundTx.hash);
      await postClientSecurityEvent({
        event_type: "pool.fund.tx_submitted",
        severity: "info",
        chain_id: Number(chainId),
        pool_address: getAddress(poolAddr),
        tx_hash: fundTx.hash,
        wallet_address: walletAddress,
        action: "fund",
        status: "submitted",
        safe_message: "Initial fund transaction submitted.",
      });
      await fundTx.wait();
      await postClientSecurityEvent({
        event_type: "pool.fund.confirmed",
        severity: "info",
        chain_id: Number(chainId),
        pool_address: getAddress(poolAddr),
        tx_hash: fundTx.hash,
        wallet_address: walletAddress,
        action: "fund",
        status: "confirmed",
        safe_message: "Initial fund transaction confirmed.",
      });

      onDeployed?.({
        name: name.trim(),
        description: description.trim(),
        address: getAddress(poolAddr),
        chainId: Number(chainId),
        totalUsd,
        expiresAtUnix: Number(dateInputToExpiresAtUnix(expirationDate)),
        minimumUsdWei,
        deployTxHash: deployTx.hash,
        fundTxHash: fundTx.hash,
        fundingStatus: "funded",
        coOwners: owners.map((o) => getAddress(o.trim())),
        deployerAddress,
        assetType,
        fundedAmountHuman,
      });
    } catch (e) {
      await postClientSecurityEvent({
        event_type:
          confirmedPoolAddress && confirmedDeployTxHash
            ? "pool.fund.failed"
            : "pool.deploy.failed",
        severity: "high",
        chain_id: chainId === null ? undefined : Number(chainId),
        pool_address: confirmedPoolAddress ?? undefined,
        tx_hash: confirmedDeployTxHash ?? undefined,
        wallet_address: walletAddress,
        error_code: e instanceof Error ? e.message : "deploy_or_fund_failed",
        safe_message: "Pool deploy/fund flow failed.",
      });
      if (
        confirmedPoolAddress &&
        confirmedDeployTxHash &&
        confirmedMinimumUsdWei &&
        confirmedDeployerAddress
      ) {
        onDeployed?.({
          name: name.trim(),
          description: description.trim(),
          address: confirmedPoolAddress,
          chainId: Number(chainId),
          totalUsd: confirmedTotalUsd,
          expiresAtUnix: Number(dateInputToExpiresAtUnix(expirationDate)),
          minimumUsdWei: confirmedMinimumUsdWei,
          deployTxHash: confirmedDeployTxHash,
          fundTxHash,
          fundingStatus: "funding_failed",
          needsRecovery: true,
          coOwners: owners.map((o) => getAddress(o.trim())),
          deployerAddress: confirmedDeployerAddress,
          assetType: initialFundKind === "eth" ? "ETH" : (erc20Presets.find((p) => p.id === initialErc20Selection)?.symbol ?? ""),
          fundedAmountHuman: "",
        });
      }
      setDeployError(e instanceof Error ? e.message : "Deployment or funding failed.");
    } finally {
      setDeploying(false);
    }
  }

  function handleContinue() {
    if (step === 1) {
      if (!validateStep1()) return;
      setStep(2);
    } else if (step === 2) {
      void advanceFromStep2();
    } else if (step === 3) {
      if (!validateStep3()) return;
      setStep(4);
    } else if (step === 4) {
      const partialFail = Boolean(deployedAddress && deployError);
      const ok = Boolean(deployedAddress && !deployError);
      if (ok || partialFail || planLimitBlocked) {
        onClose();
        resetForm();
        return;
      }
      void runDeploy();
    }
  }

  function handleBack() {
    if (step > 1) setStep((s) => (s - 1) as Step);
  }

  function addOwner() {
    const trimmed = ownerInput.trim();
    if (!trimmed) return;
    if (!isAddress(trimmed)) {
      setErrors({ owner: "Enter a valid Ethereum address" });
      return;
    }
    const checksummed = getAddress(trimmed);
    setErrors({});
    if (owners.some((o) => getAddress(o.trim()) === checksummed)) return;
    setOwners((prev) => [...prev, checksummed]);
    setOwnerInput("");
  }

  function removeOwner(addr: string) {
    setOwners((prev) => prev.filter((a) => a !== addr));
  }

  if (!open) return null;

  const isFirstStep = step === 1;
  const success = Boolean(deployedAddress) && !deployError;
  const partialFail = Boolean(deployedAddress && deployError);
  const primaryLabel =
    step === 3
      ? "Review"
      : step === 4
        ? success || partialFail || planLimitBlocked
          ? "Close"
          : "Deploy"
        : "Continue";

  const stepTitles: Record<Step, string> = {
    1: "What is the name of your pool?",
    2: "How much do you want to fund?",
    3: "Add additional owners",
    4: "Review your pool",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="deploy-modal-title"
    >
      <div
        className="absolute inset-0 bg-black/70"
        aria-hidden
        onClick={onClose}
      />
      <div className="relative w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950/95 shadow-xl">
        <div className="p-6 pb-4">
          <h2 id="deploy-modal-title" className="text-lg font-semibold text-white mb-4">
            {stepTitles[step]}
          </h2>
          {step === 1 && (
            <>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="CommunityPool"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900/50 px-4 py-3 text-white placeholder:text-zinc-500 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400 mb-6"
                aria-invalid={!!errors.name}
              />
              {errors.name && <p className="text-sm text-amber-400 mb-4 -mt-4">{errors.name}</p>}
              <h3 className="text-lg font-semibold text-white mb-2">Pool Description?</h3>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="CommunityPool Description for now"
                rows={3}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900/50 px-4 py-3 text-white placeholder:text-zinc-500 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400 resize-none"
              />
            </>
          )}
          {step === 2 && (
            <>
              <p className="text-sm text-zinc-400 mb-1">Assets this pool will accept</p>
              <p className="text-sm text-zinc-300 mb-4">{supportedAssetsLine}</p>

              <p className="text-sm text-zinc-400 mb-3">Fund with</p>
              <div className="flex flex-wrap gap-2 mb-4">
                <button
                  type="button"
                  onClick={() => setInitialFundKind("eth")}
                  className={`rounded-lg px-4 py-2 text-sm font-medium ${initialFundKind === "eth" ? "bg-brand-600 text-white" : "bg-zinc-800 text-zinc-300"}`}
                >
                  ETH
                </button>
                {erc20Presets.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setInitialFundKind("erc20");
                      setInitialErc20Selection(p.id);
                    }}
                    className={`rounded-lg px-4 py-2 text-sm font-medium ${initialFundKind === "erc20" && initialErc20Selection === p.id ? "bg-brand-600 text-white" : "bg-zinc-800 text-zinc-300"}`}
                  >
                    {p.symbol}
                  </button>
                ))}
              </div>

              <label className="block text-sm font-medium text-white mb-2" htmlFor="deploy-fund-amount">
                Amount (human dollars, USD)
              </label>
              <input
                id="deploy-fund-amount"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={fundAmount}
                onChange={(e) =>
                  setFundAmount(sanitizeUsdAmountInputTyping(e.target.value, fundAmount))
                }
                onPaste={(e) => {
                  e.preventDefault();
                  const pasted = e.clipboardData.getData("text");
                  setFundAmount(sanitizeUsdAmountInputPaste(pasted));
                }}
                placeholder="0.01"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900/50 px-4 py-3 text-white placeholder:text-zinc-500 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
                aria-invalid={!!errors.fundAmount}
              />
              {errors.fundAmount && (
                <p className="text-sm text-amber-400 mt-2">{errors.fundAmount}</p>
              )}
              {errors.initialFund && <p className="text-sm text-amber-400 mt-2">{errors.initialFund}</p>}
              <p className="text-sm text-zinc-500 mt-4">
                After deployment, your wallet will be asked to confirm a second transaction to complete this deposit.
              </p>
              {feeWarning && (
                <p className="text-sm text-amber-400 mt-3" role="status">
                  {feeWarning}
                </p>
              )}
            </>
          )}
          {step === 3 && (
            <>
              <p className="text-sm text-zinc-500 mb-3">
                Add additional public wallet addresses to make those addresses owners of the pool
              </p>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={ownerInput}
                  onChange={(e) => setOwnerInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addOwner())}
                  placeholder="0x… additional owner"
                  className="flex-1 min-w-0 rounded-lg border border-zinc-700 bg-zinc-900/50 px-4 py-3 text-white placeholder:text-zinc-500 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
                />
                <button
                  type="button"
                  onClick={addOwner}
                  className="shrink-0 rounded-lg bg-zinc-700 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-600"
                >
                  Add
                </button>
              </div>
              {errors.owner && <p className="text-sm text-amber-400 mb-2">{errors.owner}</p>}
              {owners.length > 0 && (
                <ul className="space-y-2 mb-6">
                  {owners.map((addr) => (
                    <li key={addr} className="flex items-center justify-between text-sm font-mono text-zinc-300 bg-zinc-900/50 rounded px-3 py-2">
                      <span className="truncate">{addr}</span>
                      <button type="button" onClick={() => removeOwner(addr)} className="text-amber-400 hover:text-amber-300 ml-2 shrink-0">Remove</button>
                    </li>
                  ))}
                </ul>
              )}
              <h3 className="text-base font-semibold text-white mb-2">Pool expiration date</h3>
              <input
                type="date"
                value={expirationDate}
                min={minExpirationYmd}
                onChange={(e) => onExpirationDateChange(e.target.value)}
                aria-invalid={!!errors.expirationDate}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900/50 px-4 py-3 text-white focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
              />
              {errors.expirationDate && (
                <p className="mt-2 text-sm text-amber-400">
                  {errors.expirationDate}
                </p>
              )}
              <p className="text-sm text-zinc-500 mt-4">
                Before this date, any pool owner (you plus added addresses) can withdraw all ETH and whitelisted
                ERC20s to their own wallet. After this date, new funding is not accepted and owner withdrawals are
                disabled on-chain; anyone can submit a transaction to release any remaining assets to the pool
                deployer&apos;s address.
              </p>
            </>
          )}
          {step === 4 && (
            <>
              {success ? (
                <div className="space-y-3 text-sm">
                  <p className="text-brand-300 font-medium">Pool deployed and funded</p>
                  <div>
                    <dt className="text-zinc-500">Contract address</dt>
                    <dd className="text-white font-mono text-xs break-all mt-1">{deployedAddress}</dd>
                  </div>
                  {deployTxHash && (
                    <div>
                      <dt className="text-zinc-500">Deploy transaction</dt>
                      <dd className="text-white font-mono text-xs break-all mt-1">{deployTxHash}</dd>
                    </div>
                  )}
                  {fundTxHash && (
                    <div>
                      <dt className="text-zinc-500">Fund transaction</dt>
                      <dd className="text-white font-mono text-xs break-all mt-1">{fundTxHash}</dd>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <dl className="space-y-3 text-sm">
                    <div>
                      <dt className="text-zinc-500">Pool name</dt>
                      <dd className="text-white font-medium">{name || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-zinc-500">Pool description</dt>
                      <dd className="text-white">{description || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-zinc-500">Supported assets</dt>
                      <dd className="text-white">{supportedAssetsLine}</dd>
                    </div>
                    <div>
                      <dt className="text-zinc-500">Initial fund</dt>
                      <dd className="text-white">
                        {initialFundKind === "eth"
                          ? `ETH · $${fundAmount || "0"} USD (pool minimum matches this deposit)`
                          : `${erc20Presets.find((p) => p.id === initialErc20Selection)?.symbol ?? "ERC20"} · $${fundAmount || "0"} USD (pool minimum matches this deposit’s USD value)`}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-zinc-500">Pool owners</dt>
                      <dd className="text-white">
                        {owners.length === 0 ? "You only (connected wallet address)" : `You + ${owners.length} address(es)`}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-zinc-500">Pool expiration date</dt>
                      <dd className="text-white">{expirationDate || "—"}</dd>
                    </div>
                  </dl>
                  {deployedAddress && deployError && (
                    <div className="mt-4 rounded-lg border border-amber-700/50 bg-amber-950/30 p-3 text-sm">
                      <p className="text-amber-200 font-medium">Pool created, but funding failed</p>
                      <p className="text-zinc-400 font-mono text-xs break-all mt-1">{deployedAddress}</p>
                      {deployTxHash && (
                        <p className="text-zinc-500 text-xs mt-1">Deploy tx: {deployTxHash}</p>
                      )}
                      {fundTxHash && (
                        <p className="text-zinc-500 text-xs mt-1">Fund tx: {fundTxHash}</p>
                      )}
                      <p className="text-zinc-500 text-xs mt-1">
                        Use Fund a Pool to retry funding this deployed pool.
                      </p>
                    </div>
                  )}
                  {planLimitBlocked && (
                    <div
                      className="mt-4 rounded-lg border border-blue-700/50 bg-blue-950/30 p-3 text-sm"
                      role="alert"
                    >
                      <p className="text-blue-200 font-medium">
                        Free plan limit reached. Upgrade to Pro for unlimited pools.
                      </p>
                      <Link
                        href="/pricing"
                        className="mt-2 inline-flex items-center justify-center rounded-full bg-gradient-to-b from-blue-400 via-blue-500 to-blue-700 px-4 py-2 text-xs font-medium text-white shadow-lg shadow-blue-500/30 hover:from-blue-300 hover:via-blue-400 hover:to-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-zinc-950"
                      >
                        Upgrade to Pro
                      </Link>
                    </div>
                  )}
                  {deployError && (
                    <p className="mt-4 text-sm text-amber-400" role="alert">
                      {deployError}
                    </p>
                  )}
                </>
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
            disabled={step === 4 && !success && !partialFail && deploying}
            className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-zinc-950 disabled:opacity-50 disabled:pointer-events-none"
          >
            {deploying ? "Working…" : primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
