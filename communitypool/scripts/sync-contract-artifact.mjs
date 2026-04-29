#!/usr/bin/env node
// Regenerate the runtime ABI + bytecode artifact consumed by the Next.js app
// from the Foundry build output, OR (with --check) verify that the committed
// artifact matches what `forge build` just produced.
//
// Why this exists:
//   The Next.js app imports lib/onchain/community-pool-artifact.json at
//   runtime. If the committed artifact drifts from `forge-out/`, the
//   deployed contract bytecode won't match what the app deploys against.
//   The CI `--check` mode is the deterministic guard.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const FORGE_OUT = resolve(root, "forge-out/CommunityPool.sol/CommunityPool.json");
const ARTIFACT = resolve(root, "lib/onchain/community-pool-artifact.json");

const checkMode = process.argv.includes("--check");

function buildArtifact() {
  if (!existsSync(FORGE_OUT)) {
    console.error(
      `[sync-contract-artifact] forge output not found at ${FORGE_OUT}\n` +
        "Run `forge build` from the communitypool/ directory first.",
    );
    process.exit(2);
  }
  const forge = JSON.parse(readFileSync(FORGE_OUT, "utf8"));
  const out = { abi: forge.abi, bytecode: forge.bytecode.object };
  // Stable serialization: no trailing newline, no extra whitespace —
  // a byte-for-byte JSON.stringify so `--check` can use exact equality.
  return JSON.stringify(out);
}

const next = buildArtifact();

if (checkMode) {
  if (!existsSync(ARTIFACT)) {
    console.error(
      `[sync-contract-artifact] --check failed: ${ARTIFACT} does not exist.\n` +
        "Run `npm run contracts:sync-artifact` and commit the result.",
    );
    process.exit(1);
  }
  const current = readFileSync(ARTIFACT, "utf8");
  if (current !== next) {
    console.error(
      "[sync-contract-artifact] --check failed: committed artifact does not match forge-out.\n" +
        "The runtime ABI/bytecode imported by the Next.js app has drifted from the contract source.\n" +
        "Run `forge build && npm run contracts:sync-artifact` and commit the result.",
    );
    process.exit(1);
  }
  console.log("[sync-contract-artifact] OK — committed artifact matches forge-out.");
  process.exit(0);
}

mkdirSync(dirname(ARTIFACT), { recursive: true });
writeFileSync(ARTIFACT, next);
console.log(`[sync-contract-artifact] wrote ${ARTIFACT}`);
