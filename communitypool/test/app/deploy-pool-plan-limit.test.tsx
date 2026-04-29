/**
 * Deploy-modal plan-limit gate (OWASP A06 F-02).
 *
 * Asserts:
 *   - the modal calls /api/pools/check-deploy *before* invoking any wallet
 *     method — i.e. the wallet signature prompt cannot open when blocked
 *   - the upgrade message is shown verbatim when allowed=false
 *   - an Upgrade link to /pricing is rendered
 *   - when allowed=true the wallet's deploy/fund path is reached (positive
 *     control so we know the gate isn't simply blocking everything)
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

// Capture wallet calls so we can assert they were never invoked when the
// limit blocks the deploy. Hoisted so vi.mock factories can close over them.
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

// fetchKycStatus is server-shaped; stub it so the defense-in-depth check
// always passes and the runDeploy() flow reaches the preflight call.
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
  // Step 3: expiration date — pick tomorrow (computed off the real clock so
  // the test stays valid regardless of when it runs).
  const date = document.querySelector<HTMLInputElement>('input[type="date"]')!;
  fireEvent.change(date, { target: { value: tomorrowYmd() } });
  fireEvent.click(screen.getByRole("button", { name: /Review/i }));
}

describe("DeployPoolModal Free vs Pro plan-limit gate", () => {
  beforeEach(() => {
    deployCommunityPoolMock.mockReset();
    fundPoolEthMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });

  it("blocks before wallet signature when /api/pools/check-deploy returns allowed=false", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({
          allowed: false,
          plan: "free",
          deployedPoolCount: 2,
          freePoolLimit: 2,
          reason: "free_pool_limit_reached",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    global.fetch = fetchSpy as unknown as typeof fetch;

    render(<DeployPoolModal open onClose={vi.fn()} />);
    advanceToReview();

    fireEvent.click(screen.getByRole("button", { name: /Deploy/i }));

    // Wait for the upgrade message to render. Copy is intentionally vague —
    // the marketing funnel keeps the specific 2-pool number out of every
    // user-visible surface except the account card.
    await waitFor(() => {
      expect(
        screen.getByText(
          /Free plan limit reached\. Upgrade to Pro for unlimited pools\./i,
        ),
      ).toBeInTheDocument();
    });

    // Critical invariant: the wallet signature flow must NOT have started.
    expect(deployCommunityPoolMock).not.toHaveBeenCalled();
    expect(fundPoolEthMock).not.toHaveBeenCalled();

    // Preflight was hit exactly once with POST.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0] as unknown as [
      string,
      RequestInit | undefined,
    ];
    expect(call[0]).toBe("/api/pools/check-deploy");
    expect(call[1]?.method).toBe("POST");

    // Upgrade link points to /pricing.
    const upgradeLink = screen.getByRole("link", { name: /Upgrade to Pro/i });
    expect(upgradeLink).toHaveAttribute("href", "/pricing");
  });

  it("renders upgrade message verbatim when blocked", async () => {
    global.fetch = (async () =>
      new Response(
        JSON.stringify({
          allowed: false,
          plan: "free",
          deployedPoolCount: 2,
          freePoolLimit: 2,
          reason: "free_pool_limit_reached",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;

    render(<DeployPoolModal open onClose={vi.fn()} />);
    advanceToReview();
    fireEvent.click(screen.getByRole("button", { name: /Deploy/i }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Free plan limit reached. Upgrade to Pro for unlimited pools.",
        ),
      ).toBeInTheDocument();
    });
    // Specific number must NOT leak into the modal banner.
    expect(screen.queryByText(/2 pools/i)).not.toBeInTheDocument();
  });

  it("blocks before wallet signature when the preflight returns 401", async () => {
    global.fetch = (async () =>
      new Response(
        JSON.stringify({
          allowed: false,
          plan: "free",
          deployedPoolCount: 0,
          freePoolLimit: 2,
          reason: "authentication_required",
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;

    render(<DeployPoolModal open onClose={vi.fn()} />);
    advanceToReview();
    fireEvent.click(screen.getByRole("button", { name: /Deploy/i }));

    await waitFor(() => {
      expect(screen.getByText(/Sign in to deploy a pool/i)).toBeInTheDocument();
    });
    expect(deployCommunityPoolMock).not.toHaveBeenCalled();
  });

  it("proceeds to the wallet flow when the preflight returns allowed=true (Pro user)", async () => {
    global.fetch = (async () =>
      new Response(
        JSON.stringify({
          allowed: true,
          plan: "pro",
          deployedPoolCount: 5,
          freePoolLimit: 2,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;

    // Make the wallet path fail fast so the test doesn't hang on the real
    // ethers flow. We just need to observe that deployCommunityPool was
    // *attempted* (i.e. the preflight allowed us through).
    deployCommunityPoolMock.mockRejectedValue(
      new Error("wallet path stubbed in test"),
    );

    render(<DeployPoolModal open onClose={vi.fn()} />);
    advanceToReview();
    fireEvent.click(screen.getByRole("button", { name: /Deploy/i }));

    await waitFor(() => {
      expect(deployCommunityPoolMock).toHaveBeenCalledTimes(1);
    });

    // Upgrade banner must NOT render when the user is Pro.
    expect(
      screen.queryByText(/Free plan limit reached/i),
    ).not.toBeInTheDocument();
  });
});
