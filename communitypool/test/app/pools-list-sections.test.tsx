import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, within, cleanup, fireEvent } from "@testing-library/react";
import PoolsListSections from "@/app/(app)/pools/pools-list-sections";
import type { PoolCardView } from "@/lib/pools/pool-activity-service";

afterEach(() => cleanup());

const SEPOLIA_ADDR = "0x1234567890123456789012345678901234567890";
const DEPLOY_TX = "0x" + "a".repeat(64);
const FUND_TX = "0x" + "b".repeat(64);

const baseCard = (overrides: Partial<PoolCardView>): PoolCardView => ({
  id: "1",
  name: "Persisted Pool",
  description: "From Supabase",
  address: SEPOLIA_ADDR,
  contractAddress: SEPOLIA_ADDR,
  chainId: 11155111,
  expiresAtUnix: Math.floor(Date.now() / 1000) + 86400,
  totalUsd: 100,
  balanceUsd: 100,
  lastActivity: "deploy",
  minimumUsdDisplay: "5.0",
  segment: "open",
  assetType: "ETH",
  fundedAmountHuman: "0.0321",
  fundingStatus: null,
  deployTxHash: DEPLOY_TX,
  fundTxHash: FUND_TX,
  explorerAddressUrl: `https://sepolia.etherscan.io/address/${SEPOLIA_ADDR.toLowerCase()}`,
  explorerDeployTxUrl: `https://sepolia.etherscan.io/tx/${DEPLOY_TX.toLowerCase()}`,
  explorerFundTxUrl: `https://sepolia.etherscan.io/tx/${FUND_TX.toLowerCase()}`,
  ...overrides,
});

describe("PoolsListSections", () => {
  it("renders open and closed pools from persisted card models", () => {
    const openPools: PoolCardView[] = [
      baseCard({ id: "a", name: "Open One", segment: "open" }),
    ];
    const closedPools: PoolCardView[] = [
      baseCard({
        id: "b",
        name: "Closed One",
        segment: "closed",
        expiresAtUnix: Math.floor(Date.now() / 1000) - 10,
      }),
    ];
    render(
      <PoolsListSections
        openPools={openPools}
        closedPools={closedPools}
        emptyOpenHint="no open"
        emptyClosedHint="no closed"
      />,
    );
    expect(screen.getByText("Open One")).toBeInTheDocument();
    expect(screen.getByText("Closed One")).toBeInTheDocument();
    expect(screen.getByText(/Open Pools/i)).toBeInTheDocument();
    expect(screen.getByText(/Closed Pools/i)).toBeInTheDocument();
  });

  it("shows empty hints when no pools", () => {
    render(
      <PoolsListSections
        openPools={[]}
        closedPools={[]}
        emptyOpenHint="empty open message"
        emptyClosedHint="empty closed message"
      />,
    );
    expect(screen.getByText("empty open message")).toBeInTheDocument();
    expect(screen.getByText("empty closed message")).toBeInTheDocument();
  });

  it("renders Open Pools as a table with Address/hash, Type, Amount, Balance (USD) columns (no Actions column when no row handlers)", () => {
    render(
      <PoolsListSections
        openPools={[baseCard({ id: "o1" })]}
        closedPools={[]}
        emptyOpenHint="no open"
        emptyClosedHint="no closed"
      />,
    );
    const table = screen.getByRole("table");
    const headers = within(table).getAllByRole("columnheader");
    const headerText = headers.map((h) => h.textContent);
    expect(headerText).toEqual([
      "Address / hash",
      "Type",
      "Amount",
      "Balance (USD)",
    ]);
    expect(within(table).getByText("ETH")).toBeInTheDocument();
    expect(within(table).getByText(/0\.0321 ETH/)).toBeInTheDocument();
    expect(within(table).getByText("$100")).toBeInTheDocument();
  });

  it("renders an Actions column with Fund and Withdraw buttons when row handlers are wired", () => {
    const onFundPool = vi.fn();
    const onWithdrawPool = vi.fn();
    render(
      <PoolsListSections
        openPools={[baseCard({ id: "o1", name: "TESTPOOL" })]}
        closedPools={[]}
        emptyOpenHint="no open"
        emptyClosedHint="no closed"
        onFundPool={onFundPool}
        onWithdrawPool={onWithdrawPool}
      />,
    );
    const table = screen.getByRole("table");
    const headers = within(table).getAllByRole("columnheader");
    const headerText = headers.map((h) => h.textContent);
    expect(headerText).toEqual([
      "Address / hash",
      "Type",
      "Amount",
      "Balance (USD)",
      "Actions",
    ]);

    const row = within(table).getByRole("row", { name: /TESTPOOL/ });
    const fundBtn = within(row).getByRole("button", { name: /fund testpool/i });
    const withdrawBtn = within(row).getByRole("button", {
      name: /withdraw from testpool/i,
    });
    expect(fundBtn).toBeInTheDocument();
    expect(withdrawBtn).toBeInTheDocument();

    fireEvent.click(fundBtn);
    expect(onFundPool).toHaveBeenCalledTimes(1);
    expect(onFundPool).toHaveBeenCalledWith({
      name: "TESTPOOL",
      address: SEPOLIA_ADDR,
      chainId: 11155111,
    });

    fireEvent.click(withdrawBtn);
    expect(onWithdrawPool).toHaveBeenCalledTimes(1);
    expect(onWithdrawPool).toHaveBeenCalledWith({
      name: "TESTPOOL",
      address: SEPOLIA_ADDR,
      chainId: 11155111,
    });
  });

  it("renders the contract address, Deploy tx, and Fund tx links inside the Address/hash cell, above the pool name", () => {
    render(
      <PoolsListSections
        openPools={[baseCard({ id: "o1", name: "TESTPOOL" })]}
        closedPools={[]}
        emptyOpenHint="no open"
        emptyClosedHint="no closed"
      />,
    );
    const row = screen.getByRole("row", { name: /TESTPOOL/ });
    const addressCell = within(row).getAllByRole("cell")[0];
    const links = within(addressCell).getAllByRole("link");
    const hrefs = links.map((l) => l.getAttribute("href"));
    expect(hrefs).toEqual([
      `https://sepolia.etherscan.io/address/${SEPOLIA_ADDR.toLowerCase()}`,
      `https://sepolia.etherscan.io/tx/${DEPLOY_TX.toLowerCase()}`,
      `https://sepolia.etherscan.io/tx/${FUND_TX.toLowerCase()}`,
    ]);
    const poolNameEl = within(addressCell).getByText("TESTPOOL");
    const deployLinkEl = within(addressCell).getByRole("link", {
      name: /deploy tx/i,
    });
    expect(
      deployLinkEl.compareDocumentPosition(poolNameEl) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      within(addressCell).queryByRole("link", { name: /contract/i }),
    ).not.toBeInTheDocument();
    expect(
      within(row)
        .getAllByRole("link")
        .every((l) => l.getAttribute("target") === "_blank"),
    ).toBe(true);
  });

  it("keeps Closed Pools on the existing card-list layout (no table)", () => {
    render(
      <PoolsListSections
        openPools={[]}
        closedPools={[
          baseCard({
            id: "c1",
            name: "Historical",
            segment: "closed",
            expiresAtUnix: Math.floor(Date.now() / 1000) - 100,
          }),
        ]}
        emptyOpenHint="no open"
        emptyClosedHint="no closed"
      />,
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("Historical")).toBeInTheDocument();
  });

  it("renders '—' in the Address cell when explorerAddressUrl is null (local chain)", () => {
    render(
      <PoolsListSections
        openPools={[
          baseCard({
            id: "o2",
            chainId: 31337,
            explorerAddressUrl: null,
            explorerDeployTxUrl: null,
            explorerFundTxUrl: null,
          }),
        ]}
        closedPools={[]}
        emptyOpenHint="no open"
        emptyClosedHint="no closed"
      />,
    );
    const table = screen.getByRole("table");
    expect(within(table).queryAllByRole("link")).toHaveLength(0);
  });
});
