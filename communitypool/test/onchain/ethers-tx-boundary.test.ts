/**
 * ethers integration boundary — transaction-construction regression tests.
 *
 * These tests run the real `lib/onchain/community-pool.ts` helpers through
 * the real ethers `Contract` / `ContractFactory` / `Wallet` machinery against
 * an in-process JSON-RPC mock. No network, no Anvil. They pin *what the app
 * puts on the wire* — selectors, arguments, `value`, `to`, ordering of the
 * ERC-20 allowance → approve → fundERC20 sequence — so an ethers upgrade that
 * changes ABI encoding, transaction population, or Contract method binding
 * fails here rather than in a wallet prompt.
 *
 * Added during the pre-Phase-2 ethers 6.16 → 6.17 security pass.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  AbiCoder,
  Contract,
  Interface,
  JsonRpcApiProvider,
  MaxUint256,
  Network,
  Transaction,
  Wallet,
  getAddress,
  id as keccakId,
  parseUnits,
  type JsonRpcPayload,
  type JsonRpcProvider,
  type JsonRpcResult,
  type JsonRpcSigner,
} from "ethers";
import {
  assertChainMatchesExpected,
  deployCommunityPool,
  fundPoolErc20,
  fundPoolErc20Human,
  fundPoolEth,
  getPoolWhitelistedTokenAddresses,
  poolSupportsPartialWithdraw,
  withdrawPoolEth,
  withdrawPoolEthAmount,
  withdrawPoolToken,
  withdrawPoolTokenAmount,
  fundPoolErc20Exact,
} from "@/lib/onchain/community-pool";
import { weiForUsdContribution } from "@/lib/onchain/price-math";
import artifact from "@/lib/onchain/community-pool-v1-artifact.json";
import {
  AllowanceBelowAmountError,
  FundingStageError,
  classifyFundingError,
} from "@/lib/onchain/funding-errors";
import v2Artifact from "@/lib/onchain/community-pool-v2-artifact.json";

const CHAIN_ID = 31337n; // Anvil default; the only local chain pool-chain-config knows
const POOL = "0x00000000000000000000000000000000000000A1";
const TOKEN = "0x00000000000000000000000000000000000000B2";
const FEED = "0x00000000000000000000000000000000000000C3";
const PROTOCOL_CONFIG = "0x00000000000000000000000000000000000000E5";
// ETH/USD = $2,000.00000000 (8-decimal Chainlink answer)
const FEED_ANSWER = 200_000_000_000n;

const coder = AbiCoder.defaultAbiCoder();
const selector = (sig: string) => keccakId(sig).slice(0, 10);
const SEL = {
  allowance: selector("allowance(address,address)"),
  approve: selector("approve(address,uint256)"),
  decimals: selector("decimals()"),
  latestRoundData: selector("latestRoundData()"),
  getWhitelistedTokens: selector("getWhitelistedTokens()"),
  fund: selector("fund()"),
  fundERC20: selector("fundERC20(address,uint256)"),
  cheaperWithdraw: selector("cheaperWithdraw()"),
  withdraw: selector("withdraw(uint256)"),
  withdrawToken: selector("withdrawToken(address)"),
  withdrawTokenAmount: selector("withdrawTokenAmount(address,uint256)"),
};

const ZERO32 = "0x" + "00".repeat(32);
const BLOCK_HASH = "0x" + "11".repeat(32);

type SentTx = {
  hash: string;
  to: string | null;
  data: string;
  value: bigint;
  chainId: bigint;
};

/**
 * Minimal JSON-RPC backend. Implements exactly the methods ethers' Wallet +
 * Contract stack needs to populate, sign, broadcast and confirm a tx, plus
 * `eth_call` routed by selector. Everything else throws so an unexpected
 * new RPC dependency in a future ethers release is caught loudly.
 */
class MockRpc extends JsonRpcApiProvider {
  sent: SentTx[] = [];
  calls: Array<{ to: string; data: string }> = [];
  allowance = 0n;
  /** Allowance reported after an approve transaction — lets a test model an edited cap. */
  allowanceAfterApprove: bigint | null = null;
  /** Simulate the wallet rejecting the next transaction the app tries to send. */
  rejectNextSend = false;
  /** Simulate the wallet rejecting only transactions whose calldata starts with this selector. */
  rejectSendMatching: string | null = null;
  /** Simulate a non-rejection failure for transactions matching this selector. */
  failSendMatching: string | null = null;
  decimals = 18n;
  code = "0x";
  whitelisted: string[] = [];
  private nonce = 0;

  constructor() {
    super(new Network("mock", CHAIN_ID), {
      staticNetwork: true,
      batchMaxCount: 1,
      cacheTimeout: -1,
      polling: false,
    });
  }

  async _send(payload: JsonRpcPayload | JsonRpcPayload[]): Promise<JsonRpcResult[]> {
    const list = Array.isArray(payload) ? payload : [payload];
    return list.map((p) => ({ id: p.id, result: this.handle(p.method, p.params as unknown[]) }));
  }

  private handle(method: string, params: unknown[]): unknown {
    switch (method) {
      case "eth_chainId":
        return "0x" + CHAIN_ID.toString(16);
      case "eth_blockNumber":
        return "0x10";
      case "eth_getTransactionCount":
        return "0x" + this.nonce.toString(16);
      case "eth_estimateGas":
        return "0x30d40";
      case "eth_maxPriorityFeePerGas":
        return "0x3b9aca00";
      case "eth_gasPrice":
        return "0x3b9aca00";
      case "eth_getBlockByNumber":
        return {
          hash: BLOCK_HASH,
          parentHash: ZERO32,
          number: "0x10",
          timestamp: "0x64",
          nonce: "0x0000000000000000",
          difficulty: "0x0",
          gasLimit: "0x1c9c380",
          gasUsed: "0x0",
          miner: "0x0000000000000000000000000000000000000000",
          extraData: "0x",
          baseFeePerGas: "0x3b9aca00",
          transactions: [],
        };
      case "eth_getCode":
        return this.code;
      case "eth_call": {
        const tx = params[0] as { to: string; data: string };
        this.calls.push({ to: getAddress(tx.to), data: tx.data });
        const sel = tx.data.slice(0, 10);
        if (sel === SEL.allowance) return coder.encode(["uint256"], [this.allowance]);
        if (sel === SEL.decimals) return coder.encode(["uint8"], [this.decimals]);
        if (sel === SEL.latestRoundData) {
          return coder.encode(
            ["uint80", "int256", "uint256", "uint256", "uint80"],
            [1n, FEED_ANSWER, 100n, 100n, 1n],
          );
        }
        if (sel === SEL.getWhitelistedTokens) return coder.encode(["address[]"], [this.whitelisted]);
        throw new Error(`mock eth_call: unhandled selector ${sel}`);
      }
      case "eth_sendRawTransaction": {
        const tx = Transaction.from(params[0] as string);
        const rejects =
          this.rejectNextSend ||
          (this.rejectSendMatching !== null && tx.data.startsWith(this.rejectSendMatching));
        if (rejects) {
          this.rejectNextSend = false;
          throw Object.assign(new Error("user rejected action"), { code: "ACTION_REJECTED" });
        }
        if (this.failSendMatching !== null && tx.data.startsWith(this.failSendMatching)) {
          throw new Error("mock: transaction failed");
        }
        this.nonce += 1;
        const rec: SentTx = {
          hash: tx.hash!,
          to: tx.to ? getAddress(tx.to) : null,
          data: tx.data,
          value: tx.value,
          chainId: tx.chainId,
        };
        this.sent.push(rec);
        // Model a wallet applying an approval: the resulting allowance may be smaller than the
        // amount requested, because the user can edit the spending cap.
        if (rec.data.startsWith(SEL.approve) && this.allowanceAfterApprove !== null) {
          this.allowance = this.allowanceAfterApprove;
        }
        return rec.hash;
      }
      case "eth_getTransactionReceipt": {
        const hash = params[0] as string;
        const tx = this.sent.find((t) => t.hash === hash);
        if (!tx) return null;
        return {
          transactionHash: hash,
          transactionIndex: "0x0",
          blockHash: BLOCK_HASH,
          blockNumber: "0x11",
          from: "0x0000000000000000000000000000000000000000",
          to: tx.to,
          contractAddress: tx.to === null ? POOL : null,
          cumulativeGasUsed: "0x5208",
          gasUsed: "0x5208",
          effectiveGasPrice: "0x3b9aca00",
          logs: [],
          logsBloom: "0x" + "00".repeat(256),
          status: "0x1",
          type: "0x2",
        };
      }
      default:
        throw new Error(`mock rpc: unhandled method ${method}`);
    }
  }
}

/** The helpers accept a JsonRpcProvider | BrowserProvider; MockRpc is a JsonRpcApiProvider. */
const asProvider = (rpc: MockRpc) => rpc as unknown as JsonRpcProvider;

function makeSigner(rpc: MockRpc): { signer: JsonRpcSigner; address: string } {
  // Deterministic throwaway key: never funded, never used off this mock.
  const wallet = new Wallet(
    "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    rpc,
  );
  return { signer: wallet as unknown as JsonRpcSigner, address: wallet.address };
}

const erc20Iface = new Interface([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);
const poolIface = new Interface(artifact.abi);

describe("ethers boundary: provider + signer", () => {
  it("BrowserProvider-style network detection returns the mock chain id as bigint", async () => {
    const rpc = new MockRpc();
    const net = await rpc.getNetwork();
    expect(net.chainId).toBe(CHAIN_ID);
    expect(typeof net.chainId).toBe("bigint");
  });

  it("signer exposes its address and provider", async () => {
    const rpc = new MockRpc();
    const { signer, address } = makeSigner(rpc);
    expect(await signer.getAddress()).toBe(address);
    expect(signer.provider).toBe(rpc);
  });

  it("wrong-network guard rejects a mismatched chain and accepts a match", () => {
    expect(() => assertChainMatchesExpected(1n, 11155111n)).toThrow(/Wrong network/);
    expect(() => assertChainMatchesExpected(11155111n, 11155111n)).not.toThrow();
  });
});

describe("ethers boundary: ETH funding", () => {
  it("weiForUsdContribution reads latestRoundData and converts USD → wei (+1 wei rounding guard)", async () => {
    const rpc = new MockRpc();
    const { signer } = makeSigner(rpc);
    const wei = await weiForUsdContribution(signer, FEED, "25");
    // $25 at $2,000/ETH = 0.0125 ETH, +1 wei.
    expect(wei).toBe(parseUnits("0.0125", 18) + 1n);
    expect(rpc.calls.some((c) => c.to === getAddress(FEED) && c.data.startsWith(SEL.latestRoundData))).toBe(true);
  });

  it("fundPoolEth sends fund() to the pool with the USD-derived value and no calldata args", async () => {
    const rpc = new MockRpc();
    const { signer } = makeSigner(rpc);
    const tx = await fundPoolEth(signer, POOL, FEED, "25");
    expect(tx.hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(rpc.sent).toHaveLength(1);
    const sent = rpc.sent[0];
    expect(sent.to).toBe(getAddress(POOL));
    expect(sent.data).toBe(SEL.fund);
    expect(sent.value).toBe(parseUnits("0.0125", 18) + 1n);
    expect(sent.chainId).toBe(CHAIN_ID);
    // Receipt handling: wait() resolves against the mock receipt with status 1.
    const receipt = await tx.wait();
    expect(receipt?.status).toBe(1);
    expect(receipt?.hash).toBe(sent.hash);
  });
});

describe("ethers boundary: ERC-20 funding (allowance → approve → fundERC20)", () => {
  let rpc: MockRpc;
  let signer: JsonRpcSigner;
  let owner: string;
  beforeEach(() => {
    rpc = new MockRpc();
    ({ signer, address: owner } = makeSigner(rpc));
  });

  it("reads allowance(owner, pool) on the token before deciding to approve", async () => {
    rpc.allowance = MaxUint256;
    await fundPoolErc20(signer, POOL, TOKEN, 1_000n);
    const allowanceCall = rpc.calls.find((c) => c.data.startsWith(SEL.allowance));
    expect(allowanceCall).toBeDefined();
    expect(allowanceCall!.to).toBe(getAddress(TOKEN));
    const [o, s] = erc20Iface.decodeFunctionData("allowance", allowanceCall!.data);
    expect(o).toBe(owner);
    expect(s).toBe(getAddress(POOL));
  });

  it("skips approve when allowance already covers the amount and sends only fundERC20", async () => {
    rpc.allowance = 5_000n;
    await fundPoolErc20(signer, POOL, TOKEN, 1_000n);
    expect(rpc.sent).toHaveLength(1);
    expect(rpc.sent[0].to).toBe(getAddress(POOL));
    expect(rpc.sent[0].data.startsWith(SEL.fundERC20)).toBe(true);
    const [tok, amt] = poolIface.decodeFunctionData("fundERC20", rpc.sent[0].data);
    expect(tok).toBe(getAddress(TOKEN));
    expect(amt).toBe(1_000n);
    expect(rpc.sent[0].value).toBe(0n);
  });

  it("approves MaxUint256 (not the exact amount) then sends fundERC20, in that order", async () => {
    // Allowance is 0, and the wallet grants the full request.
    rpc.allowance = 0n;
    rpc.allowanceAfterApprove = MaxUint256;
    await fundPoolErc20Exact(signer, POOL, TOKEN, 1_000n);
    expect(rpc.sent).toHaveLength(2);
    const [approveTx, fundTx] = rpc.sent;
    expect(approveTx.to).toBe(getAddress(TOKEN));
    expect(approveTx.data.startsWith(SEL.approve)).toBe(true);
    const [spender, amount] = erc20Iface.decodeFunctionData("approve", approveTx.data);
    expect(spender).toBe(getAddress(POOL));
    expect(amount).toBe(MaxUint256);
    expect(fundTx.to).toBe(getAddress(POOL));
    expect(fundTx.data.startsWith(SEL.fundERC20)).toBe(true);
  });

  /**
   * Production regression (2026-09-07, PAX Gold).
   *
   * The review showed 0.000002259 PAXG; the user used MetaMask's Edit Spending Cap to approve
   * exactly that (2,259,000,000,000 raw). The old flow then re-converted the USD input, got a
   * slightly larger amount from a fresh Chainlink round, and called fundERC20 with it — PAXG
   * reverted with InsufficientAllowance() (0x13be252b) at gas estimation.
   */
  describe("exact spending cap (PAXG production regression)", () => {
    const REVIEWED_GROSS = 2_259_000_000_000n;
    const DRIFTED_GROSS = 2_259_006_291_456n; // what a fresh conversion would have produced

    it("succeeds when the approved cap exactly equals the reviewed amount", async () => {
      rpc.allowance = REVIEWED_GROSS;
      await fundPoolErc20Exact(signer, POOL, TOKEN, REVIEWED_GROSS);
      // No approval needed, and the funded amount is exactly what was reviewed.
      expect(rpc.sent).toHaveLength(1);
      const [, amt] = poolIface.decodeFunctionData("fundERC20", rpc.sent[0].data);
      expect(amt).toBe(REVIEWED_GROSS);
    });

    it("succeeds when the cap exceeds the reviewed amount", async () => {
      rpc.allowance = REVIEWED_GROSS + 1n;
      await fundPoolErc20Exact(signer, POOL, TOKEN, REVIEWED_GROSS);
      expect(rpc.sent).toHaveLength(1);
    });

    it("never funds the drifted amount the old flow would have sent", async () => {
      rpc.allowance = REVIEWED_GROSS;
      await fundPoolErc20Exact(signer, POOL, TOKEN, REVIEWED_GROSS);
      const [, amt] = poolIface.decodeFunctionData("fundERC20", rpc.sent[0].data);
      expect(amt).toBe(REVIEWED_GROSS);
      expect(amt).not.toBe(DRIFTED_GROSS);
      expect(amt).toBeLessThanOrEqual(rpc.allowance);
    });

    it("refuses before submitting when the approved cap ends up below the amount", async () => {
      // The user edits the cap down to the reviewed gross while the code asks for more.
      rpc.allowance = 0n;
      rpc.allowanceAfterApprove = REVIEWED_GROSS;
      await expect(fundPoolErc20Exact(signer, POOL, TOKEN, DRIFTED_GROSS)).rejects.toBeInstanceOf(
        AllowanceBelowAmountError,
      );
      // The approval went out; the doomed funding call never did.
      expect(rpc.sent).toHaveLength(1);
      expect(rpc.sent[0].data.startsWith(SEL.approve)).toBe(true);
      expect(rpc.sent.some((t) => t.data.startsWith(SEL.fundERC20))).toBe(false);
    });

    /**
     * Stage integration: the failing prompt must identify itself, because the modal can no longer
     * infer it. A rejected funding prompt throws before any transaction hash exists.
     */
    it("tags a rejected approval prompt as the approval stage", async () => {
      rpc.allowance = 0n;
      rpc.rejectNextSend = true;
      const err = await fundPoolErc20Exact(signer, POOL, TOKEN, REVIEWED_GROSS).catch((e) => e);
      expect(err).toBeInstanceOf(FundingStageError);
      expect(err.stage).toBe("approval");
      expect(classifyFundingError(err, "funding", "PAXG").message).toMatch(
        /cancelled the approval/i,
      );
      expect(rpc.sent).toHaveLength(0);
    });

    it("tags a rejected funding prompt as the funding stage, after a successful approval", async () => {
      rpc.allowance = 0n;
      rpc.allowanceAfterApprove = MaxUint256;
      rpc.rejectSendMatching = SEL.fundERC20;
      const err = await fundPoolErc20Exact(signer, POOL, TOKEN, REVIEWED_GROSS).catch((e) => e);
      expect(err).toBeInstanceOf(FundingStageError);
      expect(err.stage).toBe("funding");
      // The approval really did go out first — this is exactly the case the old inference got wrong.
      expect(rpc.sent).toHaveLength(1);
      expect(rpc.sent[0].data.startsWith(SEL.approve)).toBe(true);
      const message = classifyFundingError(err, "approval", "PAXG").message;
      expect(message).toMatch(/cancelled the funding transaction/i);
      expect(message).not.toMatch(/approval/i);
    });

    it("tags an unknown funding failure as the funding stage", async () => {
      rpc.allowance = REVIEWED_GROSS;
      rpc.failSendMatching = SEL.fundERC20;
      const err = await fundPoolErc20Exact(signer, POOL, TOKEN, REVIEWED_GROSS).catch((e) => e);
      expect(err.stage).toBe("funding");
      expect(classifyFundingError(err, "approval").message).toMatch(/funding transaction failed/i);
    });

    it("tags an unknown approval failure as the approval stage", async () => {
      rpc.allowance = 0n;
      rpc.failSendMatching = SEL.approve;
      const err = await fundPoolErc20Exact(signer, POOL, TOKEN, REVIEWED_GROSS).catch((e) => e);
      expect(err.stage).toBe("approval");
      expect(classifyFundingError(err, "funding").message).toMatch(/approval transaction failed/i);
    });

    it("leaves the allowance shortfall untagged so it keeps its own message", async () => {
      rpc.allowance = 0n;
      rpc.allowanceAfterApprove = REVIEWED_GROSS;
      const err = await fundPoolErc20Exact(signer, POOL, TOKEN, DRIFTED_GROSS).catch((e) => e);
      expect(err).toBeInstanceOf(AllowanceBelowAmountError);
      expect(err).not.toBeInstanceOf(FundingStageError);
    });

    it("reads the allowance back after approving instead of assuming it was granted in full", async () => {
      rpc.allowance = 0n;
      rpc.allowanceAfterApprove = REVIEWED_GROSS;
      await fundPoolErc20Exact(signer, POOL, TOKEN, REVIEWED_GROSS);
      const allowanceReads = rpc.calls.filter((c) => c.data.startsWith(SEL.allowance));
      expect(allowanceReads.length).toBeGreaterThanOrEqual(2);
      expect(rpc.sent).toHaveLength(2);
    });
  });

  it("fundPoolErc20Human scales by on-chain decimals()", async () => {
    rpc.allowance = MaxUint256;
    rpc.allowanceAfterApprove = MaxUint256;
    rpc.decimals = 8n; // WBTC-style
    await fundPoolErc20Human(signer, POOL, TOKEN, "0.5");
    const decimalsCall = rpc.calls.find((c) => c.data.startsWith(SEL.decimals));
    expect(decimalsCall?.to).toBe(getAddress(TOKEN));
    const [, amt] = poolIface.decodeFunctionData("fundERC20", rpc.sent[0].data);
    expect(amt).toBe(50_000_000n);
  });

  it("the ERC-20 fragment set still binds allowance on a strict ethers Contract (2026-05-07 PAXG regression)", () => {
    const c = new Contract(
      TOKEN,
      [
        "function allowance(address owner, address spender) view returns (uint256)",
        "function approve(address spender, uint256 amount) returns (bool)",
        "function decimals() view returns (uint8)",
        "function balanceOf(address account) view returns (uint256)",
      ],
      rpc,
    );
    expect(typeof c.allowance).toBe("function");
    expect(typeof c.approve).toBe("function");
    expect(typeof c.decimals).toBe("function");
    expect(typeof c.balanceOf).toBe("function");
    // A method not in the ABI must NOT silently exist.
    expect((c as unknown as Record<string, unknown>).transferFrom).toBeUndefined();
  });
});

describe("ethers boundary: withdrawals", () => {
  let rpc: MockRpc;
  let signer: JsonRpcSigner;
  beforeEach(() => {
    rpc = new MockRpc();
    ({ signer } = makeSigner(rpc));
  });

  it("withdrawPoolEth → cheaperWithdraw()", async () => {
    await withdrawPoolEth(signer, POOL);
    expect(rpc.sent[0].to).toBe(getAddress(POOL));
    expect(rpc.sent[0].data).toBe(SEL.cheaperWithdraw);
    expect(rpc.sent[0].value).toBe(0n);
  });

  it("withdrawPoolEthAmount → withdraw(uint256) and rejects zero", async () => {
    await withdrawPoolEthAmount(signer, POOL, 123n);
    const [amt] = poolIface.decodeFunctionData("withdraw", rpc.sent[0].data);
    expect(rpc.sent[0].data.startsWith(SEL.withdraw)).toBe(true);
    expect(amt).toBe(123n);
    await expect(withdrawPoolEthAmount(signer, POOL, 0n)).rejects.toThrow(/greater than zero/);
    expect(rpc.sent).toHaveLength(1);
  });

  it("withdrawPoolToken → withdrawToken(address)", async () => {
    await withdrawPoolToken(signer, POOL, TOKEN);
    expect(rpc.sent[0].data.startsWith(SEL.withdrawToken)).toBe(true);
    const [tok] = poolIface.decodeFunctionData("withdrawToken", rpc.sent[0].data);
    expect(tok).toBe(getAddress(TOKEN));
  });

  it("withdrawPoolTokenAmount → withdrawTokenAmount(address,uint256) and rejects zero", async () => {
    await withdrawPoolTokenAmount(signer, POOL, TOKEN, 77n);
    expect(rpc.sent[0].data.startsWith(SEL.withdrawTokenAmount)).toBe(true);
    const [tok, amt] = poolIface.decodeFunctionData("withdrawTokenAmount", rpc.sent[0].data);
    expect(tok).toBe(getAddress(TOKEN));
    expect(amt).toBe(77n);
    await expect(withdrawPoolTokenAmount(signer, POOL, TOKEN, 0n)).rejects.toThrow(/greater than zero/);
  });

  it("poolSupportsPartialWithdraw feature-detects selectors in runtime bytecode", async () => {
    rpc.code = "0x60806040" + SEL.withdraw.slice(2) + "00" + SEL.withdrawTokenAmount.slice(2);
    expect(await poolSupportsPartialWithdraw(asProvider(rpc), POOL)).toBe(true);
    rpc.code = "0x60806040" + SEL.withdraw.slice(2);
    expect(await poolSupportsPartialWithdraw(asProvider(rpc), POOL)).toBe(false);
  });

  it("getPoolWhitelistedTokenAddresses decodes address[] and checksums", async () => {
    rpc.whitelisted = [TOKEN.toLowerCase()];
    const out = await getPoolWhitelistedTokenAddresses(asProvider(rpc), POOL);
    expect(out).toEqual([getAddress(TOKEN)]);
  });
});

describe("ethers boundary: deployment", () => {
  it("deployCommunityPool encodes the V2 constructor and sends a creation tx", async () => {
    process.env.NEXT_PUBLIC_EXPECTED_CHAIN_ID = CHAIN_ID.toString();
    process.env.NEXT_PUBLIC_LOCAL_ETH_USD_FEED = FEED;
    process.env.NEXT_PUBLIC_LOCAL_PROTOCOL_CONFIG = PROTOCOL_CONFIG;
    process.env.NEXT_PUBLIC_LOCAL_ETH_USD_MAX_AGE = "7200";
    const rpc = new MockRpc();
    rpc.code = "0x60806040"; // ProtocolConfig has code, so the preflight passes
    const { signer } = makeSigner(rpc);
    const coOwner = "0x00000000000000000000000000000000000000D4";
    const { contract, deployTx } = await deployCommunityPool(signer, {
      name: "Boundary Pool",
      description: "desc",
      minimumUsdHuman: "5",
      coOwnerAddresses: [coOwner],
      expirationDateYmd: "2099-12-31",
    });
    expect(deployTx.hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(rpc.sent).toHaveLength(1);
    const sent = rpc.sent[0];
    expect(sent.to).toBeNull();
    expect(sent.value).toBe(0n);
    // New pools are V2 (Phase 2.8): creation calldata = V2 bytecode ++ abi-encoded args.
    expect(sent.data.startsWith(v2Artifact.bytecode)).toBe(true);
    expect(sent.data.startsWith(artifact.bytecode)).toBe(false);
    const ctor = new Interface(v2Artifact.abi).deploy;
    const encodedArgs = "0x" + sent.data.slice(v2Artifact.bytecode.length);
    const decoded = coder.decode(ctor.inputs, encodedArgs);
    expect(decoded[0]).toBe("Boundary Pool");
    expect(decoded[1]).toBe("desc");
    expect(decoded[2]).toBe(parseUnits("5", 18));
    expect([...decoded[3]]).toEqual([getAddress(coOwner)]);
    expect(decoded[4]).toBe(BigInt(Math.floor(Date.parse("2099-12-31T23:59:59.999Z") / 1000)));
    expect(getAddress(decoded[5])).toBe(getAddress(FEED));
    expect(Number(decoded[6])).toBe(7200);
    expect(getAddress(decoded[8])).toBe(getAddress(PROTOCOL_CONFIG));
    // Deployed address comes back from the receipt's contractAddress.
    const receipt = await deployTx.wait();
    expect(receipt?.contractAddress).toBe(getAddress(POOL));
    expect(await contract.getAddress()).toBeTruthy();
  });

  it("deployCommunityPool refuses to broadcast when the ProtocolConfig address has no code", async () => {
    // The constructor reverts on a codeless config address; catching it here means the user is
    // never charged deployment gas for a pool that cannot be created.
    process.env.NEXT_PUBLIC_EXPECTED_CHAIN_ID = CHAIN_ID.toString();
    process.env.NEXT_PUBLIC_LOCAL_ETH_USD_FEED = FEED;
    process.env.NEXT_PUBLIC_LOCAL_PROTOCOL_CONFIG = PROTOCOL_CONFIG;
    process.env.NEXT_PUBLIC_LOCAL_ETH_USD_MAX_AGE = "7200";
    const rpc = new MockRpc();
    rpc.code = "0x";
    const { signer } = makeSigner(rpc);
    await expect(
      deployCommunityPool(signer, {
        name: "x",
        description: "y",
        minimumUsdHuman: "1",
        coOwnerAddresses: [],
        expirationDateYmd: "2099-12-31",
      }),
    ).rejects.toThrow(/No ProtocolConfig contract found/i);
    expect(rpc.sent).toHaveLength(0);
  });

  it("deployCommunityPool refuses to broadcast when the chain has no configured ProtocolConfig", async () => {
    process.env.NEXT_PUBLIC_EXPECTED_CHAIN_ID = CHAIN_ID.toString();
    process.env.NEXT_PUBLIC_LOCAL_ETH_USD_FEED = FEED;
    delete process.env.NEXT_PUBLIC_LOCAL_PROTOCOL_CONFIG;
    const rpc = new MockRpc();
    rpc.code = "0x60806040";
    const { signer } = makeSigner(rpc);
    await expect(
      deployCommunityPool(signer, {
        name: "x",
        description: "y",
        minimumUsdHuman: "1",
        coOwnerAddresses: [],
        expirationDateYmd: "2099-12-31",
      }),
    ).rejects.toThrow(/No ProtocolConfig is configured/i);
    expect(rpc.sent).toHaveLength(0);
  });

  it("deployCommunityPool refuses to broadcast on a chain that does not match the build", async () => {
    process.env.NEXT_PUBLIC_EXPECTED_CHAIN_ID = "11155111";
    const rpc = new MockRpc();
    const { signer } = makeSigner(rpc);
    await expect(
      deployCommunityPool(signer, {
        name: "x",
        description: "y",
        minimumUsdHuman: "1",
        coOwnerAddresses: [],
        expirationDateYmd: "2099-12-31",
      }),
    ).rejects.toThrow(/Wrong network/);
    expect(rpc.sent).toHaveLength(0);
  });
});
