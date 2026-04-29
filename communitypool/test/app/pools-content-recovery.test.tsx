/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const shared = vi.hoisted(() => ({
  upsertPoolActivity: vi.fn(async () => ({ error: null as Error | null })),
  upsertPoolOwners: vi.fn(async () => ({ error: null as Error | null })),
  refreshDbPools: vi.fn(async () => {}),
  refreshOnChainBalances: vi.fn(async () => {}),
}));

vi.mock("@/components/pool-activity-provider", () => ({
  usePoolActivity: () => ({
    openPools: [],
    closedPools: [],
    refreshDbPools: shared.refreshDbPools,
    refreshOnChainBalances: shared.refreshOnChainBalances,
    emptyOpenHint: "none",
    emptyClosedHint: "none",
  }),
}));

vi.mock("@/components/wallet-provider", () => ({
  useWallet: () => ({ provider: null }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user_1" } } }) },
  }),
}));

vi.mock("@/lib/profile/kyc", () => ({
  fetchKycStatus: async () => ({ complete: true, profile: {} }),
}));

vi.mock("@/lib/pools/pool-activity-service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/pools/pool-activity-service")>(
    "@/lib/pools/pool-activity-service",
  );
  return {
    ...actual,
    upsertPoolActivity: shared.upsertPoolActivity,
  };
});

vi.mock("@/lib/pools/pool-ownership-service", () => ({
  upsertPoolOwners: shared.upsertPoolOwners,
}));

vi.mock("@/lib/pools/open-pools-storage", () => ({
  appendOpenPoolToStorage: vi.fn(),
  mergeAppendOpenPool: vi.fn(),
}));

vi.mock("@/lib/security/client-security-event", () => ({
  postClientSecurityEvent: async () => {},
}));

vi.mock("@/app/(app)/pools/deploy-pool-modal", () => ({
  default: ({
    open,
    onDeployed,
  }: {
    open: boolean;
    onDeployed?: (s: unknown) => void;
  }) =>
    open ? (
      <button
        type="button"
        onClick={() =>
          onDeployed?.({
            name: "Pool A",
            description: "",
            address: "0x1234567890123456789012345678901234567890",
            chainId: 1,
            totalUsd: 10,
            expiresAtUnix: 1_900_000_000,
            minimumUsdWei: "1",
            deployTxHash: "0x" + "a".repeat(64),
            fundTxHash: null,
            fundingStatus: "funding_failed",
            coOwners: [],
            deployerAddress: "0x1111111111111111111111111111111111111111",
            assetType: "ETH",
            fundedAmountHuman: "",
          })
        }
      >
        trigger-deployed
      </button>
    ) : null,
}));

vi.mock("@/app/(app)/pools/fund-pool-modal", () => ({
  default: ({
    open,
    onFunded,
  }: {
    open: boolean;
    onFunded?: (s: unknown) => void;
  }) =>
    open ? (
      <button
        type="button"
        onClick={() =>
          onFunded?.({
            poolName: "Pool A",
            poolAddress: "0x1234567890123456789012345678901234567890",
            chainId: 1,
            totalUsd: 10,
            fundTxHash: "0x" + "b".repeat(64),
          })
        }
      >
        trigger-funded
      </button>
    ) : null,
}));

vi.mock("@/app/(app)/pools/withdraw-pool-modal", () => ({
  default: ({
    open,
    onWithdrawn,
  }: {
    open: boolean;
    onWithdrawn?: (s: unknown) => void;
  }) =>
    open ? (
      <button
        type="button"
        onClick={() =>
          onWithdrawn?.({
            poolName: "Pool A",
            poolAddress: "0x1234567890123456789012345678901234567890",
            chainId: 1,
            withdrawTxHashes: ["0x" + "c".repeat(64)],
            totalUsdEstimate: 0,
          })
        }
      >
        trigger-withdrawn
      </button>
    ) : null,
}));

import PoolsContent from "@/app/(app)/pools/pools-content";

describe("PoolsContent recovery warnings", () => {
  afterEach(() => {
    cleanup();
  });
  beforeEach(() => {
    shared.upsertPoolActivity.mockReset();
    shared.upsertPoolOwners.mockReset();
    shared.refreshDbPools.mockClear();
    shared.refreshOnChainBalances.mockClear();
    shared.upsertPoolActivity.mockResolvedValue({ error: null });
    shared.upsertPoolOwners.mockResolvedValue({ error: null });
  });

  it("shows recovery warning when deploy persistence fails", async () => {
    shared.upsertPoolActivity.mockResolvedValue({ error: new Error("db down") });
    render(<PoolsContent />);
    fireEvent.click(screen.getByRole("button", { name: /Deploy a CommunityPool/i }));
    fireEvent.click(await screen.findByRole("button", { name: "trigger-deployed" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("confirmed on-chain"),
    );
    expect(screen.getByRole("alert").textContent).toContain("0x" + "a".repeat(64));
  });

  it("shows recovery warning when owner sync fails after deploy", async () => {
    shared.upsertPoolOwners.mockResolvedValue({ error: new Error("owner sync fail") });
    render(<PoolsContent />);
    fireEvent.click(screen.getByRole("button", { name: /Deploy a CommunityPool/i }));
    fireEvent.click(await screen.findByRole("button", { name: "trigger-deployed" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "could not save owner sync data",
      ),
    );
  });

  it("shows recovery warning when fund persistence fails", async () => {
    shared.upsertPoolActivity.mockResolvedValue({ error: new Error("db down") });
    render(<PoolsContent />);
    fireEvent.click(screen.getByRole("button", { name: /Fund a Pool/i }));
    fireEvent.click(await screen.findByRole("button", { name: "trigger-funded" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("0x" + "b".repeat(64)),
    );
  });

  it("shows recovery warning when withdraw persistence fails", async () => {
    shared.upsertPoolActivity.mockResolvedValue({ error: new Error("db down") });
    render(<PoolsContent />);
    fireEvent.click(screen.getByRole("button", { name: /Withdraw from Pool/i }));
    fireEvent.click(await screen.findByRole("button", { name: "trigger-withdrawn" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("0x" + "c".repeat(64)),
    );
  });
});
