import { describe, it, expect, beforeAll } from "vitest";
import {
  Contract,
  type JsonRpcSigner,
  JsonRpcProvider,
  Wallet,
  parseEther,
} from "ethers";
import { deployCommunityPool } from "@/lib/onchain/community-pool";
import { readPoolSnapshotFromChain } from "@/lib/pools/pool-activity-service";
import { readPoolOnChainBalances } from "@/lib/onchain/pool-balances";

const FUND_ABI = ["function fund() payable", "function withdraw(uint256 amount)"] as const;

const RPC = process.env.ANVIL_RPC_URL?.trim();
const FEED = process.env.ANVIL_ETH_USD_FEED?.trim();

const run = Boolean(RPC && FEED);

/**
 * `cacheTimeout: -1` disables ethers' short-lived (250 ms) JSON-RPC response
 * cache. With a local `Wallet` signer on instant-mining Anvil, two txs sent
 * within that window would otherwise both populate from the same cached
 * `eth_getTransactionCount` and collide on the nonce. This is identical on
 * ethers 6.16 and 6.17 and does not affect the app, whose browser wallet
 * assigns nonces itself.
 */

/**
 * Integration: start Anvil, deploy a mock ETH/USD feed (e.g. forge script / HelperConfig),
 * set ANVIL_ETH_USD_FEED and ANVIL_RPC_URL, then:
 *   npm run test -- test/app/anvil-community-pool.integration.test.ts
 */
describe.skipIf(!run)("anvil: deploy CommunityPool + read on-chain snapshot", () => {
  beforeAll(() => {
    if (!FEED) return;
    process.env.NEXT_PUBLIC_LOCAL_ETH_USD_FEED = FEED;
    // Match the chain-id deploy guard: this Anvil instance reports chain 31337 (Anvil default).
    process.env.NEXT_PUBLIC_EXPECTED_CHAIN_ID = "31337";
  });

  it("deploys a pool and readPoolSnapshotFromChain returns metadata", async () => {
    const provider = new JsonRpcProvider(RPC!, undefined, { cacheTimeout: -1 });
    // Public Anvil default development key (account #0). Funded with
    // 10000 test ETH on every fresh `anvil` run; documented at
    // https://book.getfoundry.sh/anvil/#default-accounts. NOT a secret.
    // Never copy this pattern — or any raw `--private-key` literal — to a
    // testnet, staging, or mainnet deploy path. Those must use a hardware
    // wallet or an encrypted Foundry keystore.
    // See docs/security/mainnet-deployment-key-policy.md.
    const pk =
      process.env.ANVIL_PRIVATE_KEY?.trim() ??
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    const signer = new Wallet(pk, provider) as unknown as JsonRpcSigner;
    const net = await provider.getNetwork();
    expect(net.chainId).toBe(31337n);

    const { contract, deployTx } = await deployCommunityPool(signer, {
      name: "Vitest Pool",
      description: "integration",
      minimumUsdHuman: "5",
      coOwnerAddresses: [],
      expirationDateYmd: "2099-12-31",
    });
    // Wait for inclusion before reading, exactly as the deploy modal does.
    const deployReceipt = await deployTx.wait();
    expect(deployReceipt?.status).toBe(1);
    const addr = await contract.getAddress();
    expect(deployReceipt?.contractAddress).toBe(addr);
    const snap = await readPoolSnapshotFromChain(provider, addr);
    expect(snap.expiresAtUnix).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(snap.minimumUsdWei).toBe("5000000000000000000");
  });

  it("readPoolOnChainBalances accumulates across multiple fund txs and reflects withdrawals", async () => {
    const provider = new JsonRpcProvider(RPC!, undefined, { cacheTimeout: -1 });
    // Public Anvil default development key — see note on the previous test.
    // NOT a secret; only valid against a local `anvil` chain. Mainnet must
    // use a hardware wallet or encrypted Foundry keystore.
    const pk =
      process.env.ANVIL_PRIVATE_KEY?.trim() ??
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    const signer = new Wallet(pk, provider) as unknown as JsonRpcSigner;
    const net = await provider.getNetwork();
    const chainId = Number(net.chainId);

    const { contract, deployTx } = await deployCommunityPool(signer, {
      name: "Vitest Pool Funding",
      description: "funding integration",
      minimumUsdHuman: "1",
      coOwnerAddresses: [],
      expirationDateYmd: "2099-12-31",
    });
    // The app never funds before the deploy receipt lands; a Wallet signer
    // that sends the next tx before inclusion re-uses the pending nonce on
    // Anvil (identical on ethers 6.16 and 6.17), so wait here too.
    await deployTx.wait();
    const addr = await contract.getAddress();
    const fundable = new Contract(addr, FUND_ABI, signer);

    // Initial: whatever was contributed at deploy (0 if deploy doesn't fund).
    const initial = await readPoolOnChainBalances(provider, chainId, addr);
    const initialRaw = initial.nativeEth.raw;

    const fundAmt = parseEther("0.01");
    const t1 = await fundable.fund({ value: fundAmt });
    await t1.wait();
    const afterFirst = await readPoolOnChainBalances(provider, chainId, addr);
    expect(afterFirst.nativeEth.raw).toBe(initialRaw + fundAmt);

    const t2 = await fundable.fund({ value: fundAmt });
    await t2.wait();
    const afterSecond = await readPoolOnChainBalances(provider, chainId, addr);
    // Key invariant: repeated funding MUST accumulate, not overwrite.
    expect(afterSecond.nativeEth.raw).toBe(initialRaw + fundAmt * 2n);

    const t3 = await fundable.fund({ value: fundAmt });
    await t3.wait();
    const afterThird = await readPoolOnChainBalances(provider, chainId, addr);
    expect(afterThird.nativeEth.raw).toBe(initialRaw + fundAmt * 3n);

    const partialWithdraw = parseEther("0.02");
    const w1 = await fundable.withdraw(partialWithdraw);
    await w1.wait();
    const afterWithdraw = await readPoolOnChainBalances(provider, chainId, addr);
    expect(afterWithdraw.nativeEth.raw).toBe(initialRaw + fundAmt * 3n - partialWithdraw);

    // No ERC20s on local anvil: totalUsd == nativeEth.usd (no token rows).
    expect(afterWithdraw.tokens).toHaveLength(0);
    expect(afterWithdraw.totalUsd).toBeCloseTo(afterWithdraw.nativeEth.usd, 6);
    expect(afterWithdraw.blockNumber).toBeGreaterThan(afterFirst.blockNumber);
  });
});
