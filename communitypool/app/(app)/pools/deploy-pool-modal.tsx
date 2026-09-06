"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { getAddress, isAddress, parseUnits } from "ethers";
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
import {
  formatFeeBpsPercent,
  formatTokenAmount,
  previewFundingSplit,
  readChainProtocolFeeBps,
  type FundingSplit,
} from "@/lib/onchain/protocol-fee";
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
  /**
   * Hand a deployed-but-unfunded pool to the normal Fund flow. Used when the initial contribution
   * is paused because the protocol fee moved or could not be confirmed: rather than duplicating
   * fee confirmation here, the user finishes in the reviewed funding UI.
   */
  onRequestFund?: (pool: { name: string; address: string; chainId: number }) => void;
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

export default function DeployPoolModal({ open, onClose, onDeployed, onRequestFund }: Props) {
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
  /**
   * Live protocol fee for this chain. Held as state only so a failed read is distinguishable from
   * a zero rate; the numbers the user sees come from `initialFundSplit`.
   */
  const [, setProtocolFeeBps] = useState<bigint | null>(null);
  const [protocolFeeLoading, setProtocolFeeLoading] = useState(false);
  /**
   * Token-native economics of the initial contribution this flow makes right after deployment.
   * The deploy flow funds without a second review, so the numbers must be shown before the first
   * wallet prompt, not between the two transactions.
   */
  const [initialFundSplit, setInitialFundSplit] = useState<
    { symbol: string; decimals: number; split: FundingSplit } | null
  >(null);
  const [initialFundSplitLoading, setInitialFundSplitLoading] = useState(false);
  /**
   * Set when the initial contribution was NOT submitted because the protocol fee moved, or could
   * not be confirmed, at one of the two re-read gates. The pool itself is already deployed and is
   * persisted as funding-pending; the user finishes through the reviewed Fund flow.
   */
  const [fundingPaused, setFundingPaused] = useState<{
    reason: "fee_changed" | "fee_unreadable";
    poolAddress: string;
    reviewedBps: bigint;
    currentBps: bigint | null;
  } | null>(null);
  /** Set when the rate moved between the step-4 preview and pressing Deploy. */
  const [preDeployFeeChanged, setPreDeployFeeChanged] = useState(false);

  const erc20Presets = useMemo(
    () => getErc20PresetsForDeployModal(chainId),
    [chainId],
  );

  const supportedAssetsLine = useMemo(() => {
    if (chainId === null) return PLATFORM_DEFAULT_SUPPORTED_ASSETS_DISPLAY;
    return describePlatformAcceptedAssetsForDeploy(chainId);
  }, [chainId]);

  /**
   * Read the chain's live protocol fee so the deploy summary states the real rate. New pools are
   * V2, so every contribution — including the initial deposit in this flow — pays it. Left null on
   * a read failure; the summary then describes the fee without asserting a number.
   */

  const minExpirationYmd = getMinExpirationYmd();

  const normalizedFundAmount = useMemo<string | null>(() => {
    const r = normalizeUsdAmountInput(fundAmount);
    return r.ok ? r.canonical : null;
  }, [fundAmount]);

  const loadProtocolFee = useCallback(async (): Promise<bigint | null> => {
    if (!signer || chainId === null) {
      setProtocolFeeBps(null);
      return null;
    }
    setProtocolFeeLoading(true);
    try {
      const cfg = getPoolChainConfig(chainId);
      if (!cfg.protocolConfig) {
        setProtocolFeeBps(null);
        return null;
      }
      const bps = await readChainProtocolFeeBps(signer.provider!, cfg.protocolConfig);
      setProtocolFeeBps(bps);
      return bps;
    } catch {
      setProtocolFeeBps(null);
      return null;
    } finally {
      setProtocolFeeLoading(false);
    }
  }, [signer, chainId]);

  // Depend on stable primitives, not on the callback identity: a wallet provider that hands back
  // a fresh signer object on each render would otherwise re-fire this effect every render and
  // hammer the RPC (and flicker the review step back into its loading state).
  const hasSigner = Boolean(signer);
  useEffect(() => {
    void loadProtocolFee();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainId, hasSigner]);

  /**
   * One raw read of the chain's current protocol fee. Returns null when the chain has no
   * ProtocolConfig configured or the read fails, so callers can distinguish "unknown" from a
   * genuine 0 bps.
   */
  const readCurrentFeeBps = useCallback(async (): Promise<bigint | null> => {
    if (!signer || chainId === null) return null;
    try {
      const cfg = getPoolChainConfig(chainId);
      if (!cfg.protocolConfig) return null;
      return await readChainProtocolFeeBps(signer.provider!, cfg.protocolConfig);
    } catch {
      return null;
    }
  }, [signer, chainId]);

  /**
   * Resolve the initial contribution's split for the review step. Deploying immediately proceeds
   * into a funding transaction, so the flow must not start while the live rate is unknown — a
   * transient RPC failure asks for a retry instead of deploying a pool and then prompting for a
   * funding signature with unknown economics.
   */
  const loadInitialFundSplit = useCallback(async (): Promise<void> => {
    setInitialFundSplit(null);
    if (!signer || chainId === null) return;
    const canonical = normalizedFundAmount;
    if (canonical === null) return;
    setInitialFundSplitLoading(true);
    try {
      const bps = await loadProtocolFee();
      if (bps === null) return;
      let grossAmount: bigint;
      let symbol: string;
      let decimals: number;
      if (initialFundKind === "eth") {
        const cfg = getPoolChainConfig(chainId);
        grossAmount = await weiForUsdContribution(signer, cfg.ethUsdPriceFeed, canonical);
        symbol = "ETH";
        decimals = 18;
      } else {
        const preset = erc20Presets.find((x) => x.id === initialErc20Selection);
        if (!preset) return;
        const human = await erc20UsdToHumanAmountString(signer, preset, canonical);
        if (human === null) return;
        grossAmount = parseUnits(human, preset.decimals);
        symbol = preset.symbol;
        decimals = preset.decimals;
      }
      setInitialFundSplit({ symbol, decimals, split: previewFundingSplit(grossAmount, bps) });
    } catch {
      setInitialFundSplit(null);
    } finally {
      setInitialFundSplitLoading(false);
    }
  }, [
    signer,
    chainId,
    normalizedFundAmount,
    initialFundKind,
    initialErc20Selection,
    erc20Presets,
    loadProtocolFee,
  ]);

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
    setInitialFundSplit(null);
    setInitialFundSplitLoading(false);
    setFundingPaused(null);
    setPreDeployFeeChanged(false);
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
    // Server-side preflight: confirms the user still holds a valid session
    // before the wallet signature prompt opens. There is no plan or pool
    // limit — every authenticated user can deploy unlimited pools.
    try {
      const res = await fetch("/api/pools/check-deploy", { method: "POST" });
      if (res.status === 401) {
        setDeployError("Sign in to deploy a pool.");
        return;
      }
      if (!res.ok) {
        setDeployError(
          "Could not verify deploy eligibility. Please try again.",
        );
        return;
      }
      const result = (await res.json()) as CheckDeployResult;
      if (!result.allowed) {
        setDeployError("Sign in to deploy a pool.");
        return;
      }
    } catch {
      setDeployError(
        "Could not verify deploy eligibility. Please try again.",
      );
      return;
    }
    // Gate A — the rate the user reviewed must still hold at the moment we ask them to sign.
    // Step 4 read it when the review rendered, and an admin can move it in between.
    const reviewedBps = initialFundSplit?.split.feeBps ?? null;
    if (reviewedBps === null) {
      setDeployError(
        "The current protocol fee could not be read. Retry above before deploying — the deploy flow funds the pool immediately after creating it.",
      );
      return;
    }
    const preDeployBps = await readCurrentFeeBps();
    if (preDeployBps === null) {
      // Unknown rate: drop back to the blocked review state, which offers Retry.
      setInitialFundSplit(null);
      setDeployError(
        "Could not confirm the current protocol fee before deploying. Retry above, then deploy.",
      );
      return;
    }
    if (preDeployBps !== reviewedBps) {
      setPreDeployFeeChanged(true);
      setDeployError(
        `The protocol fee changed from ${formatFeeBpsPercent(reviewedBps)} to ` +
          `${formatFeeBpsPercent(preDeployBps)} while you were reviewing. Check the updated amounts, then deploy again.`,
      );
      await loadInitialFundSplit();
      return;
    }
    setPreDeployFeeChanged(false);

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

      // Gate B — the pool now exists, and the funding prompt is about to open automatically.
      // Confirm the rate the user reviewed is still live; if it moved or cannot be read, do not
      // fund. The pool is already persisted as funding-pending above, so nothing is lost: the
      // user finishes in the reviewed Fund flow instead of signing unreviewed economics.
      const preFundBps = await readCurrentFeeBps();
      if (preFundBps === null || preFundBps !== reviewedBps) {
        setFundingPaused({
          reason: preFundBps === null ? "fee_unreadable" : "fee_changed",
          poolAddress: getAddress(poolAddr),
          reviewedBps,
          currentBps: preFundBps,
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
          fundTxHash: null,
          fundingStatus: "funding_pending",
          needsRecovery: true,
          coOwners: owners.map((o) => getAddress(o.trim())),
          deployerAddress,
          assetType: initialAssetType,
          fundedAmountHuman: "",
        });
        await postClientSecurityEvent({
          event_type: "pool.fund.blocked",
          severity: "medium",
          chain_id: Number(chainId),
          pool_address: getAddress(poolAddr),
          wallet_address: walletAddress,
          action: "fund",
          status: "blocked",
          error_code: preFundBps === null ? "fee_unreadable" : "fee_changed",
          safe_message: "Initial funding paused before the wallet prompt; protocol fee unconfirmed.",
        });
        return;
      }

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
      void loadInitialFundSplit();
    } else if (step === 4) {
      const partialFail = Boolean(deployedAddress && deployError);
      const ok = Boolean(deployedAddress && !deployError);
      if (ok || partialFail || fundingPaused) {
        onClose();
        resetForm();
        return;
      }
      if (!initialFundSplit) {
        // Deploying proceeds straight into a funding transaction; refuse to start that pair while
        // the fee is unknown rather than deploying and then prompting with unknown economics.
        setDeployError(
          "The current protocol fee could not be read. Retry above before deploying — the deploy flow funds the pool immediately after creating it.",
        );
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
  const success = Boolean(deployedAddress) && !deployError && !fundingPaused;
  const partialFail = Boolean(deployedAddress && deployError);
  const paused = Boolean(fundingPaused);
  const primaryLabel =
    step === 3
      ? "Review"
      : step === 4
        ? success || partialFail || paused
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
              {fundingPaused ? (
                <div className="space-y-3 text-sm">
                  <p className="text-amber-400 font-medium">
                    Pool deployed — initial funding paused
                  </p>
                  <div>
                    <dt className="text-zinc-500">Contract address</dt>
                    <dd className="text-white font-mono text-xs break-all mt-1">
                      {fundingPaused.poolAddress}
                    </dd>
                  </div>
                  {deployTxHash && (
                    <div>
                      <dt className="text-zinc-500">Deploy transaction</dt>
                      <dd className="text-white font-mono text-xs break-all mt-1">{deployTxHash}</dd>
                    </div>
                  )}
                  <p className="text-zinc-300">
                    {fundingPaused.reason === "fee_changed" ? (
                      <>
                        Your pool was created successfully. The protocol fee changed from{" "}
                        {formatFeeBpsPercent(fundingPaused.reviewedBps)} to{" "}
                        {fundingPaused.currentBps === null
                          ? "another rate"
                          : formatFeeBpsPercent(fundingPaused.currentBps)}{" "}
                        after the pool was created, so the deposit was not sent.
                      </>
                    ) : (
                      <>
                        Your pool was created successfully. The current protocol fee could not be
                        confirmed after the pool was created, so the deposit was not sent.
                      </>
                    )}{" "}
                    <strong className="text-white">
                      No funding transaction was submitted and nothing was charged for it
                    </strong>
                    {" "}— only the deployment gas you already paid. The pool is saved and waiting
                    for its first deposit.
                  </p>
                  <p className="text-zinc-400 text-xs">
                    Fund it whenever you like from the Fund flow, which shows the current fee and
                    the exact split before you sign.
                  </p>
                  {onRequestFund && (
                    <button
                      type="button"
                      onClick={() => {
                        const target = {
                          name: name.trim(),
                          address: fundingPaused.poolAddress,
                          chainId: Number(chainId ?? 0),
                        };
                        resetForm();
                        onRequestFund(target);
                      }}
                      className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-400"
                    >
                      Review and fund this pool
                    </button>
                  )}
                </div>
              ) : success ? (
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
                      <dt className="text-zinc-500">Initial contribution</dt>
                      <dd className="mt-1">
                        {initialFundSplitLoading || protocolFeeLoading ? (
                          <span className="text-xs text-zinc-500" role="status">
                            Reading the current protocol fee…
                          </span>
                        ) : initialFundSplit ? (
                          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                            <div className="flex justify-between gap-4">
                              <span className="text-zinc-400">Funding amount</span>
                              <span className="text-white font-mono">
                                {formatTokenAmount(
                                  initialFundSplit.split.grossAmount,
                                  initialFundSplit.decimals,
                                )}{" "}
                                {initialFundSplit.symbol}
                              </span>
                            </div>
                            <div className="mt-1 flex justify-between gap-4">
                              <span className="text-zinc-400">
                                Protocol fee ({formatFeeBpsPercent(initialFundSplit.split.feeBps)})
                              </span>
                              <span className="text-white font-mono">
                                {formatTokenAmount(
                                  initialFundSplit.split.feeAmount,
                                  initialFundSplit.decimals,
                                )}{" "}
                                {initialFundSplit.symbol}
                              </span>
                            </div>
                            <div className="mt-1 flex justify-between gap-4">
                              <span className="text-zinc-400">Pool receives</span>
                              <span className="text-white font-mono">
                                {formatTokenAmount(
                                  initialFundSplit.split.netAmount,
                                  initialFundSplit.decimals,
                                )}{" "}
                                {initialFundSplit.symbol}
                              </span>
                            </div>
                            {preDeployFeeChanged && (
                              <p className="mt-2 text-sm text-amber-400" role="alert">
                                The protocol fee changed while you were reviewing. These are the
                                updated amounts — press Deploy again to confirm them.
                              </p>
                            )}
                            <p className="mt-2 text-xs text-zinc-500">
                              Deploying also funds the pool, so this contribution happens right
                              after the pool is created. The protocol fee comes out of the amount
                              funded — it is not added on top. The rate is re-checked before the
                              deployment prompt and again before the deposit prompt, so you are
                              never asked to sign a rate you have not seen. It can still change
                              between that last check and your transaction being mined, and can
                              never exceed the 3% maximum.
                            </p>
                          </div>
                        ) : (
                          <div
                            className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3"
                            role="alert"
                          >
                            <p className="text-sm text-amber-400">
                              Could not read the current protocol fee. Deployment is blocked until
                              it can be read, so you are never asked to fund a new pool with
                              unknown economics.
                            </p>
                            <button
                              type="button"
                              onClick={() => void loadInitialFundSplit()}
                              className="mt-2 rounded-lg bg-zinc-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-brand-400"
                            >
                              Retry
                            </button>
                          </div>
                        )}
                      </dd>
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
                  {chainId === BigInt(1) && !deployedAddress && (
                    <div
                      className="mt-4 rounded-lg border border-amber-700/50 bg-amber-950/30 p-3 text-xs text-amber-200"
                      role="status"
                    >
                      Deploying a pool on Ethereum mainnet will spend ETH gas even if the later funding
                      step fails. Gas fees are paid to the network and cannot be refunded.
                    </div>
                  )}
                  {deployedAddress && deployError && (
                    <div className="mt-4 rounded-lg border border-amber-700/50 bg-amber-950/30 p-3 text-sm">
                      <p className="text-amber-200 font-medium">Pool deployed, but token funding failed</p>
                      <p className="text-zinc-300 text-xs mt-1">
                        Your pool exists on-chain, but the selected token was not deposited. ETH may still
                        have been spent on gas for the deploy transaction.
                      </p>
                      {initialFundKind === "erc20" && (
                        <p className="text-zinc-300 text-xs mt-1">
                          No {erc20Presets.find((p) => p.id === initialErc20Selection)?.symbol ?? "tokens"}{" "}
                          left your wallet unless the approval and funding transactions both succeeded.
                        </p>
                      )}
                      <p className="text-zinc-400 font-mono text-xs break-all mt-2">{deployedAddress}</p>
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
            disabled={
              step === 4 &&
              !success &&
              !partialFail &&
              (deploying || initialFundSplitLoading || protocolFeeLoading || !initialFundSplit) &&
              !fundingPaused
            }
            className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-zinc-950 disabled:opacity-50 disabled:pointer-events-none"
          >
            {deploying ? "Working…" : primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
