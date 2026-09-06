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

const {
  buildFundingPreviewMock,
  erc20UsdToHumanMock,
  weiForUsdMock,
  readLiveProtocolFeeMock,
  fundPoolEthMock,
} = vi.hoisted(() => ({
  buildFundingPreviewMock: vi.fn(),
  erc20UsdToHumanMock: vi.fn(),
  weiForUsdMock: vi.fn(),
  readLiveProtocolFeeMock: vi.fn(),
  fundPoolEthMock: vi.fn(),
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
    fundPoolEth: fundPoolEthMock,
  };
});

vi.mock("@/lib/security/client-security-event", () => ({
  postClientSecurityEvent: async () => undefined,
}));

const fakeSigner = {
  getAddress: async () => "0x000000000000000000000000000000000000dEaD",
  provider: { getCode: async () => "0x60806040" },
};

vi.mock("@/components/wallet-provider", () => ({
  useWallet: () => ({
    walletAddress: "0x000000000000000000000000000000000000dEaD",
    isConnected: true,
    provider: null,
    signer: fakeSigner,
    chainId: BigInt(1),
    isWrongNetwork: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    switchToExpectedNetwork: vi.fn(),
  }),
}));

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
