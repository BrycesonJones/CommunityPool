/**
 * V1 / V2 contract artifact boundary.
 *
 * Since Phase 2.8 new pools deploy the V2 artifact. The frozen V1 artifact must still never
 * change — existing V1 pools are live user contracts and the app keeps its ABI to read and
 * interact with them — but it must never be deployed again. These tests fail if the frozen
 * artifact drifts, if the deploy path stops using V2 or starts re-deploying V1, or if the V2
 * artifact loses the shape the funding UI and the mainnet canary rely on.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { keccak256, Interface } from "ethers";
import {
  checkFrozenV1Artifact,
  FROZEN_V1_CREATION_BYTECODE_KECCAK,
} from "../../scripts/check-frozen-v1-artifact.mjs";

const repoRoot = path.resolve(__dirname, "../..");
const read = (rel: string) => JSON.parse(fs.readFileSync(path.join(repoRoot, rel), "utf8"));

describe("frozen V1 production artifact", () => {
  it("has the pinned creation bytecode hash and V1 shape", () => {
    expect(checkFrozenV1Artifact()).toEqual([]);
    const v1 = read("lib/onchain/community-pool-v1-artifact.json");
    expect(keccak256(v1.bytecode)).toBe(FROZEN_V1_CREATION_BYTECODE_KECCAK);
    expect(FROZEN_V1_CREATION_BYTECODE_KECCAK).toBe(
      "0xf564efc7c38adc4016e2e09b431d33797f597d4e0fb174bd818bebafb4060c98",
    );
  });

  it("is kept for interacting with existing V1 pools but is never deployed again", () => {
    const helper = fs.readFileSync(path.join(repoRoot, "lib/onchain/community-pool.ts"), "utf8");
    // Still imported: existing V1 pools are live contracts the app must read and drive.
    expect(helper).toMatch(/from\s+"\.\/community-pool-v1-artifact\.json"/);
    // New deployments use V2 only.
    expect(helper).toMatch(/COMMUNITY_POOL_V2_ARTIFACT\.bytecode/);
    expect(helper).not.toMatch(/new ContractFactory\(\s*artifact\.abi/);
  });

  it("does not mention the intended mainnet admin/treasury addresses anywhere in production code", () => {
    const needles = ["0xD57Eb1eBebB688914974742d24997A8E491A92DA", "0x826fFBd71350b9d1Ed3c23d9f48f92a061b2C222"].map((a) => a.toLowerCase());
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.(ts|tsx|sol|mjs|json)$/.test(e.name)) {
          const src = fs.readFileSync(full, "utf8").toLowerCase();
          if (needles.some((n) => src.includes(n))) offenders.push(path.relative(repoRoot, full));
        }
      }
    };
    ["app", "components", "lib/onchain", "lib/pools", "src", "script", "scripts"].forEach((d) => walk(path.join(repoRoot, d)));
    expect(offenders).toEqual([]);
  });
});

describe("V2 candidate artifacts (not activated)", () => {
  const v2 = read("lib/onchain/community-pool-v2-artifact.json");
  const cfg = read("lib/onchain/protocol-config-artifact.json");

  it("V2 constructor takes ethUsdMaxPriceAge (7th) and the ProtocolConfig address (9th)", () => {
    const iface = new Interface(v2.abi);
    const inputs = iface.deploy.inputs.map((i) => i.type);
    expect(inputs).toEqual([
      "string",
      "string",
      "uint256",
      "address[]",
      "uint64",
      "address",
      "uint32",
      "tuple[]",
      "address",
    ]);
    expect(iface.deploy.inputs[6].name).toBe("ethUsdMaxPriceAge");
    expect(iface.deploy.inputs[8].name).toBe("protocolConfig_");
    const tokenConfig = iface.deploy.inputs[7].arrayChildren!;
    expect(tokenConfig.components!.map((c) => c.name)).toEqual(["token", "usdFeed", "decimals", "maxPriceAge"]);
  });

  it("V2 exposes the live config read and the immutable reference; V1 does not", () => {
    const v1 = read("lib/onchain/community-pool-v1-artifact.json");
    const names = (a: Array<{ type: string; name?: string }>) => a.filter((x) => x.type === "function").map((x) => x.name);
    expect(names(v2.abi)).toEqual(
      expect.arrayContaining(["getProtocolFeeConfig", "protocolConfig", "getEthUsdFeed", "getTokenInfo"]),
    );
    expect(names(v1.abi)).not.toContain("getProtocolFeeConfig");
    expect(names(v1.abi)).not.toContain("protocolConfig");
  });

  it("oracle thresholds are immutable: no setter on V2, no oracle authority on ProtocolConfig", () => {
    const fns = (a: Array<{ type: string; name?: string }>) =>
      a.filter((x) => x.type === "function").map((x) => x.name ?? "");
    const oracleish = /price|oracle|feed|age|decimal/i;
    // V2 exposes only read views for its oracle configuration.
    for (const fn of fns(v2.abi)) {
      if (oracleish.test(fn)) expect(["getEthUsdFeed", "getTokenInfo", "getProtocolFeeConfig"]).toContain(fn);
    }
    expect(fns(v2.abi).some((fn) => /^set/i.test(fn))).toBe(false);
    // ProtocolConfig gained no oracle-related function in Phase 2.6.
    for (const fn of fns(cfg.abi)) expect(oracleish.test(fn.replace("feeRecipient", "").replace("FeeRecipient", ""))).toBe(false);
    // The typed oracle errors are part of the V2 ABI (consumers can decode them).
    const errors = v2.abi.filter((x: { type: string }) => x.type === "error").map((x: { name: string }) => x.name);
    expect(errors).toEqual(
      expect.arrayContaining([
        "PriceConverter__InvalidPrice",
        "PriceConverter__IncompleteRound",
        "PriceConverter__FutureTimestamp",
        "PriceConverter__StalePrice",
        "PriceConverter__UnsupportedFeedDecimals",
        "PriceConverter__InvalidMaxPriceAge",
      ]),
    );
  });

  it("V2 keeps every V1 pool function (no withdrawal/funding surface removed)", () => {
    const v1 = read("lib/onchain/community-pool-v1-artifact.json");
    const names = (a: Array<{ type: string; name?: string }>) => a.filter((x) => x.type === "function").map((x) => x.name).sort();
    for (const fn of names(v1.abi)) expect(names(v2.abi)).toContain(fn);
  });

  it("V2 and V1 have different creation bytecode (V2 is a different contract)", () => {
    const v1 = read("lib/onchain/community-pool-v1-artifact.json");
    expect(keccak256(v2.bytecode)).not.toBe(keccak256(v1.bytecode));
  });

  it("ProtocolConfig candidate exposes only configuration authority", () => {
    const fns = cfg.abi.filter((x: { type: string }) => x.type === "function").map((x: { name: string }) => x.name).sort();
    expect(fns).toEqual(
      [
        "BPS_DENOMINATOR",
        "MAX_PROTOCOL_FEE_BPS",
        "acceptAdmin",
        "admin",
        "feeRecipient",
        "pendingAdmin",
        "protocolFeeBps",
        "setFeeRecipient",
        "setProtocolFeeBps",
        "transferAdmin",
      ].sort(),
    );
    // No custody surface: nothing payable, no receive/fallback.
    expect(cfg.abi.some((x: { stateMutability?: string; type: string }) => x.stateMutability === "payable")).toBe(false);
    expect(cfg.abi.some((x: { type: string }) => x.type === "receive" || x.type === "fallback")).toBe(false);
  });
});
