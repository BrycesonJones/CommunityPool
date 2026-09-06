/**
 * V2 CANDIDATE Anvil integration — protocol-fee collection end to end.
 *
 * Deliberately separate from anvil-community-pool.integration.test.ts, which
 * exercises the PRODUCTION V1 path through the frozen artifact. This suite
 * deploys ephemeral contracts on a local Anvil only and never touches the
 * production deploy helper:
 *   MockV3Aggregator (ETH/USD and WBTC/USD), MockMintableERC20 (8 dec),
 *   ProtocolConfig candidate, CommunityPool V2 candidate.
 * It verifies the ETH 1% split, the ERC-20 1% split, and a dynamic fee change
 * to 3% on the same pool.
 *
 * Gate: ANVIL_RPC_URL and ANVIL_V2_CANDIDATE=1. Requires `forge build` to have
 * produced forge-out/ for the mocks. No real funds, no real chain.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Contract, ContractFactory, JsonRpcProvider, Wallet, parseEther, parseUnits, type Log, type LogDescription } from "ethers";
import { COMMUNITY_POOL_V2_CANDIDATE_ARTIFACT, PROTOCOL_CONFIG_CANDIDATE_ARTIFACT } from "@/lib/onchain/community-pool-v2-candidate";

const RPC = process.env.ANVIL_RPC_URL?.trim();
const run = Boolean(RPC) && process.env.ANVIL_V2_CANDIDATE === "1";

// Public Anvil default development keys (accounts #0 and #1). NOT secrets; only
// valid on a local `anvil` chain. See docs/security/mainnet-deployment-key-policy.md.
const ANVIL_KEY_0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ANVIL_KEY_1 = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

function forgeOut(sourceFile: string, name: string) {
  // forge-out is keyed by SOURCE FILE then contract name.
  const p = path.resolve(process.cwd(), `forge-out/${sourceFile}/${name}.json`);
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  return { abi: j.abi, bytecode: j.bytecode.object as string };
}

describe.skipIf(!run)("anvil: V2 candidate protocol-fee collection (ephemeral, not production)", () => {
  it("splits ETH and ERC-20 contributions into fee → treasury and net → pool, and follows a fee change", async () => {
    const provider = new JsonRpcProvider(RPC!, undefined, { cacheTimeout: -1 });
    const admin = new Wallet(ANVIL_KEY_0, provider); // protocol admin + pool deployer + funder
    const treasury = new Wallet(ANVIL_KEY_1, provider);

    const feedArt = forgeOut("V3Aggregator.sol", "MockV3Aggregator");
    const tokenArt = forgeOut("MockMintableERC20.sol", "MockMintableERC20");
    const ethFeed = await new ContractFactory(feedArt.abi, feedArt.bytecode, admin).deploy(8, 2000_00000000n);
    await ethFeed.waitForDeployment();
    const wbtcFeed = await new ContractFactory(feedArt.abi, feedArt.bytecode, admin).deploy(8, 60000_00000000n);
    await wbtcFeed.waitForDeployment();
    const wbtc = await new ContractFactory(tokenArt.abi, tokenArt.bytecode, admin).deploy("Wrapped BTC", "WBTC", 8);
    await wbtc.waitForDeployment();

    const cfgFactory = new ContractFactory(PROTOCOL_CONFIG_CANDIDATE_ARTIFACT.abi, PROTOCOL_CONFIG_CANDIDATE_ARTIFACT.bytecode, admin);
    const config = await cfgFactory.deploy(admin.address, treasury.address, 100n);
    await config.waitForDeployment();

    const poolFactory = new ContractFactory(COMMUNITY_POOL_V2_CANDIDATE_ARTIFACT.abi, COMMUNITY_POOL_V2_CANDIDATE_ARTIFACT.bytecode, admin);
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 30 * 86400);
    const pool = await poolFactory.deploy(
      "V2 Candidate",
      "fee test",
      parseUnits("5", 18),
      [],
      expiresAt,
      await ethFeed.getAddress(),
      [{ token: await wbtc.getAddress(), usdFeed: await wbtcFeed.getAddress(), decimals: 8 }],
      await config.getAddress(),
    );
    await pool.waitForDeployment();
    const poolAddr = await pool.getAddress();
    const poolC = new Contract(poolAddr, COMMUNITY_POOL_V2_CANDIDATE_ARTIFACT.abi, admin);
    const configC = new Contract(await config.getAddress(), PROTOCOL_CONFIG_CANDIDATE_ARTIFACT.abi, admin);
    const wbtcC = new Contract(await wbtc.getAddress(), tokenArt.abi, admin);

    // ETH 1%
    const t0 = await provider.getBalance(treasury.address);
    const tx1 = await poolC.fund({ value: parseEther("1") });
    await tx1.wait();
    expect(await provider.getBalance(poolAddr)).toBe(parseEther("0.99"));
    expect((await provider.getBalance(treasury.address)) - t0).toBe(parseEther("0.01"));

    // ERC-20 1% with an allowance of exactly gross
    await (await wbtcC.mint(admin.address, 1_000_000n)).wait();
    await (await wbtcC.approve(poolAddr, 200_000n)).wait();
    const tx2 = await poolC.fundERC20(await wbtc.getAddress(), 200_000n);
    await tx2.wait();
    expect(await wbtcC.balanceOf(poolAddr)).toBe(198_000n);
    expect(await wbtcC.balanceOf(treasury.address)).toBe(2_000n);
    expect(await wbtcC.balanceOf(admin.address)).toBe(800_000n);
    expect(await wbtcC.allowance(admin.address, poolAddr)).toBe(0n);

    // Dynamic fee change on the SAME pool: 3%
    await (await configC.setProtocolFeeBps(300n)).wait();
    const [feeBps, recipient] = await poolC.getProtocolFeeConfig();
    expect(feeBps).toBe(300n);
    expect(recipient).toBe(treasury.address);
    const t1 = await provider.getBalance(treasury.address);
    const tx3 = await poolC.fund({ value: parseEther("1") });
    const rc3 = await tx3.wait();
    expect(await provider.getBalance(poolAddr)).toBe(parseEther("0.99") + parseEther("0.97"));
    expect((await provider.getBalance(treasury.address)) - t1).toBe(parseEther("0.03"));

    // The Funded event carries gross/fee/net explicitly.
    const funded = rc3!.logs
      .map((l: Log): LogDescription | null => { try { return poolC.interface.parseLog({ topics: [...l.topics], data: l.data }); } catch { return null; } })
      .find((p: LogDescription | null) => p?.name === "Funded");
    expect(funded).toBeTruthy();
    expect(funded!.args.grossAmount).toBe(parseEther("1"));
    expect(funded!.args.feeAmount).toBe(parseEther("0.03"));
    expect(funded!.args.netAmount).toBe(parseEther("0.97"));
    expect(funded!.args.feeRecipient).toBe(treasury.address);
  });
});
