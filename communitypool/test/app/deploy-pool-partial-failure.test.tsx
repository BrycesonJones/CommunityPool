/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const shared = vi.hoisted(() => ({
  deployCommunityPool: vi.fn(),
  fundPoolEth: vi.fn(),
}));

vi.mock("@/components/wallet-provider", () => ({
  useWallet: () => ({
    signer: { getAddress: async () => "0x1111111111111111111111111111111111111111" },
    isConnected: true,
    chainId: 1n,
    isWrongNetwork: false,
    switchToExpectedNetwork: vi.fn(),
  }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user_1" } } }) },
  }),
}));

vi.mock("@/lib/profile/kyc", () => ({
  fetchKycStatus: async () => ({ complete: true, profile: {} }),
}));

vi.mock("@/lib/onchain/community-pool", async () => {
  const actual = await vi.importActual<typeof import("@/lib/onchain/community-pool")>(
    "@/lib/onchain/community-pool",
  );
  return {
    ...actual,
    deployCommunityPool: shared.deployCommunityPool,
    fundPoolEth: shared.fundPoolEth,
  };
});

describe("DeployPoolModal partial failure recovery", () => {
  function tomorrowYmd(): string {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  }

  beforeEach(() => {
    shared.deployCommunityPool.mockReset();
    shared.fundPoolEth.mockReset();
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ allowed: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;
  });

  it("persists deployment even when initial funding fails", async () => {
    const deployTx = {
      hash: "0x" + "a".repeat(64),
      wait: vi.fn(async () => ({})),
    };
    const contract = {
      waitForDeployment: vi.fn(async () => ({})),
      getAddress: vi.fn(async () => "0x1234567890123456789012345678901234567890"),
    };
    shared.deployCommunityPool.mockResolvedValue({ contract, deployTx });
    shared.fundPoolEth.mockRejectedValue(new Error("fund failed"));

    const onDeployed = vi.fn();
    const { default: DeployPoolModal } = await import(
      "@/app/(app)/pools/deploy-pool-modal"
    );
    render(<DeployPoolModal open onClose={vi.fn()} onDeployed={onDeployed} />);

    fireEvent.change(screen.getByPlaceholderText("CommunityPool"), {
      target: { value: "Pool A" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    fireEvent.change(screen.getByLabelText(/Amount/i), { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    const date = document.querySelector<HTMLInputElement>('input[type="date"]')!;
    fireEvent.change(date, { target: { value: tomorrowYmd() } });
    fireEvent.click(screen.getByRole("button", { name: /Review/i }));
    fireEvent.click(screen.getByRole("button", { name: /Deploy/i }));

    await waitFor(() =>
      expect(screen.getByText(/Pool created, but funding failed/i)).toBeInTheDocument(),
    );
    expect(onDeployed).toHaveBeenCalled();
    const statuses = onDeployed.mock.calls.map(
      (c) => c[0].fundingStatus,
    ) as Array<string>;
    expect(statuses).toContain("funding_pending");
    expect(statuses).toContain("funding_failed");
  });
});
