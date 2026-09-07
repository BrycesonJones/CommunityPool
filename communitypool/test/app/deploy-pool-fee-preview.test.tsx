/**
 * Deploy modal — initial-contribution economics (Phase 2.8 hardening).
 *
 * The deploy flow creates the pool and then immediately funds it, with no second review in
 * between. So the fee split for that initial contribution has to be visible before the first
 * wallet prompt, and the flow must refuse to start while the live rate is unknown — otherwise a
 * transient RPC failure would deploy a pool and then ask the user to sign a funding transaction
 * whose economics nobody could state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

function tomorrowYmd(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const {
  deployCommunityPoolMock,
  fundPoolEthMock,
  readChainProtocolFeeBpsMock,
  weiForUsdMock,
  erc20UsdToHumanMock,
  erc20UsdToTokenMock,
  connectedSigner,
  connectWalletMock,
  walletState,
} = vi.hoisted(() => {
  const connectedSigner = {
    getAddress: async () => "0x000000000000000000000000000000000000dEaD",
    provider: {},
  };
  return {
    deployCommunityPoolMock: vi.fn(),
    fundPoolEthMock: vi.fn(),
    readChainProtocolFeeBpsMock: vi.fn(),
    weiForUsdMock: vi.fn(),
    erc20UsdToHumanMock: vi.fn(),
    erc20UsdToTokenMock: vi.fn(),
    connectedSigner,
    connectWalletMock: vi.fn(),
    /** Mutable so a test can simulate connecting or disconnecting between renders. */
    walletState: { signer: connectedSigner as unknown, isConnected: true },
  };
});

vi.mock("@/lib/onchain/community-pool", async () => {
  const actual = await vi.importActual<typeof import("@/lib/onchain/community-pool")>(
    "@/lib/onchain/community-pool",
  );
  return { ...actual, deployCommunityPool: deployCommunityPoolMock, fundPoolEth: fundPoolEthMock };
});

vi.mock("@/lib/onchain/protocol-fee", async () => {
  const actual = await vi.importActual<typeof import("@/lib/onchain/protocol-fee")>(
    "@/lib/onchain/protocol-fee",
  );
  return { ...actual, readChainProtocolFeeBps: readChainProtocolFeeBpsMock };
});

vi.mock("@/lib/onchain/price-math", async () => {
  const actual = await vi.importActual<typeof import("@/lib/onchain/price-math")>(
    "@/lib/onchain/price-math",
  );
  return { ...actual, weiForUsdContribution: weiForUsdMock };
});

vi.mock("@/lib/onchain/tx-economics", async () => {
  const actual = await vi.importActual<typeof import("@/lib/onchain/tx-economics")>(
    "@/lib/onchain/tx-economics",
  );
  return {
    ...actual,
    erc20UsdToHumanAmountString: erc20UsdToHumanMock,
    erc20UsdToTokenAmount: erc20UsdToTokenMock,
    deployFlowEthFundFeeInefficiencyMessage: async () => null,
    fundErc20FeeInefficiencyMessage: async () => null,
  };
});

vi.mock("@/lib/profile/kyc", () => ({
  fetchKycStatus: async () => ({ complete: true, profile: null }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u", email: "u@example.com" } } }) },
  }),
}));

vi.mock("@/lib/security/client-security-event", () => ({
  postClientSecurityEvent: async () => undefined,
}));

vi.mock("@/components/wallet-provider", () => ({
  useWallet: () => ({
    walletAddress: "0x000000000000000000000000000000000000dEaD",
    provider: null,
    get signer() {
      return walletState.signer;
    },
    get isConnected() {
      return walletState.isConnected;
    },
    chainId: BigInt(1),
    isWrongNetwork: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    switchToExpectedNetwork: vi.fn(),
    // Consumed by the real WalletPicker, which this modal renders.
    connectors: [
      { id: "metamask", name: "MetaMask" },
      { id: "coinbase", name: "Coinbase Wallet" },
    ],
    availability: { metamask: true, coinbase: true },
    isWalletDiscoveryComplete: true,
    isConnecting: false,
    connectWallet: connectWalletMock,
  }),
}));

import DeployPoolModal from "@/app/(app)/pools/deploy-pool-modal";

const originalFetch = global.fetch;
const deployButton = () => screen.getByRole("button", { name: /^deploy/i });

/** Fill the deploy form and land on the step-4 review. `asset` picks the initial contribution. */
async function advanceToReview(asset: "eth" | "PAXG" | "WBTC" = "eth") {
  fireEvent.change(screen.getByPlaceholderText("CommunityPool"), { target: { value: "Test Pool" } });
  fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
  if (asset !== "eth") fireEvent.click(screen.getByRole("button", { name: asset }));
  fireEvent.change(screen.getByLabelText(/Amount/i), { target: { value: "25" } });
  fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
  // The ERC20 path awaits a price read before advancing, so wait for step 3 to render.
  await waitFor(() => expect(document.querySelector('input[type="date"]')).not.toBeNull());
  const date = document.querySelector<HTMLInputElement>('input[type="date"]')!;
  fireEvent.change(date, { target: { value: tomorrowYmd() } });
  fireEvent.click(screen.getByRole("button", { name: /Review/i }));
}

describe("deploy modal initial-contribution economics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_EXPECTED_CHAIN_ID = "1";
    readChainProtocolFeeBpsMock.mockResolvedValue(100n);
    weiForUsdMock.mockResolvedValue(1_000000000000000000n);
    erc20UsdToHumanMock.mockResolvedValue("1.0");
    erc20UsdToTokenMock.mockResolvedValue(1_000000000000000000n);
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ allowed: true, deployedPoolCount: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;
  });
  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });

  it("shows gross / fee / net in ETH for the initial contribution", async () => {
    render(<DeployPoolModal open onClose={vi.fn()} />);
    await advanceToReview();
    await waitFor(() => expect(document.body.textContent).toMatch(/Protocol fee \(1%\)/i));
    const text = (document.body.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toMatch(/Funding amount ?1 ETH/i);
    expect(text).toMatch(/0\.01 ETH/);
    expect(text).toMatch(/0\.99 ETH/);
    expect(text).toMatch(/not added on top/i);
  });

  it("shows gross / fee / net in token units for an ERC20 initial contribution", async () => {
    render(<DeployPoolModal open onClose={vi.fn()} />);
    await advanceToReview("PAXG");
    await waitFor(() => expect(document.body.textContent).toMatch(/Protocol fee \(1%\)/i));
    const text = (document.body.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toMatch(/Funding amount ?1 PAXG/i);
    expect(text).toMatch(/0\.01 PAXG/);
    expect(text).toMatch(/0\.99 PAXG/);
  });

  it.each([
    [0n, "0 ETH", "1 ETH"],
    [75n, "0.0075 ETH", "0.9925 ETH"],
    [300n, "0.03 ETH", "0.97 ETH"],
  ])("computes the split correctly at %s bps", async (bps, fee, net) => {
    readChainProtocolFeeBpsMock.mockResolvedValue(bps as bigint);
    render(<DeployPoolModal open onClose={vi.fn()} />);
    await advanceToReview();
    await waitFor(() => expect(document.body.textContent).toMatch(/Protocol fee \(/i));
    const text = (document.body.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toContain(fee as string);
    expect(text).toContain(net as string);
  });

  it("blocks deployment when the live ProtocolConfig fee cannot be read, and offers Retry", async () => {
    readChainProtocolFeeBpsMock.mockResolvedValue(null);
    render(<DeployPoolModal open onClose={vi.fn()} />);
    await advanceToReview();
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/could not read the current protocol fee/i),
    );
    expect(deployButton()).toBeDisabled();
    fireEvent.click(deployButton());
    expect(deployCommunityPoolMock).not.toHaveBeenCalled();
    expect(fundPoolEthMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("recovers through Retry and then allows deployment", async () => {
    readChainProtocolFeeBpsMock.mockResolvedValue(null);
    render(<DeployPoolModal open onClose={vi.fn()} />);
    await advanceToReview();
    await waitFor(() => expect(deployButton()).toBeDisabled());
    readChainProtocolFeeBpsMock.mockResolvedValue(100n);
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(deployButton()).toBeEnabled());
    expect(document.body.textContent).toMatch(/Protocol fee \(1%\)/i);
  });

  it("never presents the initial contribution as gross plus a surcharge", async () => {
    render(<DeployPoolModal open onClose={vi.fn()} />);
    await advanceToReview();
    await waitFor(() => expect(document.body.textContent).toMatch(/Protocol fee \(1%\)/i));
    const text = (document.body.textContent ?? "").replace(/\s+/g, " ");
    expect(text).not.toMatch(/1\.01 ETH/);
    expect(text).toMatch(/never exceed the 3% maximum/i);
  });
});

/**
 * Deploy-time fee re-read gates (Phase 2.8 hardening, round 2).
 *
 * The deploy flow submits two transactions back to back with no review in between, so the fee is
 * re-read twice: once immediately before the deployment prompt, and again after the pool is
 * confirmed but before the deposit prompt. A pool that is already on-chain is never rolled back —
 * it is preserved as funding-pending and handed to the reviewed Fund flow.
 */
describe("deploy-time protocol-fee re-read gates", () => {
  const deployed = {
    contract: {
      getAddress: async () => "0x00000000000000000000000000000000000000AA",
      waitForDeployment: async () => undefined,
    },
    deployTx: { hash: "0x" + "d".repeat(64), wait: async () => ({}) },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_EXPECTED_CHAIN_ID = "1";
    readChainProtocolFeeBpsMock.mockResolvedValue(100n);
    weiForUsdMock.mockResolvedValue(1_000000000000000000n);
    erc20UsdToHumanMock.mockResolvedValue("1.0");
    erc20UsdToTokenMock.mockResolvedValue(1_000000000000000000n);
    deployCommunityPoolMock.mockResolvedValue(deployed);
    fundPoolEthMock.mockResolvedValue({ hash: "0x" + "f".repeat(64), wait: async () => ({}) });
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ allowed: true, deployedPoolCount: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;
  });
  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });

  it("deploys and funds when the rate is unchanged at both gates", async () => {
    const onDeployed = vi.fn();
    render(<DeployPoolModal open onClose={vi.fn()} onDeployed={onDeployed} />);
    await advanceToReview();
    await waitFor(() => expect(deployButton()).toBeEnabled());
    fireEvent.click(deployButton());
    await waitFor(() => expect(fundPoolEthMock).toHaveBeenCalledTimes(1));
    expect(deployCommunityPoolMock).toHaveBeenCalledTimes(1);
    const statuses = onDeployed.mock.calls.map((c) => c[0].fundingStatus);
    expect(statuses).toContain("funded");
  });

  it("refuses to deploy when the rate changed between review and pressing Deploy", async () => {
    render(<DeployPoolModal open onClose={vi.fn()} />);
    await advanceToReview();
    await waitFor(() => expect(deployButton()).toBeEnabled());
    // Admin moves the rate after the review rendered.
    readChainProtocolFeeBpsMock.mockResolvedValue(75n);
    fireEvent.click(deployButton());
    await waitFor(() => expect(document.body.textContent).toMatch(/protocol fee changed/i));
    expect(deployCommunityPoolMock).not.toHaveBeenCalled();
    expect(fundPoolEthMock).not.toHaveBeenCalled();
    // The refreshed split is on screen; a second deliberate press now deploys.
    await waitFor(() => expect(document.body.textContent).toMatch(/Protocol fee \(0\.75%\)/i));
    await waitFor(() => expect(deployButton()).toBeEnabled());
    fireEvent.click(deployButton());
    await waitFor(() => expect(deployCommunityPoolMock).toHaveBeenCalledTimes(1));
  });

  it("refuses to deploy when the pre-deployment fee read fails", async () => {
    render(<DeployPoolModal open onClose={vi.fn()} />);
    await advanceToReview();
    await waitFor(() => expect(deployButton()).toBeEnabled());
    readChainProtocolFeeBpsMock.mockResolvedValue(null);
    fireEvent.click(deployButton());
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/could not confirm the current protocol fee/i),
    );
    expect(deployCommunityPoolMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("pauses funding — without a wallet prompt — when the rate changes after deployment", async () => {
    const onDeployed = vi.fn();
    render(<DeployPoolModal open onClose={vi.fn()} onDeployed={onDeployed} />);
    await advanceToReview();
    await waitFor(() => expect(deployButton()).toBeEnabled());
    // Unchanged at gate A, moved by gate B.
    readChainProtocolFeeBpsMock.mockResolvedValueOnce(100n).mockResolvedValue(300n);
    fireEvent.click(deployButton());
    await waitFor(() => expect(document.body.textContent).toMatch(/initial funding paused/i));
    expect(deployCommunityPoolMock).toHaveBeenCalledTimes(1);
    expect(fundPoolEthMock).not.toHaveBeenCalled();
    const text = (document.body.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toMatch(/no funding transaction was submitted/i);
    expect(text).toMatch(/0x00000000000000000000000000000000000000AA/i);
    // The deployed pool is preserved and recoverable, never rolled back.
    const last = onDeployed.mock.calls.at(-1)![0];
    expect(last.address.toLowerCase()).toBe("0x00000000000000000000000000000000000000aa");
    expect(last.fundingStatus).toBe("funding_pending");
    expect(last.needsRecovery).toBe(true);
    expect(last.fundTxHash).toBeNull();
  });

  it("pauses funding when the post-deployment fee read fails", async () => {
    const onDeployed = vi.fn();
    render(<DeployPoolModal open onClose={vi.fn()} onDeployed={onDeployed} />);
    await advanceToReview();
    await waitFor(() => expect(deployButton()).toBeEnabled());
    readChainProtocolFeeBpsMock.mockResolvedValueOnce(100n).mockResolvedValue(null);
    fireEvent.click(deployButton());
    await waitFor(() => expect(document.body.textContent).toMatch(/initial funding paused/i));
    expect(fundPoolEthMock).not.toHaveBeenCalled();
    expect(document.body.textContent).toMatch(/could not be confirmed/i);
    const last = onDeployed.mock.calls.at(-1)![0];
    expect(last.fundingStatus).toBe("funding_pending");
    expect(last.needsRecovery).toBe(true);
  });

  it("hands the paused pool to the reviewed Fund flow without redeploying", async () => {
    const onRequestFund = vi.fn();
    render(<DeployPoolModal open onClose={vi.fn()} onRequestFund={onRequestFund} />);
    await advanceToReview();
    await waitFor(() => expect(deployButton()).toBeEnabled());
    readChainProtocolFeeBpsMock.mockResolvedValueOnce(100n).mockResolvedValue(300n);
    fireEvent.click(deployButton());
    await waitFor(() => expect(document.body.textContent).toMatch(/initial funding paused/i));
    fireEvent.click(screen.getByRole("button", { name: /review and fund this pool/i }));
    expect(onRequestFund).toHaveBeenCalledTimes(1);
    expect(onRequestFund.mock.calls[0][0].address.toLowerCase()).toBe(
      "0x00000000000000000000000000000000000000aa",
    );
    // Recovery must never re-run the deployment.
    expect(deployCommunityPoolMock).toHaveBeenCalledTimes(1);
    expect(fundPoolEthMock).not.toHaveBeenCalled();
  });

  it("does not present a paused run as a successful funded deployment", async () => {
    render(<DeployPoolModal open onClose={vi.fn()} />);
    await advanceToReview();
    await waitFor(() => expect(deployButton()).toBeEnabled());
    readChainProtocolFeeBpsMock.mockResolvedValueOnce(100n).mockResolvedValue(300n);
    fireEvent.click(deployButton());
    await waitFor(() => expect(document.body.textContent).toMatch(/initial funding paused/i));
    expect(document.body.textContent).not.toMatch(/pool deployed and funded/i);
    expect(screen.getByRole("button", { name: /^close$/i })).toBeInTheDocument();
  });

});

/**
 * Error classification (Phase 2.8 smoke hotfix).
 *
 * Production reported "could not read the current protocol fee" when the fee read had actually
 * succeeded and the ETH/USD price read was what failed. Each cause must now name itself, and each
 * must still fail closed with Retry.
 */
describe("deploy review distinguishes fee, price and calculation failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_EXPECTED_CHAIN_ID = "1";
    readChainProtocolFeeBpsMock.mockResolvedValue(100n);
    weiForUsdMock.mockResolvedValue(1_000000000000000000n);
    erc20UsdToHumanMock.mockResolvedValue("1.0");
    erc20UsdToTokenMock.mockResolvedValue(1_000000000000000000n);
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ allowed: true, deployedPoolCount: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;
  });
  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });

  it("healthy fee + healthy feed produces the split (the smoke-test case)", async () => {
    // $0.01 of ETH at $2509.88611728 -> 3,984,242,...  wei.
    weiForUsdMock.mockResolvedValue(3_984_242_408_842n);
    render(<DeployPoolModal open onClose={vi.fn()} />);
    await advanceToReview();
    await waitFor(() => expect(document.body.textContent).toMatch(/Protocol fee \(1%\)/i));
    expect(deployButton()).toBeEnabled();
    const text = (document.body.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toMatch(/Funding amount/i);
    expect(text).not.toMatch(/could not read/i);
  });

  it("blames the fee only when the fee read fails", async () => {
    readChainProtocolFeeBpsMock.mockResolvedValue(null);
    render(<DeployPoolModal open onClose={vi.fn()} />);
    await advanceToReview();
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/could not read the current protocol fee/i),
    );
    expect(document.body.textContent).not.toMatch(/price needed to calculate/i);
    expect(deployButton()).toBeDisabled();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("names the ETH/USD price when the price read fails, not the fee", async () => {
    weiForUsdMock.mockRejectedValue(new Error("eth_call failed"));
    render(<DeployPoolModal open onClose={vi.fn()} />);
    await advanceToReview();
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/could not read the current ETH\/USD price/i),
    );
    // The precise misattribution that broke the smoke test must not recur.
    expect(document.body.textContent).not.toMatch(/could not read the current protocol fee/i);
    expect(deployButton()).toBeDisabled();
  });

  it("names the ERC20's own feed when its price read fails", async () => {
    erc20UsdToTokenMock.mockRejectedValue(new Error("eth_call failed"));
    render(<DeployPoolModal open onClose={vi.fn()} />);
    await advanceToReview("PAXG");
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/could not read the current PAXG\/USD price/i),
    );
    expect(document.body.textContent).not.toMatch(/protocol fee\. /i);
  });

  it("reports a calculation failure distinctly", async () => {
    // A rate above the contract cap can only come from a bad read; the split refuses to compute.
    readChainProtocolFeeBpsMock.mockResolvedValue(301n);
    render(<DeployPoolModal open onClose={vi.fn()} />);
    await advanceToReview();
    await waitFor(() => expect(document.body.textContent).toMatch(/could not/i));
    expect(deployButton()).toBeDisabled();
  });

  it("Retry recovers from a transient price failure and enables Deploy", async () => {
    weiForUsdMock.mockRejectedValueOnce(new Error("eth_call failed"));
    render(<DeployPoolModal open onClose={vi.fn()} />);
    await advanceToReview();
    await waitFor(() => expect(document.body.textContent).toMatch(/ETH\/USD price/i));
    expect(deployButton()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(deployButton()).toBeEnabled());
    expect(document.body.textContent).toMatch(/Protocol fee \(1%\)/i);
  });

  it("Retry recovers from a transient fee failure and enables Deploy", async () => {
    readChainProtocolFeeBpsMock.mockResolvedValue(null);
    render(<DeployPoolModal open onClose={vi.fn()} />);
    await advanceToReview();
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/could not read the current protocol fee/i),
    );
    expect(deployButton()).toBeDisabled();
    readChainProtocolFeeBpsMock.mockResolvedValue(100n);
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(deployButton()).toBeEnabled());
    expect(document.body.textContent).toMatch(/Protocol fee \(1%\)/i);
  });

  it("never hardcodes a rate: a 0 bps chain renders 0%, not 1%", async () => {
    readChainProtocolFeeBpsMock.mockResolvedValue(0n);
    render(<DeployPoolModal open onClose={vi.fn()} />);
    await advanceToReview();
    await waitFor(() => expect(document.body.textContent).toMatch(/Protocol fee \(0%\)/i));
    expect(document.body.textContent).not.toMatch(/Protocol fee \(1%\)/i);
  });

});

/**
 * Disconnected wallet (Phase 2.8 final polish).
 *
 * With no wallet there is nothing to read prices or the fee with. That is a wallet state, not a
 * chain failure, and must not be dressed up as one — the production smoke test showed
 * "Could not calculate the initial contribution" when the real requirement was connecting.
 */
describe("deploy review with no wallet connected", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_EXPECTED_CHAIN_ID = "1";
    readChainProtocolFeeBpsMock.mockResolvedValue(100n);
    weiForUsdMock.mockResolvedValue(3_984_242_408_842n);
    erc20UsdToHumanMock.mockResolvedValue("1.0");
    erc20UsdToTokenMock.mockResolvedValue(1_000000000000000000n);
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ allowed: true, deployedPoolCount: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;
  });
  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
    walletState.signer = connectedSigner;
    walletState.isConnected = true;
  });

  it("asks the user to connect rather than reporting a failure", async () => {
    walletState.signer = null;
    walletState.isConnected = false;
    render(<DeployPoolModal open onClose={vi.fn()} />);
    await advanceToReview();
    await waitFor(() =>
      expect(document.body.textContent).toMatch(
        /connect your wallet to calculate the initial contribution/i,
      ),
    );
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/could not read the current protocol fee/i);
    expect(text).not.toMatch(/price needed to calculate/i);
    expect(text).not.toMatch(/could not calculate the initial contribution/i);
  });

  it("keeps Deploy disabled and does not offer Retry as the action", async () => {
    walletState.signer = null;
    walletState.isConnected = false;
    render(<DeployPoolModal open onClose={vi.fn()} />);
    await advanceToReview();
    await waitFor(() => expect(document.body.textContent).toMatch(/connect your wallet/i));
    expect(deployButton()).toBeDisabled();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("resolves the preview once a wallet becomes available", async () => {
    walletState.signer = null;
    walletState.isConnected = false;
    const { rerender } = render(<DeployPoolModal open onClose={vi.fn()} />);
    await advanceToReview();
    await waitFor(() => expect(document.body.textContent).toMatch(/connect your wallet/i));
    // Wallet connects while the review is open.
    walletState.signer = connectedSigner;
    walletState.isConnected = true;
    rerender(<DeployPoolModal open onClose={vi.fn()} />);
    await waitFor(() => expect(document.body.textContent).toMatch(/Protocol fee \(1%\)/i));
    expect(deployButton()).toBeEnabled();
    expect(document.body.textContent).not.toMatch(/connect your wallet/i);
  });
});

/** Precision of the rendered rows, end to end through the modal. */
describe("deploy review renders small amounts distinctly", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_EXPECTED_CHAIN_ID = "1";
    readChainProtocolFeeBpsMock.mockResolvedValue(100n);
    weiForUsdMock.mockResolvedValue(3_984_242_408_842n); // $0.01 of ETH, the smoke-test amount
    erc20UsdToTokenMock.mockResolvedValue(12_345_678n); // 0.12345678 WBTC
    erc20UsdToHumanMock.mockResolvedValue("0.12345678");
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ allowed: true, deployedPoolCount: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;
  });
  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });

  it("shows a visible 1% fee on the $0.01 ETH smoke-test amount", async () => {
    render(<DeployPoolModal open onClose={vi.fn()} />);
    await advanceToReview();
    await waitFor(() => expect(document.body.textContent).toMatch(/Protocol fee \(1%\)/i));
    const text = (document.body.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toMatch(/0\.00000398424 ETH/);
    expect(text).toMatch(/0\.0000000398424 ETH/);
    expect(text).toMatch(/0\.00000394439 ETH/);
    // The old collapsed rendering must not come back.
    expect(text).not.toMatch(/0\.000003 ETH/);
  });

  it("shows a WBTC contribution to its full 8 decimals", async () => {
    render(<DeployPoolModal open onClose={vi.fn()} />);
    await advanceToReview("WBTC");
    await waitFor(() => expect(document.body.textContent).toMatch(/Protocol fee \(1%\)/i));
    const text = (document.body.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toMatch(/0\.12345678 WBTC/);
    expect(text).toMatch(/0\.00123456 WBTC/);
    expect(text).toMatch(/0\.12222222 WBTC/);
  });

});

/**
 * The disconnected-wallet action must be usable from inside the dialog.
 *
 * DeployPoolModal is a full-screen `fixed inset-0 z-50` overlay whose backdrop closes it, and
 * closing resets the form. Pointing at the page header was therefore not actionable: reaching it
 * meant discarding everything typed. The app's own WalletPicker renders at z-[100], so it layers
 * above this dialog and the whole connect flow happens without losing state.
 */
describe("connecting a wallet from the deploy review", () => {
  const filled = {
    name: "CommunityPool V2 Production Smoke",
    description: "Phase 2.8 production smoke test",
    amount: "0.01",
  };

  async function reviewWithoutWallet(asset: "eth" | "PAXG" = "eth") {
    walletState.signer = null;
    walletState.isConnected = false;
    const utils = render(<DeployPoolModal open onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("CommunityPool"), {
      target: { value: filled.name },
    });
    fireEvent.change(screen.getByPlaceholderText(/CommunityPool Description/i), {
      target: { value: filled.description },
    });
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    if (asset !== "eth") fireEvent.click(screen.getByRole("button", { name: asset }));
    fireEvent.change(screen.getByLabelText(/Amount/i), { target: { value: filled.amount } });
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    await waitFor(() => expect(document.querySelector('input[type="date"]')).not.toBeNull());
    const date = document.querySelector<HTMLInputElement>('input[type="date"]')!;
    fireEvent.change(date, { target: { value: tomorrowYmd() } });
    fireEvent.click(screen.getByRole("button", { name: /Review/i }));
    await waitFor(() => expect(document.body.textContent).toMatch(/connect your wallet/i));
    return utils;
  }

  /** Everything the user typed is still on the review step. */
  function expectFormPreserved(asset = "ETH") {
    const text = (document.body.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toMatch(/Review your pool/i);
    expect(text).toContain(filled.name);
    expect(text).toContain(filled.description);
    expect(text).toMatch(new RegExp(`${asset} · \\$${filled.amount} USD`));
    expect(text).toMatch(/You only \(connected wallet address\)/i);
    expect(text).toMatch(new RegExp(tomorrowYmd()));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_EXPECTED_CHAIN_ID = "1";
    readChainProtocolFeeBpsMock.mockResolvedValue(100n);
    weiForUsdMock.mockResolvedValue(3_984_242_408_842n);
    erc20UsdToHumanMock.mockResolvedValue("1.0");
    erc20UsdToTokenMock.mockResolvedValue(1_000000000000000000n);
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ allowed: true, deployedPoolCount: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;
  });
  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
    walletState.signer = connectedSigner;
    walletState.isConnected = true;
  });

  it("offers an actionable Connect wallet button, not a pointer to the page header", async () => {
    await reviewWithoutWallet();
    expect(screen.getByRole("button", { name: /^connect wallet$/i })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/at the top of the page/i);
  });

  it("does not prompt for a wallet merely by reaching step 4", async () => {
    await reviewWithoutWallet();
    expect(connectWalletMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: /choose a wallet/i })).not.toBeInTheDocument();
  });

  it("opens the app's own wallet picker above the deploy dialog", async () => {
    await reviewWithoutWallet();
    fireEvent.click(screen.getByRole("button", { name: /^connect wallet$/i }));
    const picker = await screen.findByRole("dialog", { name: /choose a wallet/i });
    expect(picker).toBeInTheDocument();
    // Layered above the deploy dialog (z-50), so it is actually reachable.
    expect(picker.className).toContain("z-[100]");
    expect(screen.getByRole("button", { name: /metamask/i })).toBeInTheDocument();
  });

  it("delegates the connection to the wallet provider rather than reimplementing it", async () => {
    await reviewWithoutWallet();
    fireEvent.click(screen.getByRole("button", { name: /^connect wallet$/i }));
    await screen.findByRole("dialog", { name: /choose a wallet/i });
    fireEvent.click(screen.getByRole("button", { name: /metamask/i }));
    await waitFor(() => expect(connectWalletMock).toHaveBeenCalledWith("metamask"));
  });

  it("keeps the deploy form intact when wallet selection is cancelled", async () => {
    await reviewWithoutWallet();
    fireEvent.click(screen.getByRole("button", { name: /^connect wallet$/i }));
    await screen.findByRole("dialog", { name: /choose a wallet/i });
    fireEvent.click(screen.getByRole("button", { name: /close wallet picker/i }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /choose a wallet/i })).not.toBeInTheDocument(),
    );
    expectFormPreserved();
    expect(deployButton()).toBeDisabled();
    expect(document.body.textContent).toMatch(/connect your wallet/i);
  });

  it("stays on step 4 with the form intact and resolves the preview after connecting", async () => {
    const { rerender } = await reviewWithoutWallet();
    fireEvent.click(screen.getByRole("button", { name: /^connect wallet$/i }));
    await screen.findByRole("dialog", { name: /choose a wallet/i });
    fireEvent.click(screen.getByRole("button", { name: /metamask/i }));
    await waitFor(() => expect(connectWalletMock).toHaveBeenCalled());
    // The provider hands back a signer; the modal re-renders with wallet context.
    walletState.signer = connectedSigner;
    walletState.isConnected = true;
    rerender(<DeployPoolModal open onClose={vi.fn()} />);
    await waitFor(() => expect(document.body.textContent).toMatch(/Protocol fee \(1%\)/i));
    expectFormPreserved();
    expect(document.body.textContent).not.toMatch(/connect your wallet/i);
    const text = (document.body.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toMatch(/0\.00000398424 ETH/);
    expect(text).toMatch(/0\.0000000398424 ETH/);
    expect(text).toMatch(/0\.00000394439 ETH/);
    expect(deployButton()).toBeEnabled();
  });

  it("preserves a chosen ERC20 asset across the connect flow", async () => {
    const { rerender } = await reviewWithoutWallet("PAXG");
    fireEvent.click(screen.getByRole("button", { name: /^connect wallet$/i }));
    await screen.findByRole("dialog", { name: /choose a wallet/i });
    fireEvent.click(screen.getByRole("button", { name: /metamask/i }));
    walletState.signer = connectedSigner;
    walletState.isConnected = true;
    rerender(<DeployPoolModal open onClose={vi.fn()} />);
    await waitFor(() => expect(document.body.textContent).toMatch(/Protocol fee \(1%\)/i));
    expectFormPreserved("PAXG");
    expect(document.body.textContent).toMatch(/PAXG/);
  });

  it("keeps Deploy disabled until the preview actually resolves", async () => {
    readChainProtocolFeeBpsMock.mockResolvedValue(null);
    const { rerender } = await reviewWithoutWallet();
    expect(deployButton()).toBeDisabled();
    walletState.signer = connectedSigner;
    walletState.isConnected = true;
    rerender(<DeployPoolModal open onClose={vi.fn()} />);
    // Wallet present but the fee still unreadable: a different state, still blocked.
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/could not read the current protocol fee/i),
    );
    expect(deployButton()).toBeDisabled();
    expect(document.body.textContent).not.toMatch(/connect your wallet/i);
  });
});
