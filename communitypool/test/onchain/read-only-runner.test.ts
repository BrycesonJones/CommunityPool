/**
 * Read-only chain calls must not go through the signer.
 *
 * The Phase 2.8 production smoke test failed here. A signer runner makes ethers populate the call
 * before sending it, so the wallet receives `eth_call {from, to, data}` for a plain view. That
 * drags account/signing context into an operation with no caller, and it failed in the wallet
 * where the identical `eth_call {to, data}` succeeded from the console. These tests pin the call
 * shape so the bug cannot silently return.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { AbiCoder, BrowserProvider } from "ethers";
import { readerFor, weiForUsdContribution } from "@/lib/onchain/price-math";
import { erc20UsdToTokenAmount, erc20UsdToHumanAmountString } from "@/lib/onchain/tx-economics";
import { readChainProtocolFeeBps, readLiveProtocolFee } from "@/lib/onchain/protocol-fee";

const coder = AbiCoder.defaultAbiCoder();
const CONFIG = "0x2eD7F089a6C2971B24eA91121aD65f9242F622c0";
const ETH_USD = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419";
const PAXG_FEED = "0x9944D86CEB9160aF5C5feB251FD671923323f8C3";
const POOL = "0x00000000000000000000000000000000000000A1";
const ACCOUNT = "0x000000000000000000000000000000000000dEaD";

type Call = Record<string, unknown>;

/**
 * A wallet that answers plain view calls but rejects any `eth_call` carrying `from` — the
 * behaviour that broke production, reproduced exactly.
 */
function makeWallet(opts: { rejectFromCalls?: boolean } = {}) {
  const calls: Call[] = [];
  const eip1193 = {
    isMetaMask: true,
    async request({ method, params }: { method: string; params?: unknown[] }) {
      switch (method) {
        case "eth_chainId": return "0x1";
        case "net_version": return "1";
        case "eth_accounts":
        case "eth_requestAccounts": return [ACCOUNT];
        case "eth_blockNumber": return "0x1000";
        case "eth_call": {
          const tx = (params as [Call])[0];
          calls.push(tx);
          if (opts.rejectFromCalls && tx.from) {
            throw new Error("wallet refused eth_call carrying a from field");
          }
          const sel = String(tx.data).slice(0, 10);
          if (sel === "0x35659fb8") return coder.encode(["uint256"], [100n]); // protocolFeeBps()
          if (sel === "0xd7a2cd4c" || sel === "0xfeaf968c")
            return coder.encode(
              ["uint80", "int256", "uint256", "uint256", "uint80"],
              [1n, 250988611728n, 1788735000n, 1788735395n, 1n],
            );
          // getProtocolFeeConfig()
          return coder.encode(["uint256", "address"], [100n, ACCOUNT]);
        }
        default: throw new Error("unhandled " + method);
      }
    },
    on() {}, removeListener() {},
  };
  return { eip1193, calls };
}

async function signerFor(wallet: ReturnType<typeof makeWallet>) {
  const bp = new BrowserProvider(wallet.eip1193 as never);
  return bp.getSigner();
}

describe("readerFor", () => {
  it("prefers the signer's provider so reads carry no signing context", async () => {
    const wallet = makeWallet();
    const signer = await signerFor(wallet);
    expect(readerFor(signer)).toBe(signer.provider);
  });

  it("passes a bare provider straight through", async () => {
    const wallet = makeWallet();
    const bp = new BrowserProvider(wallet.eip1193 as never);
    expect(readerFor(bp)).toBe(bp);
  });
});

describe("read-only calls send eth_call {to, data} with no from", () => {
  let wallet: ReturnType<typeof makeWallet>;
  beforeEach(() => {
    wallet = makeWallet();
  });

  it("weiForUsdContribution omits from", async () => {
    const signer = await signerFor(wallet);
    await weiForUsdContribution(signer, ETH_USD, "0.01");
    const priceCall = wallet.calls.at(-1)!;
    expect(priceCall.from).toBeUndefined();
    expect(Object.keys(priceCall).sort()).toEqual(["data", "to"]);
  });

  it("erc20UsdToTokenAmount omits from", async () => {
    const signer = await signerFor(wallet);
    await erc20UsdToTokenAmount(signer, { usdFeed: PAXG_FEED, decimals: 18 }, "0.01");
    expect(wallet.calls.at(-1)!.from).toBeUndefined();
  });

  it("protocol-fee reads omit from", async () => {
    const signer = await signerFor(wallet);
    await readChainProtocolFeeBps(signer.provider!, CONFIG);
    await readLiveProtocolFee(signer.provider!, POOL);
    expect(wallet.calls.every((c) => c.from === undefined)).toBe(true);
  });
});

describe("regression: the exact production failure", () => {
  it("a wallet that rejects from-bearing eth_call can still price a contribution", async () => {
    const wallet = makeWallet({ rejectFromCalls: true });
    const signer = await signerFor(wallet);
    // Before the fix this threw and the deploy review reported a protocol-fee failure.
    const wei = await weiForUsdContribution(signer, ETH_USD, "0.01");
    expect(wei).toBeGreaterThan(0n);
    // $0.01 at $2509.88611728/ETH -> ~3.98e12 wei.
    expect(wei).toBeGreaterThan(3_900_000_000_000n);
    expect(wei).toBeLessThan(4_100_000_000_000n);
  });

  it("the same wallet can read the protocol fee and an ERC20 price", async () => {
    const wallet = makeWallet({ rejectFromCalls: true });
    const signer = await signerFor(wallet);
    expect(await readChainProtocolFeeBps(signer.provider!, CONFIG)).toBe(100n);
    expect(
      await erc20UsdToHumanAmountString(signer, { usdFeed: PAXG_FEED, decimals: 18 }, "0.01"),
    ).not.toBeNull();
  });

  it("$0.01 of ETH converts to a non-zero wei amount", async () => {
    const wallet = makeWallet();
    const signer = await signerFor(wallet);
    const wei = await weiForUsdContribution(signer, ETH_USD, "0.01");
    expect(wei > 0n).toBe(true);
  });
});
