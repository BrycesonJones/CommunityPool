import { describe, it, expect } from "vitest";
import {
  applyOnChainBalancesToCard,
  formatMinimumUsdWeiForCard,
  partitionOpenClosed,
  poolCardsFromLocal,
  poolCardFromRow,
  rowsToCards,
} from "@/lib/pools/pool-activity-service";
import type { PoolOnChainBalances } from "@/lib/onchain/pool-balances";
import type { Tables } from "@/lib/supabase/database.types";

function mockRow(
  overrides: Partial<Tables<"user_pool_activity">>,
): Tables<"user_pool_activity"> {
  const now = new Date().toISOString();
  return {
    id: "row-1",
    user_id: "user-1",
    chain_id: 1,
    pool_address: "0x1234567890123456789012345678901234567890",
    last_activity: "deploy",
    last_tx_hashes: ["0xaa"],
    expires_at_unix: Math.floor(Date.now() / 1000) + 86_400,
    name: "Alpha Pool",
    description: "Test pool",
    minimum_usd_wei: "5000000000000000000",
    total_usd_estimate: 42,
    metadata: {},
    created_at: now,
    updated_at: now,
    asset_type: null,
    funded_amount_human: null,
    deploy_tx_hash: null,
    fund_tx_hash: null,
    ...overrides,
  };
}

describe("pool-activity-service", () => {
  it("formats minimum USD wei for display", () => {
    expect(formatMinimumUsdWeiForCard("1000000000000000000")).toBe("1.0");
    expect(formatMinimumUsdWeiForCard(null)).toBe("—");
  });

  it("splits open vs closed from expiresAt", () => {
    const nowSec = 1_700_000_000;
    const open = poolCardFromRow(
      mockRow({ expires_at_unix: nowSec + 10 }),
      nowSec,
    );
    const closed = poolCardFromRow(
      mockRow({ expires_at_unix: nowSec - 10 }),
      nowSec,
    );
    expect(open.segment).toBe("open");
    expect(closed.segment).toBe("closed");
    const { open: o, closed: c } = partitionOpenClosed([open, closed]);
    expect(o).toHaveLength(1);
    expect(c).toHaveLength(1);
  });

  it("maps localStorage rows to cards", () => {
    const nowSec = 1_700_000_000;
    const cards = poolCardsFromLocal(
      [
        {
          id: "x",
          name: "L",
          address: "0x1234567890123456789012345678901234567890",
          chainId: 1,
          status: "Active",
          totalUsd: 10,
          deployedAt: 1,
          expiresAtUnix: nowSec + 100,
          lastActivity: "fund",
        },
      ],
      nowSec,
    );
    expect(cards[0].lastActivity).toBe("fund");
    expect(cards[0].segment).toBe("open");
  });

  it("rowsToCards maps DB rows", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const rows = [mockRow({ expires_at_unix: nowSec + 3600 })];
    const cards = rowsToCards(rows, nowSec);
    expect(cards[0].name).toBe("Alpha Pool");
    expect(cards[0].minimumUsdDisplay).toContain("5");
  });

  it("poolCardFromRow surfaces asset_type, funded_amount_human, and typed tx hashes with explorer URLs (Sepolia)", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const addr = "0xabcdef0123456789abcdef0123456789abcdef01";
    const deployTx = "0x" + "a".repeat(64);
    const fundTx = "0x" + "b".repeat(64);
    const card = poolCardFromRow(
      mockRow({
        chain_id: 11155111,
        pool_address: addr,
        asset_type: "ETH",
        funded_amount_human: "0.0321",
        deploy_tx_hash: deployTx,
        fund_tx_hash: fundTx,
        expires_at_unix: nowSec + 3600,
      }),
      nowSec,
    );
    expect(card.assetType).toBe("ETH");
    expect(card.fundedAmountHuman).toBe("0.0321");
    expect(card.contractAddress).toBe(addr);
    expect(card.balanceUsd).toBe(42);
    expect(card.deployTxHash).toBe(deployTx);
    expect(card.fundTxHash).toBe(fundTx);
    expect(card.explorerAddressUrl).toBe(
      `https://sepolia.etherscan.io/address/${addr.toLowerCase()}`,
    );
    expect(card.explorerDeployTxUrl).toBe(
      `https://sepolia.etherscan.io/tx/${deployTx.toLowerCase()}`,
    );
    expect(card.explorerFundTxUrl).toBe(
      `https://sepolia.etherscan.io/tx/${fundTx.toLowerCase()}`,
    );
  });

  it("poolCardFromRow falls back to mainnet explorer for chain_id 1 and leaves tx URLs null when hashes absent", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const addr = "0x1111111111111111111111111111111111111111";
    const card = poolCardFromRow(
      mockRow({
        chain_id: 1,
        pool_address: addr,
        expires_at_unix: nowSec + 3600,
      }),
      nowSec,
    );
    expect(card.explorerAddressUrl).toBe(
      `https://etherscan.io/address/${addr.toLowerCase()}`,
    );
    expect(card.explorerDeployTxUrl).toBeNull();
    expect(card.explorerFundTxUrl).toBeNull();
  });

  it("applyOnChainBalancesToCard overlays primary amount and TVL (ETH + tokens)", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const card = poolCardFromRow(
      mockRow({
        chain_id: 1,
        asset_type: "ETH",
        funded_amount_human: "0.01", // stale / cached
        total_usd_estimate: 7, // stale / cached
        expires_at_unix: nowSec + 3600,
      }),
      nowSec,
    );
    const balances: PoolOnChainBalances = {
      pool: card.contractAddress,
      chainId: 1,
      blockNumber: 100,
      nativeEth: {
        symbol: "ETH",
        isNative: true,
        tokenAddress: null,
        decimals: 18,
        raw: BigInt("90000000000000000"), // 0.09 ETH
        human: "0.09",
        usdPerUnit: 2000,
        usd: 180,
      },
      tokens: [
        {
          symbol: "WBTC",
          isNative: false,
          tokenAddress: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
          decimals: 8,
          raw: BigInt(50_000_000),
          human: "0.5",
          usdPerUnit: 60_000,
          usd: 30_000,
        },
      ],
      totalUsd: 30_180,
      readAt: Date.now(),
    };
    const overlaid = applyOnChainBalancesToCard(card, balances);
    expect(overlaid.assetType).toBe("ETH");
    expect(overlaid.fundedAmountHuman).toBe("0.09");
    expect(overlaid.totalUsd).toBe(30_180);
    expect(overlaid.balanceUsd).toBe(30_180);
  });

  it("applyOnChainBalancesToCard picks the WBTC row when asset_type is WBTC", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const card = poolCardFromRow(
      mockRow({
        chain_id: 1,
        asset_type: "WBTC",
        expires_at_unix: nowSec + 3600,
      }),
      nowSec,
    );
    const balances: PoolOnChainBalances = {
      pool: card.contractAddress,
      chainId: 1,
      blockNumber: 1,
      nativeEth: {
        symbol: "ETH",
        isNative: true,
        tokenAddress: null,
        decimals: 18,
        raw: BigInt(0),
        human: "0.0",
        usdPerUnit: 2000,
        usd: 0,
      },
      tokens: [
        {
          symbol: "WBTC",
          isNative: false,
          tokenAddress: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
          decimals: 8,
          raw: BigInt(25_000_000),
          human: "0.25",
          usdPerUnit: 60_000,
          usd: 15_000,
        },
      ],
      totalUsd: 15_000,
      readAt: Date.now(),
    };
    const overlaid = applyOnChainBalancesToCard(card, balances);
    expect(overlaid.fundedAmountHuman).toBe("0.25");
    expect(overlaid.balanceUsd).toBe(15_000);
  });

  it("poolCardsFromLocal hydrates new fields from StoredOpenPool", () => {
    const nowSec = 1_700_000_000;
    const addr = "0x2222222222222222222222222222222222222222";
    const deployTx = "0x" + "c".repeat(64);
    const cards = poolCardsFromLocal(
      [
        {
          id: "x",
          name: "L",
          address: addr,
          chainId: 11155111,
          status: "Active",
          totalUsd: 10,
          deployedAt: 1,
          expiresAtUnix: nowSec + 100,
          lastActivity: "deploy",
          assetType: "WBTC",
          fundedAmountHuman: "0.0005",
          deployTxHash: deployTx,
        },
      ],
      nowSec,
    );
    expect(cards[0].assetType).toBe("WBTC");
    expect(cards[0].fundedAmountHuman).toBe("0.0005");
    expect(cards[0].deployTxHash).toBe(deployTx);
    expect(cards[0].explorerAddressUrl).toBe(
      `https://sepolia.etherscan.io/address/${addr.toLowerCase()}`,
    );
    expect(cards[0].explorerDeployTxUrl).toBe(
      `https://sepolia.etherscan.io/tx/${deployTx.toLowerCase()}`,
    );
  });
});
