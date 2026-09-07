/**
 * Fund modal — protocol-fee preview (Phase 2.8 activation).
 *
 * The unit tests in test/onchain/protocol-fee.test.ts prove the arithmetic and the detection
 * logic. These prove the modal is actually wired to them, which is the part a refactor breaks
 * silently:
 *   - a V2 pool shows the funding amount, the fee at the LIVE rate, and what the pool receives
 *   - a V1 pool shows no fee at all
 *   - a failed read says so instead of implying the contribution is fee-free
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { parseUnits } from "ethers";

const {
  buildFundingPreviewMock,
  erc20UsdToHumanMock,
  weiForUsdMock,
  readLiveProtocolFeeMock,
  fundPoolEthMock,
  fundPoolErc20ExactMock,
  connectWalletMock,
} = vi.hoisted(() => ({
  buildFundingPreviewMock: vi.fn(),
  erc20UsdToHumanMock: vi.fn(),
  weiForUsdMock: vi.fn(),
  readLiveProtocolFeeMock: vi.fn(),
  fundPoolEthMock: vi.fn(),
  fundPoolErc20ExactMock: vi.fn(),
  connectWalletMock: vi.fn(),
}));

vi.mock("@/lib/onchain/price-math", async () => {
  const actual = await vi.importActual<typeof import("@/lib/onchain/price-math")>(
    "@/lib/onchain/price-math",
  );
  return { ...actual, weiForUsdContribution: weiForUsdMock };
});

vi.mock("@/lib/onchain/protocol-fee", async () => {
  const actual = await vi.importActual<typeof import("@/lib/onchain/protocol-fee")>(
    "@/lib/onchain/protocol-fee",
  );
  return {
    ...actual,
    buildFundingPreview: buildFundingPreviewMock,
    readLiveProtocolFee: readLiveProtocolFeeMock,
  };
});

vi.mock("@/lib/onchain/tx-economics", async () => {
  const actual = await vi.importActual<typeof import("@/lib/onchain/tx-economics")>(
    "@/lib/onchain/tx-economics",
  );
  return {
    ...actual,
    erc20UsdToHumanAmountString: erc20UsdToHumanMock,
    fundEthFeeInefficiencyMessage: async () => null,
    fundErc20FeeInefficiencyMessage: async () => null,
  };
});

vi.mock("@/lib/onchain/community-pool", async () => {
  const actual = await vi.importActual<typeof import("@/lib/onchain/community-pool")>(
    "@/lib/onchain/community-pool",
  );
  return {
    ...actual,
    getPoolWhitelistedTokenAddresses: async () => [],
    fundPoolEthExact: fundPoolEthMock,
    fundPoolEthUsd: fundPoolEthMock,
    fundPoolEth: fundPoolEthMock,
    fundPoolErc20Exact: fundPoolErc20ExactMock,
  };
});

vi.mock("@/lib/security/client-security-event", () => ({
  postClientSecurityEvent: async () => undefined,
}));

const fakeSigner = {
  getAddress: async () => "0x000000000000000000000000000000000000dEaD",
  provider: { getCode: async () => "0x60806040" },
};

/** Mutable so a test can simulate a disconnected wallet, then connecting. */
const walletState: { signer: unknown } = { signer: fakeSigner };

vi.mock("@/components/wallet-provider", () => ({
  useWallet: () => ({
    walletAddress: "0x000000000000000000000000000000000000dEaD",
    isConnected: true,
    provider: null,
    get signer() {
      return walletState.signer;
    },
    chainId: BigInt(1),
    isWrongNetwork: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    switchToExpectedNetwork: vi.fn(),
    // Consumed by the real WalletPicker this modal renders.
    connectors: [{ id: "metamask", name: "MetaMask" }],
    availability: { metamask: true },
    isWalletDiscoveryComplete: true,
    isConnecting: false,
    connectWallet: connectWalletMock,
  }),
}));

import { AllowanceBelowAmountError, FundingStageError } from "@/lib/onchain/funding-errors";
import { formatTokenAmountExact } from "@/lib/onchain/protocol-fee";
import FundPoolModal from "@/app/(app)/pools/fund-pool-modal";

const POOL = "0x00000000000000000000000000000000000000A1";

/** Fill in the pool address and amount, then advance to the review step. */
async function openReviewStep(amount = "100") {
  render(<FundPoolModal open onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText(/pool contract address/i), { target: { value: POOL } });
  fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
  fireEvent.change(await screen.findByLabelText(/amount/i), { target: { value: amount } });
  fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
}

const splitAt = (feeBps: bigint, feeAmount: bigint, netAmount: bigint) => ({
  kind: "split" as const,
  version: "v2" as const,
  symbol: "ETH",
  decimals: 18,
  split: { grossAmount: 1_000000000000000000n, feeAmount, netAmount, feeBps },
});

const fundButton = () => screen.getByRole("button", { name: /^fund$/i });

describe("fund modal protocol-fee preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_EXPECTED_CHAIN_ID = "1";
    erc20UsdToHumanMock.mockResolvedValue("1.0");
    weiForUsdMock.mockResolvedValue(1_000000000000000000n);
    readLiveProtocolFeeMock.mockResolvedValue({ feeBps: 100n, recipient: "0x" + "1".repeat(40) });
    fundPoolEthMock.mockResolvedValue({ hash: "0x" + "a".repeat(64), wait: async () => ({}) });
    fundPoolErc20ExactMock.mockResolvedValue({ hash: "0x" + "b".repeat(64), wait: async () => ({}) });
  });
  afterEach(() => cleanup());

  it("shows amount, fee at the live rate, and what the pool receives for a V2 pool", async () => {
    buildFundingPreviewMock.mockResolvedValue({
      kind: "split",
      version: "v2",
      symbol: "ETH",
      decimals: 18,
      split: {
        grossAmount: 1_000000000000000000n,
        feeAmount: 10_000000000000000n,
        netAmount: 990_000000000000000n,
        feeBps: 100n,
      },
    });
    await openReviewStep();
    await waitFor(() => expect(document.body.textContent).toMatch(/Protocol fee \(1%\)/i));
    const text = (document.body.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toMatch(/Funding amount/i);
    expect(text).toMatch(/Pool receives/i);
    // Token-native amounts, floor arithmetic, gross unchanged: 1 = 0.01 + 0.99.
    expect(text).toMatch(/Funding amount ?1 ETH/i);
    expect(text).toMatch(/0\.01 ETH/);
    expect(text).toMatch(/0\.99 ETH/);
    // The fee comes out of the contribution; it is never presented as an addition.
    expect(screen.getByText(/not added on top/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/1\.01 ETH/);
  });

  it("reflects a different on-chain rate with no code change", async () => {
    buildFundingPreviewMock.mockResolvedValue({
      kind: "split",
      version: "v2",
      symbol: "ETH",
      decimals: 18,
      split: {
        grossAmount: 1_000000000000000000n,
        feeAmount: 7_500000000000000n,
        netAmount: 992_500000000000000n,
        feeBps: 75n,
      },
    });
    await openReviewStep();
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Protocol fee \(0\.75%\)/i),
    );
    const text = (document.body.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toMatch(/0\.0075 ETH/);
    expect(text).toMatch(/0\.9925 ETH/);
  });

  it("shows a 0% rate honestly rather than hiding the row", async () => {
    buildFundingPreviewMock.mockResolvedValue({
      kind: "split",
      version: "v2",
      symbol: "ETH",
      decimals: 18,
      split: {
        grossAmount: 1_000000000000000000n,
        feeAmount: 0n,
        netAmount: 1_000000000000000000n,
        feeBps: 0n,
      },
    });
    await openReviewStep();
    await waitFor(() => expect(document.body.textContent).toMatch(/Protocol fee \(0%\)/i));
  });

  it("shows no protocol fee anywhere for a legacy V1 pool", async () => {
    buildFundingPreviewMock.mockResolvedValue({ kind: "no-fee", version: "v1" });
    await openReviewStep();
    await waitFor(() => expect(buildFundingPreviewMock).toHaveBeenCalled());
    expect(document.body.textContent).not.toMatch(/protocol fee/i);
    expect(screen.queryByText(/pool receives/i)).not.toBeInTheDocument();
  });

  it("says the rate could not be read instead of implying no fee", async () => {
    buildFundingPreviewMock.mockResolvedValue({
      kind: "unavailable",
      message: "Could not read this pool's current protocol fee from the network.",
    });
    await openReviewStep();
    expect(await screen.findByText(/could not read this pool/i)).toBeInTheDocument();
    // No fabricated numbers, and funding is refused rather than allowed under a generic warning.
    expect(screen.queryByText(/pool receives/i)).not.toBeInTheDocument();
    expect(document.body.textContent).toMatch(/funding is blocked/i);
    expect(fundButton()).toBeDisabled();
  });

  it("previews the exact amount the transaction will send", async () => {
    buildFundingPreviewMock.mockResolvedValue({ kind: "no-fee", version: "v1" });
    await openReviewStep("250");
    await waitFor(() => expect(buildFundingPreviewMock).toHaveBeenCalled());
    const arg = buildFundingPreviewMock.mock.calls[0][0];
    expect(arg.poolAddress.toLowerCase()).toBe(POOL.toLowerCase());
    expect(typeof arg.grossAmount).toBe("bigint");
    expect(arg.grossAmount > 0n).toBe(true);
  });

  it("cannot submit while the fee preview is still loading", async () => {
    let release: (v: unknown) => void = () => {};
    buildFundingPreviewMock.mockImplementation(
      () => new Promise((r) => { release = r; }),
    );
    await openReviewStep();
    // Preview outstanding: the button is disabled and no wallet call can happen.
    await waitFor(() => expect(fundButton()).toBeDisabled());
    fireEvent.click(fundButton());
    expect(fundPoolEthMock).not.toHaveBeenCalled();
    release(splitAt(100n, 10_000000000000000n, 990_000000000000000n));
    await waitFor(() => expect(fundButton()).toBeEnabled());
  });

  it("blocks V2 funding when the fee read is unavailable, and offers Retry", async () => {
    buildFundingPreviewMock.mockResolvedValue({
      kind: "unavailable",
      message: "Could not read this pool's current protocol fee from the network.",
    });
    await openReviewStep();
    await waitFor(() => expect(fundButton()).toBeDisabled());
    fireEvent.click(fundButton());
    expect(fundPoolEthMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(document.body.textContent).toMatch(/funding is blocked/i);
  });

  it("recovers through Retry after a failed read", async () => {
    buildFundingPreviewMock.mockResolvedValueOnce({
      kind: "unavailable",
      message: "Could not read this pool's current protocol fee from the network.",
    });
    await openReviewStep();
    await waitFor(() => expect(fundButton()).toBeDisabled());
    buildFundingPreviewMock.mockResolvedValue(
      splitAt(100n, 10_000000000000000n, 990_000000000000000n),
    );
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(fundButton()).toBeEnabled());
    expect(document.body.textContent).toMatch(/Protocol fee \(1%\)/i);
  });

  it("lets a V1 pool fund with no fee resolution required", async () => {
    buildFundingPreviewMock.mockResolvedValue({ kind: "no-fee", version: "v1" });
    await openReviewStep();
    await waitFor(() => expect(fundButton()).toBeEnabled());
    fireEvent.click(fundButton());
    await waitFor(() => expect(fundPoolEthMock).toHaveBeenCalledTimes(1));
    // A V1 pool has no ProtocolConfig to re-read before signing.
    expect(readLiveProtocolFeeMock).not.toHaveBeenCalled();
  });

  it("funds a V2 pool once the live rate is read and still matches at submit", async () => {
    buildFundingPreviewMock.mockResolvedValue(
      splitAt(100n, 10_000000000000000n, 990_000000000000000n),
    );
    await openReviewStep();
    await waitFor(() => expect(fundButton()).toBeEnabled());
    fireEvent.click(fundButton());
    await waitFor(() => expect(fundPoolEthMock).toHaveBeenCalledTimes(1));
    expect(readLiveProtocolFeeMock).toHaveBeenCalled();
  });

  it("refuses to open the wallet when the rate changed between preview and submit", async () => {
    buildFundingPreviewMock.mockResolvedValue(
      splitAt(100n, 10_000000000000000n, 990_000000000000000n),
    );
    await openReviewStep();
    await waitFor(() => expect(fundButton()).toBeEnabled());
    // Admin moved the rate to 0.75% after the preview was rendered.
    readLiveProtocolFeeMock.mockResolvedValue({ feeBps: 75n, recipient: "0x" + "1".repeat(40) });
    buildFundingPreviewMock.mockResolvedValue(
      splitAt(75n, 7_500000000000000n, 992_500000000000000n),
    );
    fireEvent.click(fundButton());
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/protocol fee changed/i),
    );
    expect(fundPoolEthMock).not.toHaveBeenCalled();
    // The refreshed economics are on screen; a second, deliberate press now goes through.
    await waitFor(() => expect(document.body.textContent).toMatch(/Protocol fee \(0\.75%\)/i));
    fireEvent.click(fundButton());
    await waitFor(() => expect(fundPoolEthMock).toHaveBeenCalledTimes(1));
  });

  it("blocks submission when the pre-signature re-read itself fails", async () => {
    buildFundingPreviewMock.mockResolvedValue(
      splitAt(100n, 10_000000000000000n, 990_000000000000000n),
    );
    await openReviewStep();
    await waitFor(() => expect(fundButton()).toBeEnabled());
    readLiveProtocolFeeMock.mockRejectedValue(new Error("rpc down"));
    fireEvent.click(fundButton());
    await waitFor(() => expect(document.body.textContent).toMatch(/could not re-check/i));
    expect(fundPoolEthMock).not.toHaveBeenCalled();
    await waitFor(() => expect(fundButton()).toBeDisabled());
  });

  it("never presents the fee as a surcharge on top of the amount funded", async () => {
    buildFundingPreviewMock.mockResolvedValue(
      splitAt(100n, 10_000000000000000n, 990_000000000000000n),
    );
    await openReviewStep();
    await waitFor(() => expect(document.body.textContent).toMatch(/Protocol fee \(1%\)/i));
    const text = (document.body.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toMatch(/not added on top/i);
    expect(text).not.toMatch(/1\.01 ETH/);
    expect(text).toMatch(/can never exceed the contract.s 3% maximum/i);
  });
});

/**
 * ERC-20 amount lifecycle (production hotfix, 2026-09-07).
 *
 * One deliberate contribution establishes one canonical raw gross. The reviewed bigint is the one
 * approved against and the one funded — the old flow re-derived it after approval, and a fresh
 * Chainlink round made it larger than the spending cap the user had just set, so PAX Gold
 * reverted with InsufficientAllowance().
 */
describe("ERC-20 funding uses exactly the reviewed amount", () => {
  const REVIEWED_GROSS = 2_259_000_000_000n; // 0.000002259 PAXG, the production amount
  const PAXG = "0x45804880De22913dAFE09f4980848ECE6EcbAf78";

  const paxgSplit = () => ({
    kind: "split" as const,
    version: "v2" as const,
    symbol: "PAXG",
    decimals: 18,
    tokenAddress: PAXG,
    split: {
      grossAmount: REVIEWED_GROSS,
      feeAmount: REVIEWED_GROSS / 100n,
      netAmount: REVIEWED_GROSS - REVIEWED_GROSS / 100n,
      feeBps: 100n,
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_EXPECTED_CHAIN_ID = "1";
    erc20UsdToHumanMock.mockResolvedValue("0.000002259");
    weiForUsdMock.mockResolvedValue(1_000000000000000000n);
    readLiveProtocolFeeMock.mockResolvedValue({ feeBps: 100n, recipient: "0x" + "1".repeat(40) });
    fundPoolErc20ExactMock.mockResolvedValue({ hash: "0x" + "b".repeat(64), wait: async () => ({}) });
    buildFundingPreviewMock.mockResolvedValue(paxgSplit());
  });
  afterEach(() => cleanup());

  async function reviewPaxg() {
    render(<FundPoolModal open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/pool contract address/i), { target: { value: POOL } });
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    fireEvent.click(await screen.findByRole("button", { name: "PAXG" }));
    fireEvent.change(await screen.findByLabelText(/amount/i), { target: { value: "0.01" } });
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /^fund$/i })).toBeEnabled());
  }

  it("funds the exact raw amount that was reviewed", async () => {
    await reviewPaxg();
    fireEvent.click(screen.getByRole("button", { name: /^fund$/i }));
    await waitFor(() => expect(fundPoolErc20ExactMock).toHaveBeenCalledTimes(1));
    const [, poolArg, tokenArg, amountArg] = fundPoolErc20ExactMock.mock.calls[0];
    expect(poolArg.toLowerCase()).toBe(POOL.toLowerCase());
    expect(tokenArg.toLowerCase()).toBe(PAXG.toLowerCase());
    expect(amountArg).toBe(REVIEWED_GROSS);
  });

  it("does not re-derive the amount from USD after review, even if the price moved", async () => {
    await reviewPaxg();
    // A later conversion would now yield more tokens for the same dollars.
    erc20UsdToHumanMock.mockResolvedValue("0.0000022590062914");
    fireEvent.click(screen.getByRole("button", { name: /^fund$/i }));
    await waitFor(() => expect(fundPoolErc20ExactMock).toHaveBeenCalled());
    expect(fundPoolErc20ExactMock.mock.calls[0][3]).toBe(REVIEWED_GROSS);
  });

  it("keeps fee + net equal to the reviewed gross, with no surcharge", async () => {
    await reviewPaxg();
    const s = paxgSplit().split;
    expect(s.feeAmount + s.netAmount).toBe(REVIEWED_GROSS);
    expect(s.feeAmount).toBe(22_590_000_000n);
    const text = (document.body.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toMatch(/0\.000002259 PAXG/);
    expect(text).toMatch(/0\.00000002259 PAXG/);
    expect(text).toMatch(/0\.00000223641 PAXG/);
  });

  it("explains an insufficient spending cap instead of dumping the provider error", async () => {
    await reviewPaxg();
    fundPoolErc20ExactMock.mockRejectedValue(
      new AllowanceBelowAmountError(REVIEWED_GROSS, REVIEWED_GROSS + 6_291_456n),
    );
    fireEvent.click(screen.getByRole("button", { name: /^fund$/i }));
    await waitFor(() => expect(document.body.textContent).toMatch(/approved spending cap/i));
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/no funding transaction was sent/i);
    expect(text).not.toMatch(/CALL_EXCEPTION|estimateGas|0x13be252b|transaction=\{/);
  });

  it("never renders a raw ethers CALL_EXCEPTION", async () => {
    await reviewPaxg();
    const raw = Object.assign(
      new Error(
        'execution reverted (unknown custom error) (action="estimateGas", data="0x13be252b", ' +
          'transaction={ "data": "0x59e1397a0000", "from": "0xB80f", "to": "0xBbE3" }, code=CALL_EXCEPTION)',
      ),
      { data: "0x13be252b", code: "CALL_EXCEPTION" },
    );
    fundPoolErc20ExactMock.mockRejectedValue(raw);
    fireEvent.click(screen.getByRole("button", { name: /^fund$/i }));
    await waitFor(() => expect(document.body.textContent).toMatch(/spending cap/i));
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/CALL_EXCEPTION/);
    expect(text).not.toMatch(/estimateGas/);
    expect(text).not.toMatch(/0x59e1397a/);
  });

  it("handles a cancelled wallet prompt cleanly", async () => {
    await reviewPaxg();
    fundPoolErc20ExactMock.mockRejectedValue(
      Object.assign(new Error("user rejected action"), { code: "ACTION_REJECTED" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^fund$/i }));
    await waitFor(() => expect(document.body.textContent).toMatch(/you cancelled/i));
    expect(document.body.textContent).toMatch(/nothing was sent/i);
  });

  it("explains an insufficient token balance", async () => {
    await reviewPaxg();
    fundPoolErc20ExactMock.mockRejectedValue(Object.assign(new Error("reverted"), { data: "0xe450d38c" }));
    fireEvent.click(screen.getByRole("button", { name: /^fund$/i }));
    await waitFor(() => expect(document.body.textContent).toMatch(/does not hold enough PAXG/i));
  });

  it("explains a below-minimum revert as a price move, not a failure to retry blindly", async () => {
    await reviewPaxg();
    fundPoolErc20ExactMock.mockRejectedValue(Object.assign(new Error("reverted"), { data: "0x4a72670c" }));
    fireEvent.click(screen.getByRole("button", { name: /^fund$/i }));
    await waitFor(() => expect(document.body.textContent).toMatch(/below the pool.s minimum/i));
    expect(document.body.textContent).toMatch(/review a fresh amount/i);
  });

});

/**
 * End-to-end stage reporting in the modal.
 *
 * The modal no longer guesses which prompt failed; the error carries its own stage. A rejected
 * funding prompt throws before any transaction hash exists, which the old `lastTxHash` inference
 * misread as a cancelled approval.
 */
describe("fund modal reports the wallet stage that actually failed", () => {
  const REVIEWED_GROSS = 2_259_000_000_000n;
  const PAXG = "0x45804880De22913dAFE09f4980848ECE6EcbAf78";
  const rejection = () => Object.assign(new Error("user rejected action"), { code: "ACTION_REJECTED" });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_EXPECTED_CHAIN_ID = "1";
    erc20UsdToHumanMock.mockResolvedValue("0.000002259");
    weiForUsdMock.mockResolvedValue(1_000000000000000000n);
    readLiveProtocolFeeMock.mockResolvedValue({ feeBps: 100n, recipient: "0x" + "1".repeat(40) });
    buildFundingPreviewMock.mockResolvedValue({
      kind: "split",
      version: "v2",
      symbol: "PAXG",
      decimals: 18,
      tokenAddress: PAXG,
      split: {
        grossAmount: REVIEWED_GROSS,
        feeAmount: REVIEWED_GROSS / 100n,
        netAmount: REVIEWED_GROSS - REVIEWED_GROSS / 100n,
        feeBps: 100n,
      },
    });
  });
  afterEach(() => cleanup());

  async function reviewThenFund() {
    render(<FundPoolModal open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/pool contract address/i), { target: { value: POOL } });
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    fireEvent.click(await screen.findByRole("button", { name: "PAXG" }));
    fireEvent.change(await screen.findByLabelText(/amount/i), { target: { value: "0.01" } });
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /^fund$/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /^fund$/i }));
  }

  it("says the APPROVAL was cancelled when the approval prompt is rejected", async () => {
    fundPoolErc20ExactMock.mockRejectedValue(new FundingStageError("approval", rejection()));
    await reviewThenFund();
    await waitFor(() => expect(document.body.textContent).toMatch(/cancelled the approval/i));
    expect(document.body.textContent).not.toMatch(/cancelled the funding transaction/i);
  });

  it("says the FUNDING was cancelled when the funding prompt is rejected after approval", async () => {
    // No transaction hash exists at this point — the exact case the old inference got wrong.
    fundPoolErc20ExactMock.mockRejectedValue(new FundingStageError("funding", rejection()));
    await reviewThenFund();
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/cancelled the funding transaction/i),
    );
    expect(document.body.textContent).not.toMatch(/cancelled the approval/i);
  });

  it("labels an unknown approval failure as an approval failure", async () => {
    fundPoolErc20ExactMock.mockRejectedValue(new FundingStageError("approval", new Error("boom")));
    await reviewThenFund();
    await waitFor(() => expect(document.body.textContent).toMatch(/approval transaction failed/i));
  });

  it("labels an unknown funding failure as a funding failure", async () => {
    fundPoolErc20ExactMock.mockRejectedValue(new FundingStageError("funding", new Error("boom")));
    await reviewThenFund();
    await waitFor(() => expect(document.body.textContent).toMatch(/funding transaction failed/i));
    // The step-2 copy legitimately mentions approvals; only the error label must not.
    expect(document.body.textContent).not.toMatch(/approval transaction failed/i);
  });

  it("still classifies by selector when the revert is wrapped in a stage", async () => {
    fundPoolErc20ExactMock.mockRejectedValue(
      new FundingStageError("funding", Object.assign(new Error("reverted"), { data: "0x13be252b" })),
    );
    await reviewThenFund();
    await waitFor(() => expect(document.body.textContent).toMatch(/spending cap you approved/i));
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/CALL_EXCEPTION|estimateGas|0x13be252b|transaction=\{/);
  });
});

/**
 * Exact spending cap (production hotfix, 2026-09-07).
 *
 * The review shortened the gross to 0.00000227085 PAXG; the user copied that into MetaMask's
 * Edit spending cap, and the canonical gross was actually 0.000002270857687598. The PR #13 check
 * correctly blocked funding — but the message shortened both sides to the same string, so it read
 * as "0.00000227085 is below 0.00000227085". The review now publishes the exact value to copy,
 * and the error compares at full precision.
 */
describe("exact spending cap for ERC-20 funding", () => {
  const CANONICAL_GROSS = 2_270_857_687_598n; // 0.000002270857687598 PAXG
  const APPROVED = 2_270_850_000_000n; // what the shortened display led the user to approve
  const EXACT_STRING = "0.000002270857687598";
  const PAXG = "0x45804880De22913dAFE09f4980848ECE6EcbAf78";
  const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());

  const paxgSplit = () => ({
    kind: "split" as const,
    version: "v2" as const,
    symbol: "PAXG",
    decimals: 18,
    tokenAddress: PAXG,
    split: {
      grossAmount: CANONICAL_GROSS,
      feeAmount: CANONICAL_GROSS / 100n,
      netAmount: CANONICAL_GROSS - CANONICAL_GROSS / 100n,
      feeBps: 100n,
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_EXPECTED_CHAIN_ID = "1";
    walletState.signer = fakeSigner;
    erc20UsdToHumanMock.mockResolvedValue("0.000002270857687598");
    weiForUsdMock.mockResolvedValue(1_000000000000000000n);
    readLiveProtocolFeeMock.mockResolvedValue({ feeBps: 100n, recipient: "0x" + "1".repeat(40) });
    fundPoolErc20ExactMock.mockResolvedValue({ hash: "0x" + "b".repeat(64), wait: async () => ({}) });
    buildFundingPreviewMock.mockResolvedValue(paxgSplit());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
  });
  afterEach(() => cleanup());

  async function reviewPaxg() {
    render(<FundPoolModal open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/pool contract address/i), { target: { value: POOL } });
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    fireEvent.click(await screen.findByRole("button", { name: "PAXG" }));
    fireEvent.change(await screen.findByLabelText(/amount/i), { target: { value: "0.01" } });
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /^fund$/i })).toBeEnabled());
  }

  it("keeps the readable rows readable while publishing the exact cap", async () => {
    await reviewPaxg();
    const text = (document.body.textContent ?? "").replace(/\s+/g, " ");
    // Readable rows are unchanged.
    expect(text).toMatch(/Funding amount ?0\.00000227085 PAXG/);
    expect(text).toMatch(/Pool receives/);
    // And the full-precision value is available to copy.
    expect(text).toMatch(/Exact spending cap/);
    expect(text).toContain(EXACT_STRING);
  });

  it("derives the exact cap from the canonical gross, with no fee added", async () => {
    await reviewPaxg();
    expect(parseUnits(EXACT_STRING, 18)).toBe(CANONICAL_GROSS);
    const text = document.body.textContent ?? "";
    // The cap is the gross, never gross + fee.
    const grossPlusFee = formatTokenAmountExact(CANONICAL_GROSS + CANONICAL_GROSS / 100n, 18);
    expect(text).not.toContain(grossPlusFee);
  });

  it("copies the bare numeric value, pasteable into a wallet", async () => {
    await reviewPaxg();
    fireEvent.click(screen.getByRole("button", { name: /^copy$/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0][0];
    expect(copied).toBe(EXACT_STRING);
    expect(copied).not.toMatch(/PAXG|,|\s/);
    // Round-trips to exactly the amount the transaction will use.
    expect(parseUnits(copied, 18)).toBe(CANONICAL_GROSS);
    await waitFor(() => expect(screen.getByRole("button", { name: /copied/i })).toBeInTheDocument());
  });

  it("explains a short cap with two visibly different exact amounts", async () => {
    await reviewPaxg();
    fundPoolErc20ExactMock.mockRejectedValue(
      new AllowanceBelowAmountError(APPROVED, CANONICAL_GROSS),
    );
    fireEvent.click(screen.getByRole("button", { name: /^fund$/i }));
    await waitFor(() => expect(document.body.textContent).toMatch(/approved spending cap/i));
    const text = (document.body.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toContain("0.00000227085 PAXG");
    expect(text).toContain("0.000002270857687598 PAXG");
    // The production message rendered both sides identically; that must be impossible now.
    expect(formatTokenAmountExact(APPROVED, 18)).not.toBe(formatTokenAmountExact(CANONICAL_GROSS, 18));
    expect(text).toMatch(/no funding transaction was sent/i);
    expect(text).not.toMatch(/CALL_EXCEPTION|estimateGas|transaction=\{/);
  });

  it("funds when the approved cap equals the canonical gross exactly", async () => {
    await reviewPaxg();
    fireEvent.click(screen.getByRole("button", { name: /^fund$/i }));
    await waitFor(() => expect(fundPoolErc20ExactMock).toHaveBeenCalledTimes(1));
    expect(fundPoolErc20ExactMock.mock.calls[0][3]).toBe(CANONICAL_GROSS);
  });

  it("shows no exact-cap block for native ETH, which needs no approval", async () => {
    buildFundingPreviewMock.mockResolvedValue({
      kind: "split",
      version: "v2",
      symbol: "ETH",
      decimals: 18,
      split: {
        grossAmount: 1_000000000000000000n,
        feeAmount: 10_000000000000000n,
        netAmount: 990_000000000000000n,
        feeBps: 100n,
      },
    });
    render(<FundPoolModal open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/pool contract address/i), { target: { value: POOL } });
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    fireEvent.change(await screen.findByLabelText(/amount/i), { target: { value: "0.01" } });
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    await waitFor(() => expect(document.body.textContent).toMatch(/Protocol fee \(1%\)/i));
    expect(document.body.textContent).not.toMatch(/exact spending cap/i);
  });
});

/** Disconnected-wallet parity with the Deploy flow. */
describe("fund review with no wallet connected", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_EXPECTED_CHAIN_ID = "1";
    erc20UsdToHumanMock.mockResolvedValue("1.0");
    weiForUsdMock.mockResolvedValue(1_000000000000000000n);
    buildFundingPreviewMock.mockResolvedValue({
      kind: "split",
      version: "v2",
      symbol: "ETH",
      decimals: 18,
      split: {
        grossAmount: 1_000000000000000000n,
        feeAmount: 10_000000000000000n,
        netAmount: 990_000000000000000n,
        feeBps: 100n,
      },
    });
  });
  afterEach(() => {
    cleanup();
    walletState.signer = fakeSigner;
  });

  async function reviewWithoutWallet() {
    walletState.signer = null;
    const utils = render(<FundPoolModal open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/pool contract address/i), { target: { value: POOL } });
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    fireEvent.change(await screen.findByLabelText(/amount/i), { target: { value: "12.34" } });
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    await waitFor(() => expect(document.body.textContent).toMatch(/connect your wallet/i));
    return utils;
  }

  it("offers an actionable Connect wallet button", async () => {
    await reviewWithoutWallet();
    expect(document.body.textContent).toMatch(/connect your wallet to review and fund this pool/i);
    expect(screen.getByRole("button", { name: /^connect wallet$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^fund$/i })).toBeDisabled();
    expect(connectWalletMock).not.toHaveBeenCalled();
  });

  it("a disabled Fund button cannot be clicked or hovered into looking active", async () => {
    await reviewWithoutWallet();
    const fund = screen.getByRole("button", { name: /^fund$/i });
    expect(fund.className).toContain("disabled:pointer-events-none");
    fireEvent.click(fund);
    expect(fundPoolEthMock).not.toHaveBeenCalled();
  });

  it("opens the wallet picker without closing Fund or losing what was entered", async () => {
    await reviewWithoutWallet();
    fireEvent.click(screen.getByRole("button", { name: /^connect wallet$/i }));
    const picker = await screen.findByRole("dialog", { name: /choose a wallet/i });
    expect(picker.className).toContain("z-[100]");
    fireEvent.click(screen.getByRole("button", { name: /metamask/i }));
    await waitFor(() => expect(connectWalletMock).toHaveBeenCalledWith("metamask"));
    expect(document.body.textContent).toMatch(/Review your funding/i);
    expect(document.body.textContent).toContain(POOL);
    expect(document.body.textContent).toContain("12.34");
  });

  it("cancelling the picker keeps the Fund form intact", async () => {
    await reviewWithoutWallet();
    fireEvent.click(screen.getByRole("button", { name: /^connect wallet$/i }));
    await screen.findByRole("dialog", { name: /choose a wallet/i });
    fireEvent.click(screen.getByRole("button", { name: /close wallet picker/i }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /choose a wallet/i })).not.toBeInTheDocument(),
    );
    expect(document.body.textContent).toContain("12.34");
    expect(screen.getByRole("button", { name: /^fund$/i })).toBeDisabled();
  });

  it("resolves the preview in place once a wallet connects", async () => {
    const { rerender } = await reviewWithoutWallet();
    walletState.signer = fakeSigner;
    rerender(<FundPoolModal open onClose={() => {}} />);
    await waitFor(() => expect(document.body.textContent).toMatch(/Protocol fee \(1%\)/i));
    expect(screen.getByRole("button", { name: /^fund$/i })).toBeEnabled();
    expect(document.body.textContent).not.toMatch(/connect your wallet/i);
  });
});
