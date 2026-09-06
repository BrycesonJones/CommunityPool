/**
 * Deploy-modal preflight after the subscription model was retired.
 *
 * Asserts:
 *   - the modal still calls /api/pools/check-deploy *before* invoking any
 *     wallet method, and a 401 blocks the wallet signature prompt
 *     (authentication is still a hard requirement)
 *   - an authenticated user with many deployed pools proceeds straight to
 *     the wallet flow — there is no plan gate and no pool-count ceiling
 *   - no upgrade / pricing / subscription CTA is rendered anywhere in the
 *     modal, in either state
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

function tomorrowYmd(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

const { deployCommunityPoolMock, fundPoolEthMock } = vi.hoisted(() => ({
  deployCommunityPoolMock: vi.fn(),
  fundPoolEthMock: vi.fn(),
}));

vi.mock("@/lib/onchain/community-pool", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/onchain/community-pool")
  >("@/lib/onchain/community-pool");
  return {
    ...actual,
    deployCommunityPool: deployCommunityPoolMock,
    fundPoolEth: fundPoolEthMock,
  };
});

vi.mock("@/lib/profile/kyc", () => ({
  fetchKycStatus: async () => ({ complete: true, profile: null }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "test-user", email: "u@example.com" } },
      }),
    },
  }),
}));

const fakeSigner = {
  getAddress: async () => "0x000000000000000000000000000000000000dEaD",
};

vi.mock("@/components/wallet-provider", () => ({
  useWallet: () => ({
    walletAddress: "0x000000000000000000000000000000000000dEaD",
    isConnected: true,
    provider: null,
    signer: fakeSigner,
    chainId: BigInt(11155111),
    isWrongNetwork: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    switchToExpectedNetwork: vi.fn(),
  }),
}));

import DeployPoolModal from "@/app/(app)/pools/deploy-pool-modal";

const originalFetch = global.fetch;

function advanceToReview() {
  fireEvent.change(screen.getByPlaceholderText("CommunityPool"), {
    target: { value: "Test Pool" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
  fireEvent.change(screen.getByLabelText(/Amount/i), {
    target: { value: "25" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
  const date = document.querySelector<HTMLInputElement>('input[type="date"]')!;
  fireEvent.change(date, { target: { value: tomorrowYmd() } });
  fireEvent.click(screen.getByRole("button", { name: /Review/i }));
}

function expectNoSubscriptionUi() {
  expect(screen.queryByText(/upgrade/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/free plan/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/pro plan/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/subscri/i)).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /pricing/i })).not.toBeInTheDocument();
  expect(
    document.querySelector('a[href="/pricing"], a[href^="/billing"]'),
  ).toBeNull();
}

describe("DeployPoolModal preflight (no plan gate)", () => {
  beforeEach(() => {
    deployCommunityPoolMock.mockReset();
    fundPoolEthMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });

  it("blocks before wallet signature when the preflight returns 401", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({
          allowed: false,
          deployedPoolCount: 0,
          reason: "authentication_required",
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      ),
    );
    global.fetch = fetchSpy as unknown as typeof fetch;

    render(<DeployPoolModal open onClose={vi.fn()} />);
    advanceToReview();
    fireEvent.click(screen.getByRole("button", { name: /Deploy/i }));

    await waitFor(() => {
      expect(screen.getByText(/Sign in to deploy a pool/i)).toBeInTheDocument();
    });
    expect(deployCommunityPoolMock).not.toHaveBeenCalled();
    expect(fundPoolEthMock).not.toHaveBeenCalled();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0] as unknown as [
      string,
      RequestInit | undefined,
    ];
    expect(call[0]).toBe("/api/pools/check-deploy");
    expect(call[1]?.method).toBe("POST");

    expectNoSubscriptionUi();
  });

  it.each([0, 1, 2, 3, 25])(
    "proceeds to the wallet flow for an authenticated user with %i deployed pools",
    async (deployedPoolCount) => {
      global.fetch = (async () =>
        new Response(
          JSON.stringify({ allowed: true, deployedPoolCount }),
          { status: 200, headers: { "content-type": "application/json" } },
        )) as unknown as typeof fetch;

      // Fail fast on the wallet path; we only need to observe that it was
      // reached, i.e. nothing between the preflight and the wallet gated on
      // the pool count.
      deployCommunityPoolMock.mockRejectedValue(
        new Error("wallet path stubbed in test"),
      );

      render(<DeployPoolModal open onClose={vi.fn()} />);
      advanceToReview();
      fireEvent.click(screen.getByRole("button", { name: /Deploy/i }));

      await waitFor(() => {
        expect(deployCommunityPoolMock).toHaveBeenCalledTimes(1);
      });

      expectNoSubscriptionUi();
    },
  );

  it("shows a retryable error and never opens the wallet when the preflight is unavailable", async () => {
    global.fetch = (async () =>
      new Response("upstream down", { status: 503 })) as unknown as typeof fetch;

    render(<DeployPoolModal open onClose={vi.fn()} />);
    advanceToReview();
    fireEvent.click(screen.getByRole("button", { name: /Deploy/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/Could not verify deploy eligibility/i),
      ).toBeInTheDocument();
    });
    expect(deployCommunityPoolMock).not.toHaveBeenCalled();
    expectNoSubscriptionUi();
  });
});
