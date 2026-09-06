#!/usr/bin/env node
// Regenerate the runtime ABI + creation-bytecode artifact consumed by the
// Next.js app from the canonical Foundry build output, OR (with --check)
// verify that the committed artifact matches what forge-out/ currently holds.
//
// Why this exists:
//   The Next.js app imports lib/onchain/community-pool-artifact.json and
//   deploys new CommunityPools with its `bytecode`. If the committed artifact
//   drifts from the canonical build, the app deploys something other than
//   what the repository's Solidity + toolchain describe.
//
// Provenance / determinism contract (Phase 2.0):
//   - The artifact is derived exclusively from forge-out/ (never hand-edited).
//   - Only `abi` and `bytecode` (creation code) are extracted; both are
//     deterministic given the pinned toolchain in foundry.toml.
//   - Before extracting, the compiler settings recorded in the forge-out
//     metadata are asserted against the canonical configuration below, so a
//     build produced with a different solc, EVM target, optimizer setting, or
//     remapping set is rejected rather than silently baked into the artifact.
//   - CI enforces integrity as: forge clean -> forge build -> regenerate ->
//     `git diff --exit-code` against the committed file. The `--check` mode
//     here is the local equivalent (committed file vs current forge-out) and
//     must NOT be run right after a regenerate step, which would compare the
//     file to itself.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const FORGE_OUT = resolve(root, "forge-out/CommunityPool.sol/CommunityPool.json");
const ARTIFACT = resolve(root, "lib/onchain/community-pool-artifact.json");

// Canonical build configuration. Keep in sync with foundry.toml. Changing any
// of these is a deliberate, reviewed event that regenerates the artifact.
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
  compilationTarget: { "src/CommunityPool.sol": "CommunityPool" },
};

const checkMode = process.argv.includes("--check");

function fail(msg, code = 1) {
  console.error(`[sync-contract-artifact] ${msg}`);
  process.exit(code);
}

function assertCanonicalSettings(forge) {
  const md = typeof forge.metadata === "string" ? JSON.parse(forge.metadata) : forge.metadata;
  if (!md?.settings || !md?.compiler) fail("forge-out is missing compiler metadata; rebuild with `forge build`.", 2);
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
  if (JSON.stringify(s.compilationTarget) !== JSON.stringify(CANONICAL.compilationTarget)) {
    problems.push(`compilationTarget ${JSON.stringify(s.compilationTarget)}`);
  }
  if (Object.keys(s.libraries ?? {}).length) problems.push(`unexpected linked libraries ${JSON.stringify(s.libraries)}`);
  if (Object.keys(forge.bytecode?.linkReferences ?? {}).length) problems.push("unexpected linkReferences in bytecode");
  if (problems.length) {
    fail(
      "forge-out was not produced by the canonical build configuration:\n    - " +
        problems.join("\n    - ") +
        "\n  Fix foundry.toml / the toolchain (see docs/contracts-build.md) and rebuild with `forge clean && forge build`.",
      2,
    );
  }
}

function buildArtifact() {
  if (!existsSync(FORGE_OUT)) {
    fail(`forge output not found at ${FORGE_OUT}\n  Run \`forge clean && forge build\` from the communitypool/ directory first.`, 2);
  }
  const forge = JSON.parse(readFileSync(FORGE_OUT, "utf8"));
  assertCanonicalSettings(forge);
  const out = { abi: forge.abi, bytecode: forge.bytecode.object };
  // Stable serialization: no trailing newline, no extra whitespace —
  // a byte-for-byte JSON.stringify so equality checks are exact.
  return JSON.stringify(out);
}

const next = buildArtifact();

if (checkMode) {
  if (!existsSync(ARTIFACT)) {
    fail(`--check failed: ${ARTIFACT} does not exist.\n  Run \`npm run contracts:sync-artifact\` and commit the result.`);
  }
  const current = readFileSync(ARTIFACT, "utf8");
  if (current !== next) {
    fail(
      "--check failed: committed artifact does not match forge-out.\n" +
        "  The runtime ABI/bytecode imported by the Next.js app has drifted from the canonical contract build.\n" +
        "  Run `forge clean && forge build && npm run contracts:sync-artifact`, review the bytecode change, and commit the result.",
    );
  }
  console.log("[sync-contract-artifact] OK — committed artifact matches forge-out.");
  process.exit(0);
}

mkdirSync(dirname(ARTIFACT), { recursive: true });
writeFileSync(ARTIFACT, next);
console.log(`[sync-contract-artifact] wrote ${ARTIFACT}`);
