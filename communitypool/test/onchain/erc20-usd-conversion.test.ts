import { describe, it, expect, vi } from "vitest";
import { Contract, JsonRpcProvider, formatUnits, parseUnits, type JsonRpcSigner } from "ethers";
import { erc20UsdToHumanAmountString } from "@/lib/onchain/tx-economics";

/**
 * Regression: a 2026-05-07 mainnet retry of an orphaned PAXG pool reverted
 * with CommunityPool__BelowMinimumUsd because the off-chain USD->token
 * conversion floor-truncated, so the on-chain back-conversion
 * (also a floor: tokenAmount * priceUsd / 10^decimals) landed one wei
 * below the pool's $25 minimum. The fix mirrors weiForUsdContribution's
 * `+ 1` atomic-unit buffer in the ERC20 path. These tests pin the
 * back-conversion clears the requested USD at the boundary case.
 */

type FakeFeedRound = {
  roundId: bigint;
  answer: bigint;
  startedAt: bigint;
  updatedAt: bigint;
  answeredInRound: bigint;
};

function makeSignerWithFeed(answer8dec: bigint): JsonRpcSigner {
  const round: FakeFeedRound = {
    roundId: 0n,
    answer: answer8dec,
    startedAt: 0n,
    updatedAt: 0n,
    answeredInRound: 0n,
  };
  const provider = new JsonRpcProvider("http://127.0.0.1:0");
  const signer = {
    provider,
    getAddress: async () => "0x0000000000000000000000000000000000000000",
  } as unknown as JsonRpcSigner;
  vi.spyOn(Contract.prototype, "getFunction" as never).mockImplementation(((
    name: string,
  ) => {
    if (name === "latestRoundData") {
      return Object.assign(async () => round, { staticCall: async () => round });
    }
    throw new Error(`unexpected method ${name}`);
  }) as never);
  return signer;
}

function backConvertUsd(tokenHuman: string, decimals: number, answer8dec: bigint): bigint {
  const tokenRaw = parseUnits(tokenHuman, decimals);
  const priceUsd18 = answer8dec * 10n ** 10n;
  return (tokenRaw * priceUsd18) / 10n ** BigInt(decimals);
}

describe("erc20UsdToHumanAmountString — back-conversion clears requested USD", () => {
  it("PAXG @ the actual mainnet feed price that triggered the 2026-05-07 revert", async () => {
    // Real PAXG/USD answer captured during the incident: $4688.37420893.
    const answer = 468837420893n;
    const decimals = 18;
    const signer = makeSignerWithFeed(answer);

    const tokenHuman = await erc20UsdToHumanAmountString(
      signer,
      { usdFeed: "0x9944D86CEB9160aF5C5feB251FD671923323f8C3", decimals },
      "25",
    );
    expect(tokenHuman).not.toBeNull();

    const backUsd = backConvertUsd(tokenHuman!, decimals, answer);
    const minimumUsd18 = parseUnits("25", 18);
    expect(backUsd).toBeGreaterThanOrEqual(minimumUsd18);
  });

  it("WBTC @ a typical mainnet price funds $25 above the boundary", async () => {
    // ~$95,000 / BTC, 8 decimals on the Chainlink answer.
    const answer = 9500000000000n;
    const decimals = 8;
    const signer = makeSignerWithFeed(answer);

    const tokenHuman = await erc20UsdToHumanAmountString(
      signer,
      { usdFeed: "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c", decimals },
      "25",
    );
    expect(tokenHuman).not.toBeNull();

    const backUsd = backConvertUsd(tokenHuman!, decimals, answer);
    expect(backUsd).toBeGreaterThanOrEqual(parseUnits("25", 18));
  });

  it("XAU₮ (6 decimals) — exact-equal boundary still clears", async () => {
    // ~$2400/oz, 8 decimals on the Chainlink answer.
    const answer = 240000000000n;
    const decimals = 6;
    const signer = makeSignerWithFeed(answer);

    const tokenHuman = await erc20UsdToHumanAmountString(
      signer,
      { usdFeed: "0x214eD9Da11D2fbe465a6fc601a91E62EbEc1a0D6", decimals },
      "25",
    );
    expect(tokenHuman).not.toBeNull();

    const backUsd = backConvertUsd(tokenHuman!, decimals, answer);
    expect(backUsd).toBeGreaterThanOrEqual(parseUnits("25", 18));
  });

  it("formatUnits round-trip preserves the +1 buffer (no precision loss)", async () => {
    const answer = 468837420893n;
    const decimals = 18;
    const signer = makeSignerWithFeed(answer);
    const tokenHuman = await erc20UsdToHumanAmountString(
      signer,
      { usdFeed: "0x9944D86CEB9160aF5C5feB251FD671923323f8C3", decimals },
      "25",
    );

    // The buffer matters even at the LSB: the parsed-back raw must be
    // exactly one unit greater than naive floor truncation.
    const naiveFloor = (parseUnits("25", 18) * 10n ** 18n) / (answer * 10n ** 10n);
    const parsedBack = parseUnits(tokenHuman!, decimals);
    expect(parsedBack - naiveFloor).toBe(1n);
    expect(formatUnits(parsedBack, decimals)).toBe(tokenHuman);
  });
});
