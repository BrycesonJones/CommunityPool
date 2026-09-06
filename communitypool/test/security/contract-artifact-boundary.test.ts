/**
 * V1 / V2 contract artifact boundary.
 *
 * Production deploys CommunityPools from the FROZEN V1 artifact. The V2
 * candidate (ProtocolConfig-aware constructor) and the ProtocolConfig
 * candidate are generated from source but must not be wired into the
 * production deploy path until an explicit activation phase. These tests fail
 * if the frozen artifact drifts, if the deploy helper switches artifacts, or
 * if the candidate artifacts lose the shape a future activation relies on.
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

  it("is the artifact the production deploy helper imports", () => {
    const helper = fs.readFileSync(path.join(repoRoot, "lib/onchain/community-pool.ts"), "utf8");
    expect(helper).toMatch(/from\s+"\.\/community-pool-v1-artifact\.json"/);
    // Only actual module references count; prose comments may mention the candidate.
    expect(helper).not.toMatch(/candidate-artifact\.json|community-pool-v2-candidate"/);
    // No other production module reaches for a candidate artifact either.
    const prodDirs = ["app", "components", "lib"];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(e.name) && !full.endsWith("community-pool-v2-candidate.ts")) {
          const src = fs.readFileSync(full, "utf8");
          if (/candidate-artifact\.json|community-pool-v2-candidate"/.test(src)) offenders.push(path.relative(repoRoot, full));
        }
      }
    };
    prodDirs.forEach((d) => walk(path.join(repoRoot, d)));
    expect(offenders).toEqual([]);
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
  const v2 = read("lib/onchain/community-pool-v2-candidate-artifact.json");
  const cfg = read("lib/onchain/protocol-config-candidate-artifact.json");

  it("V2 constructor takes the ProtocolConfig address as its 8th argument", () => {
    const iface = new Interface(v2.abi);
    const inputs = iface.deploy.inputs.map((i) => i.type);
    expect(inputs).toEqual(["string", "string", "uint256", "address[]", "uint64", "address", "tuple[]", "address"]);
    expect(iface.deploy.inputs[7].name).toBe("protocolConfig_");
  });

  it("V2 exposes the live config read and the immutable reference; V1 does not", () => {
    const v1 = read("lib/onchain/community-pool-v1-artifact.json");
    const names = (a: Array<{ type: string; name?: string }>) => a.filter((x) => x.type === "function").map((x) => x.name);
    expect(names(v2.abi)).toEqual(expect.arrayContaining(["getProtocolFeeConfig", "protocolConfig"]));
    expect(names(v1.abi)).not.toContain("getProtocolFeeConfig");
    expect(names(v1.abi)).not.toContain("protocolConfig");
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
