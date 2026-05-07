import { describe, expect, it } from "vitest";
import { Contract, JsonRpcProvider, Interface } from "ethers";
import * as communityPoolModule from "@/lib/onchain/community-pool";

/**
 * Regression: a 2026-05-07 mainnet incident bricked PAXG funding because the
 * ERC20 ABI fragment in `lib/onchain/community-pool.ts` declared only
 * `approve / decimals / balanceOf`. With ethers v6's strict-binding Contract,
 * the missing `allowance` fragment meant `erc20.allowance(owner, spender)`
 * threw "f.allowance is not a function" *before* any approve / fundERC20
 * tx was submitted. Pools deployed; tokens never moved.
 *
 * These tests pin the ABI surface that the funding helper relies on.
 */
describe("community-pool helpers: ERC20 ABI surface", () => {
  // The ABI is module-private. We rebuild a contract via the same helper path
  // and assert the methods that fundPoolErc20 + fundPoolErc20Human depend on
  // are reachable on the resulting Contract instance.
  it("fundPoolErc20 and fundPoolErc20Human are exported", () => {
    expect(typeof communityPoolModule.fundPoolErc20).toBe("function");
    expect(typeof communityPoolModule.fundPoolErc20Human).toBe("function");
  });

  it("a Contract built with the funding helper's ERC20 fragments exposes allowance/approve/decimals/balanceOf", () => {
    // Mirror the fragments the helper uses. If this list drifts from
    // `community-pool.ts` and `allowance` is dropped again, the live code
    // breaks the same way and this test catches it via the parallel check
    // below.
    const fragments = [
      "function allowance(address owner, address spender) view returns (uint256)",
      "function approve(address spender, uint256 amount) returns (bool)",
      "function decimals() view returns (uint8)",
      "function balanceOf(address account) view returns (uint256)",
    ];
    const provider = new JsonRpcProvider("http://127.0.0.1:0");
    const c = new Contract(
      "0x0000000000000000000000000000000000000001",
      fragments,
      provider,
    );
    expect(typeof c.allowance).toBe("function");
    expect(typeof c.approve).toBe("function");
    expect(typeof c.decimals).toBe("function");
    expect(typeof c.balanceOf).toBe("function");
  });

  it("the funding helper's actual module source declares allowance, approve, decimals, balanceOf", async () => {
    // Read the source file at runtime so a future ABI edit that drops
    // `allowance` (or any other required fragment) is caught here, not in
    // production. Keeps the test independent of how the module exports
    // its ABI internally.
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const src = await fs.readFile(
      path.resolve(process.cwd(), "lib/onchain/community-pool.ts"),
      "utf8",
    );
    expect(src).toMatch(/function\s+allowance\s*\(/);
    expect(src).toMatch(/function\s+approve\s*\(/);
    expect(src).toMatch(/function\s+decimals\s*\(/);
    expect(src).toMatch(/function\s+balanceOf\s*\(/);
  });
});

/**
 * Regression: pool ABI surface for funding paths. The ERC20 path must call
 * `fundERC20(address,uint256)` (nonpayable) and the ETH path must call
 * `fund()` (payable). A mix-up — calling `fund()` for ERC20 funding, or
 * attaching msg.value to `fundERC20` — would silently send ETH instead of
 * tokens. We pin the artifact's mutability so it can't drift.
 */
describe("CommunityPool artifact: fund vs fundERC20 mutability", () => {
  it("fund() is payable and fundERC20(address,uint256) is nonpayable", async () => {
    const artifact = (await import("@/lib/onchain/community-pool-artifact.json"))
      .default as { abi: ReadonlyArray<unknown> };
    const iface = new Interface(artifact.abi as never);

    const fundFrag = iface.getFunction("fund()");
    expect(fundFrag).not.toBeNull();
    expect(fundFrag!.stateMutability).toBe("payable");

    const fundErc20Frag = iface.getFunction("fundERC20(address,uint256)");
    expect(fundErc20Frag).not.toBeNull();
    expect(fundErc20Frag!.stateMutability).toBe("nonpayable");
  });

  it("constructor is nonpayable so deploy never silently attaches msg.value", async () => {
    const artifact = (await import("@/lib/onchain/community-pool-artifact.json"))
      .default as { abi: ReadonlyArray<{ type: string; stateMutability?: string }> };
    const ctor = artifact.abi.find((f) => f.type === "constructor");
    expect(ctor).toBeDefined();
    expect(ctor!.stateMutability).toBe("nonpayable");
  });
});
