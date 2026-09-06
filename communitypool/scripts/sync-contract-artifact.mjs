#!/usr/bin/env node
// Regenerate the CANDIDATE contract artifacts consumed by the Next.js app from
// the canonical Foundry build output, OR (with --check) verify that the
// committed V2 artifacts match what forge-out/ currently holds.
//
// Artifact/version boundary (Phase 2.1):
//   lib/onchain/community-pool-v1-artifact.json
//       FROZEN. The production deployment artifact (creation bytecode keccak
//       0xf564efc7…0c98). This script NEVER writes it. Its hash is guarded by
//       scripts/check-frozen-v1-artifact.mjs; changing it is an explicit,
//       reviewed event.
//   lib/onchain/community-pool-v2-artifact.json
//       Generated here from the current src/CommunityPool.sol. Candidate only:
//       not used by production deployment until an explicit activation phase.
//   lib/onchain/protocol-config-artifact.json
//       Generated here from src/ProtocolConfig.sol. Candidate only.
//
// Provenance / determinism contract (Phase 2.0):
//   - Candidates are derived exclusively from forge-out/ (never hand-edited).
//   - Only `abi` and `bytecode` (creation code) are extracted; both are
//     deterministic given the pinned toolchain in foundry.toml.
//   - Before extracting, the compiler settings recorded in the forge-out
//     metadata are asserted against the canonical configuration below, so a
//     build produced with a different solc, EVM target, optimizer setting, or
//     remapping set is rejected rather than silently baked into an artifact.
//   - CI enforces integrity as: forge clean -> forge build -> regenerate ->
//     `git diff --exit-code` against the committed artifact files. The
//     `--check` mode here is the local equivalent (committed files vs current
//     forge-out) and must NOT be run right after a regenerate step, which would
//     compare the files to themselves.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const FROZEN_V1_ARTIFACT = resolve(root, "lib/onchain/community-pool-v1-artifact.json");

const TARGETS = [
  {
    label: "CommunityPool V2",
    forgeOut: resolve(root, "forge-out/CommunityPool.sol/CommunityPool.json"),
    artifact: resolve(root, "lib/onchain/community-pool-v2-artifact.json"),
    compilationTarget: { "src/CommunityPool.sol": "CommunityPool" },
  },
  {
    label: "ProtocolConfig",
    forgeOut: resolve(root, "forge-out/ProtocolConfig.sol/ProtocolConfig.json"),
    artifact: resolve(root, "lib/onchain/protocol-config-artifact.json"),
    compilationTarget: { "src/ProtocolConfig.sol": "ProtocolConfig" },
  },
];

// Canonical build configuration. Keep in sync with foundry.toml. Changing any
// of these is a deliberate, reviewed event that regenerates them.
const CANONICAL = {
  compilerVersion: "0.8.26+commit.8a97fa7a",
  evmVersion: "cancun",
  optimizer: { enabled: true, runs: 200 },
  viaIR: false,
  bytecodeHash: "ipfs",
  remappings: [
    "@chainlink/contracts/=lib/chainlink-brownie-contracts/contracts/",
    "@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/",
    "forge-std/=lib/forge-std/src/",
    "foundry-devops/=lib/foundry-devops/",
  ],
};

const checkMode = process.argv.includes("--check");

function fail(msg, code = 1) {
  console.error(`[sync-contract-artifact] ${msg}`);
  process.exit(code);
}

for (const t of TARGETS) {
  if (t.artifact === FROZEN_V1_ARTIFACT) fail("refusing to target the frozen V1 artifact", 2);
}

function assertCanonicalSettings(forge, target) {
  const md = typeof forge.metadata === "string" ? JSON.parse(forge.metadata) : forge.metadata;
  if (!md?.settings || !md?.compiler) {
    fail(`${target.label}: forge-out is missing compiler metadata; rebuild with \`forge build\`.`, 2);
  }
  const s = md.settings;
  const problems = [];
  if (md.compiler.version !== CANONICAL.compilerVersion) {
    problems.push(`compiler ${md.compiler.version} != ${CANONICAL.compilerVersion}`);
  }
  if (s.evmVersion !== CANONICAL.evmVersion) problems.push(`evmVersion ${s.evmVersion} != ${CANONICAL.evmVersion}`);
  if (s.optimizer?.enabled !== CANONICAL.optimizer.enabled || s.optimizer?.runs !== CANONICAL.optimizer.runs) {
    problems.push(`optimizer ${JSON.stringify(s.optimizer)} != ${JSON.stringify(CANONICAL.optimizer)}`);
  }
  if (Boolean(s.viaIR) !== CANONICAL.viaIR) problems.push(`viaIR ${s.viaIR} != ${CANONICAL.viaIR}`);
  if (s.metadata?.bytecodeHash !== CANONICAL.bytecodeHash) {
    problems.push(`bytecodeHash ${s.metadata?.bytecodeHash} != ${CANONICAL.bytecodeHash}`);
  }
  const remappings = [...(s.remappings ?? [])].sort();
  const expected = [...CANONICAL.remappings].sort();
  if (JSON.stringify(remappings) !== JSON.stringify(expected)) {
    problems.push(
      `remappings differ from canonical set (auto-detected or extra remappings change the metadata hash):\n` +
        `      got      ${JSON.stringify(remappings)}\n` +
        `      expected ${JSON.stringify(expected)}`,
    );
  }
  if (JSON.stringify(s.compilationTarget) !== JSON.stringify(target.compilationTarget)) {
    problems.push(`compilationTarget ${JSON.stringify(s.compilationTarget)}`);
  }
  if (Object.keys(s.libraries ?? {}).length) problems.push(`unexpected linked libraries ${JSON.stringify(s.libraries)}`);
  if (Object.keys(forge.bytecode?.linkReferences ?? {}).length) problems.push("unexpected linkReferences in bytecode");
  if (problems.length) {
    fail(
      `${target.label}: forge-out was not produced by the canonical build configuration:\n    - ` +
        problems.join("\n    - ") +
        "\n  Fix foundry.toml / the toolchain (see docs/contracts-build.md) and rebuild with `forge clean && forge build`.",
      2,
    );
  }
}

function buildArtifact(target) {
  if (!existsSync(target.forgeOut)) {
    fail(
      `${target.label}: forge output not found at ${target.forgeOut}\n  Run \`forge clean && forge build\` from the communitypool/ directory first.`,
      2,
    );
  }
  const forge = JSON.parse(readFileSync(target.forgeOut, "utf8"));
  assertCanonicalSettings(forge, target);
  const out = { abi: forge.abi, bytecode: forge.bytecode.object };
  // Stable serialization: no trailing newline, no extra whitespace —
  // a byte-for-byte JSON.stringify so equality checks are exact.
  return JSON.stringify(out);
}

let failed = false;
for (const target of TARGETS) {
  const next = buildArtifact(target);
  if (checkMode) {
    if (!existsSync(target.artifact)) {
      console.error(`[sync-contract-artifact] --check failed: ${target.artifact} does not exist.`);
      failed = true;
      continue;
    }
    const current = readFileSync(target.artifact, "utf8");
    if (current !== next) {
      console.error(
        `[sync-contract-artifact] --check failed: ${target.label} committed artifact does not match forge-out.\n` +
          "  Run `forge clean && forge build && npm run contracts:sync-artifact`, review the bytecode change, and commit the result.",
      );
      failed = true;
      continue;
    }
    console.log(`[sync-contract-artifact] OK — ${target.label} artifact matches forge-out.`);
  } else {
    mkdirSync(dirname(target.artifact), { recursive: true });
    writeFileSync(target.artifact, next);
    console.log(`[sync-contract-artifact] wrote ${target.artifact}`);
  }
}
if (failed) process.exit(1);
