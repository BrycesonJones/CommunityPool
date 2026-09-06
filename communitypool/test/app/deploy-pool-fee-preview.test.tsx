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
} = vi.hoisted(() => ({
  deployCommunityPoolMock: vi.fn(),
  fundPoolEthMock: vi.fn(),
  readChainProtocolFeeBpsMock: vi.fn(),
  weiForUsdMock: vi.fn(),
  erc20UsdToHumanMock: vi.fn(),
  erc20UsdToTokenMock: vi.fn(),
}));

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
    isConnected: true,
    provider: null,
    signer: { getAddress: async () => "0x000000000000000000000000000000000000dEaD", provider: {} },
    chainId: BigInt(1),
    isWrongNetwork: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    switchToExpectedNetwork: vi.fn(),
  }),
}));

import DeployPoolModal from "@/app/(app)/pools/deploy-pool-modal";

const originalFetch = global.fetch;
const deployButton = () => screen.getByRole("button", { name: /^deploy/i });

/** Fill the deploy form and land on the step-4 review. `asset` picks the initial contribution. */
async function advanceToReview(asset: "eth" | "PAXG" = "eth") {
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
