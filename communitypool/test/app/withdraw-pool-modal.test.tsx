/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const shared = vi.hoisted(() => {
  const poolState = {
    ethBalance: 40_000_000_000_000_000n, // 0.04 ETH
    tokenBalance: 4_000_000n, // 0.04 with 8 decimals
    tokenDecimals: 8,
    isOwnerResult: true,
    // Runtime-code hex. `true` (new pool) contains both partial selectors;
    // `false` (legacy) returns only the full-balance selectors.
    partialSupport: true,
  };
  const provider = {
    getBlock: vi.fn(async () => ({ timestamp: Math.floor(Date.now() / 1000) })),
    getBalance: vi.fn(async () => poolState.ethBalance),
    getCode: vi.fn(async () =>
      poolState.partialSupport
        ? "0x60806040526004361061010c575f3560e01c80632e1a7d4d14b354a5b714be2693f0"
        : "0x60806040526004361061010c575f3560e01c8089476069be2693f0",
    ),
  };
  const walletAddress = "0x1111111111111111111111111111111111111111";
  return {
    poolState,
    provider,
    // The withdraw modal now reads the connected address via
    // `signer.getAddress()` to attach a wallet_address tag to the
    // pool.withdraw.* security events. Stub it on the mock signer.
    signer: {
      provider,
      getAddress: vi.fn(async () => walletAddress),
    } as unknown as import("ethers").JsonRpcSigner,
    walletAddress,
    withdrawPoolEthMock: vi.fn(),
    withdrawPoolEthAmountMock: vi.fn(),
    withdrawPoolTokenMock: vi.fn(),
    withdrawPoolTokenAmountMock: vi.fn(),
    releaseExpiredFundsToDeployerMock: vi.fn(),
    weiForUsdContributionMock: vi.fn(async (_s: unknown, _f: unknown, usd: string) => {
      // 1 ETH = $2000 for test purposes → 1 USD = 0.0005 ETH = 5e14 wei.
      const n = Number(usd);
      return BigInt(Math.round(n * 5e14));
    }),
    erc20UsdToHumanAmountStringMock: vi.fn(async (_s: unknown, preset: { decimals: number }, usd: string) => {
      // 1 WBTC = $50000 → 1 USD = 0.00002 WBTC.
      const n = Number(usd);
      const human = (n * 0.00002).toFixed(preset.decimals);
      return human;
    }),
  };
});

const { poolState, provider, withdrawPoolEthMock, withdrawPoolEthAmountMock, withdrawPoolTokenMock, withdrawPoolTokenAmountMock, releaseExpiredFundsToDeployerMock } = shared;

vi.mock("@/components/wallet-provider", () => ({
  useWallet: () => ({
    provider: shared.provider,
    signer: shared.signer,
    walletAddress: shared.walletAddress,
    isConnected: true,
    chainId: 1n,
    isWrongNetwork: false,
    switchToExpectedNetwork: vi.fn(),
  }),
}));

vi.mock("@/lib/onchain/community-pool", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/onchain/community-pool")
  >("@/lib/onchain/community-pool");
  return {
    ...actual,
    withdrawPoolEth: shared.withdrawPoolEthMock,
    withdrawPoolEthAmount: shared.withdrawPoolEthAmountMock,
    withdrawPoolToken: shared.withdrawPoolTokenMock,
    withdrawPoolTokenAmount: shared.withdrawPoolTokenAmountMock,
    releaseExpiredFundsToDeployer: shared.releaseExpiredFundsToDeployerMock,
  };
});

vi.mock("@/lib/onchain/price-math", () => ({
  weiForUsdContribution: shared.weiForUsdContributionMock,
}));

vi.mock("@/lib/onchain/tx-economics", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/onchain/tx-economics")>(
      "@/lib/onchain/tx-economics",
    );
  return {
    ...actual,
    erc20UsdToHumanAmountString: shared.erc20UsdToHumanAmountStringMock,
  };
});

vi.mock("ethers", async () => {
  const actual = await vi.importActual<typeof import("ethers")>("ethers");
  class MockContract {
    expiresAt = vi.fn(async () => BigInt(Math.floor(Date.now() / 1000) + 3600));
    getOwner = vi.fn(async () => "0x1111111111111111111111111111111111111111");
    isOwner = vi.fn(async () => poolState.isOwnerResult);
    balanceOf = vi.fn(async () => poolState.tokenBalance);
    decimals = vi.fn(async () => poolState.tokenDecimals);
    symbol = vi.fn(async () => "WBTC");
  }
  return {
    ...actual,
    Contract: MockContract,
  };
});

import { parseEther } from "ethers";
import WithdrawPoolModal from "@/app/(app)/pools/withdraw-pool-modal";

function buildTx(hashSuffix: string) {
  return {
    hash: `0x${hashSuffix.repeat(64).slice(0, 64)}`,
    wait: vi.fn(async () => ({})),
  };
}

async function openToStep3() {
  render(
    <WithdrawPoolModal
      open
      onClose={vi.fn()}
      initialPool={{
        name: "Test Pool",
        address: "0x1234567890123456789012345678901234567890",
      }}
    />,
  );
  // `initialPool` triggers auto-advance from the verify step once ownership
  // succeeds; just wait for step 3's title to appear.
  await screen.findByText(/What would you like to withdraw\?/i);
}

describe("WithdrawPoolModal amount handling", () => {
  beforeEach(() => {
    withdrawPoolEthMock.mockReset();
    withdrawPoolEthAmountMock.mockReset();
    withdrawPoolTokenMock.mockReset();
    withdrawPoolTokenAmountMock.mockReset();
    releaseExpiredFundsToDeployerMock.mockReset();
    provider.getBalance.mockClear();
    provider.getCode.mockClear();
    shared.walletAddress = "0x1111111111111111111111111111111111111111";
    poolState.ethBalance = parseEther("0.04");
    poolState.tokenBalance = 4_000_000n;
    poolState.tokenDecimals = 8;
    poolState.isOwnerResult = true;
    poolState.partialSupport = true;
    withdrawPoolEthMock.mockResolvedValue(buildTx("c"));
    withdrawPoolEthAmountMock.mockResolvedValue(buildTx("a"));
    withdrawPoolTokenMock.mockResolvedValue(buildTx("d"));
    withdrawPoolTokenAmountMock.mockResolvedValue(buildTx("b"));
  });

  afterEach(() => {
    cleanup();
  });

  it("converts USD input to wei at submit and calls withdraw(uint256) on new pools", async () => {
    await openToStep3();
    fireEvent.change(screen.getByLabelText(/ETH amount to withdraw \(USD\)/i), {
      target: { value: "40" },
    });

    await waitFor(() =>
      expect(screen.getByText(/≈ 0\.02 ETH at current price/i)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    await screen.findByText(/Review your withdrawal/i);
    fireEvent.click(screen.getByRole("button", { name: /^Withdraw$/i }));

    await waitFor(() => expect(withdrawPoolEthAmountMock).toHaveBeenCalledTimes(1));
    // 40 USD * 5e14 wei/USD = 2e16 wei = 0.02 ETH
    expect(withdrawPoolEthAmountMock.mock.calls[0][2]).toBe(20_000_000_000_000_000n);
    expect(withdrawPoolEthMock).not.toHaveBeenCalled();
  });

  it("Max button routes to cheaperWithdraw() and skips amount conversion", async () => {
    await openToStep3();
    fireEvent.click(screen.getByRole("button", { name: /^Max$/i }));

    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    await screen.findByText(/Review your withdrawal/i);
    fireEvent.click(screen.getByRole("button", { name: /^Withdraw$/i }));

    await waitFor(() => expect(withdrawPoolEthMock).toHaveBeenCalledTimes(1));
    expect(withdrawPoolEthAmountMock).not.toHaveBeenCalled();
  });

  it("legacy pool (no partial selectors) routes ETH to cheaperWithdraw with no amount input", async () => {
    poolState.partialSupport = false;
    await openToStep3();

    expect(
      screen.getByText(/This pool only supports full withdrawals\./i),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/ETH amount to withdraw \(USD\)/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    await screen.findByText(/Review your withdrawal/i);
    fireEvent.click(screen.getByRole("button", { name: /^Withdraw$/i }));

    await waitFor(() => expect(withdrawPoolEthMock).toHaveBeenCalledTimes(1));
    expect(withdrawPoolEthAmountMock).not.toHaveBeenCalled();
  });

  it("legacy pool routes ERC20 to withdrawToken(address) with no amount input", async () => {
    poolState.partialSupport = false;
    await openToStep3();
    fireEvent.click(screen.getByRole("button", { name: /^ERC20 only$/i }));

    await waitFor(() =>
      expect(screen.getByText(/Pool WBTC balance:/i)).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText(/WBTC amount to withdraw \(USD\)/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    await screen.findByText(/Review your withdrawal/i);
    fireEvent.click(screen.getByRole("button", { name: /^Withdraw$/i }));

    await waitFor(() => expect(withdrawPoolTokenMock).toHaveBeenCalledTimes(1));
    expect(withdrawPoolTokenAmountMock).not.toHaveBeenCalled();
  });

  it("allows an additional on-chain owner to proceed to withdraw", async () => {
    shared.walletAddress = "0x2222222222222222222222222222222222222222";
    poolState.isOwnerResult = true;
    await openToStep3();
    expect(screen.getByText(/What would you like to withdraw\?/i)).toBeInTheDocument();
  });

  it("rejects ETH withdraw USD amounts that convert to more than the pool balance", async () => {
    // 0.04 ETH pool / 5e14 wei per USD = $80 pool cap; $100 overflows.
    await openToStep3();
    fireEvent.change(screen.getByLabelText(/ETH amount to withdraw \(USD\)/i), {
      target: { value: "100" },
    });
    await waitFor(() =>
      expect(screen.getByText(/≈ 0\.05 ETH at current price/i)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    expect(
      screen.getByText(/Withdraw amount exceeds pool ETH balance\./i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Review your withdrawal/i)).not.toBeInTheDocument();
  });

  it("rejects zero / empty USD amounts", async () => {
    await openToStep3();
    fireEvent.change(screen.getByLabelText(/ETH amount to withdraw \(USD\)/i), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    expect(screen.getByText(/at least \$0\.01 USD/i)).toBeInTheDocument();
    expect(screen.queryByText(/Review your withdrawal/i)).not.toBeInTheDocument();
  });

  it("converts ERC20 USD input using the token Chainlink feed and calls withdrawTokenAmount", async () => {
    await openToStep3();
    fireEvent.click(screen.getByRole("button", { name: /^ERC20 only$/i }));
    await waitFor(() =>
      expect(screen.getByText(/Pool WBTC balance:/i)).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByLabelText(/WBTC amount to withdraw \(USD\)/i), {
      target: { value: "50" },
    });
    await waitFor(() =>
      expect(screen.getByText(/≈ 0\.001 WBTC at current price/i)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    await screen.findByText(/Review your withdrawal/i);
    fireEvent.click(screen.getByRole("button", { name: /^Withdraw$/i }));

    await waitFor(() => expect(withdrawPoolTokenAmountMock).toHaveBeenCalledTimes(1));
    // $50 * 0.00002 WBTC/USD = 0.001 WBTC * 10^8 = 100_000
    expect(withdrawPoolTokenAmountMock.mock.calls[0][3]).toBe(100_000n);
    expect(withdrawPoolTokenMock).not.toHaveBeenCalled();
  });

  it("blocks withdraw flow when connected wallet is not an on-chain owner", async () => {
    shared.walletAddress = "0x2222222222222222222222222222222222222222";
    poolState.isOwnerResult = false;
    render(
      <WithdrawPoolModal
        open
        onClose={vi.fn()}
        initialPool={{
          name: "Test Pool",
          address: "0x1234567890123456789012345678901234567890",
        }}
      />,
    );
    // The modal classifies the failure reason via `setVerificationFailureReason`;
    // a returning-false on-chain `isOwner(addr)` maps to "not_owner" which
    // renders this exact copy. The Continue button stays disabled while
    // verificationStatus !== "success" so the user can't advance to sign.
    await screen.findByText(/This wallet is not an owner of this pool/i);
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
  });
});
