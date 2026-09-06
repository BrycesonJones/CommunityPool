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
} = vi.hoisted(() => ({
  deployCommunityPoolMock: vi.fn(),
  fundPoolEthMock: vi.fn(),
  readChainProtocolFeeBpsMock: vi.fn(),
  weiForUsdMock: vi.fn(),
  erc20UsdToHumanMock: vi.fn(),
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
