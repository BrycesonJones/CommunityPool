#!/usr/bin/env node
// Lightweight supply-chain guards run in CI (and locally via
// `npm run supply-chain:check`). Each check returns a non-zero exit code
// on failure. Keep this script dependency-free so it works on a fresh
// `npm ci --ignore-scripts` install.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "..");
const repoRoot = resolve(appRoot, "..");

const failures = [];
const fail = (id, msg) => failures.push({ id, msg });
const ok = (msg) => console.log(`  ok    — ${msg}`);

function tryGit(args) {
  try {
    return execSync(`git ${args}`, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

// 1. package.json must declare packageManager and engines.node.
{
  const pkg = JSON.parse(readFileSync(join(appRoot, "package.json"), "utf8"));
  if (!pkg.packageManager) {
    fail("packageManager-missing", "package.json is missing `packageManager`.");
  } else {
    ok(`packageManager pinned (${pkg.packageManager})`);
  }
  if (!pkg.engines || !pkg.engines.node) {
    fail("engines-node-missing", "package.json is missing `engines.node`.");
  } else {
    ok(`engines.node pinned (${pkg.engines.node})`);
  }
  if (!pkg.engines || !pkg.engines.npm) {
    fail("engines-npm-missing", "package.json is missing `engines.npm`.");
  } else {
    ok(`engines.npm pinned (${pkg.engines.npm})`);
  }
}

// 2. Lockfile-drift: package-lock.json should never change without
//    package.json also changing in the same diff. Compares against the
//    PR base when running in GitHub Actions, otherwise against `main`.
{
  const base =
    process.env.GITHUB_BASE_REF ||
    process.env.GITHUB_DEFAULT_BRANCH ||
    "main";
  const baseRef = tryGit(`merge-base HEAD origin/${base}`)
    ? `origin/${base}`
    : tryGit(`rev-parse --verify ${base}`)
      ? base
      : null;
  if (!baseRef) {
    ok(`lockfile-drift skipped (no ${base} branch reachable)`);
  } else {
    const changed = tryGit(`diff --name-only ${baseRef}...HEAD`) || "";
    const files = changed.split("\n").filter(Boolean);
    const lockChanged = files.includes("communitypool/package-lock.json");
    const pkgChanged = files.includes("communitypool/package.json");
    if (lockChanged && !pkgChanged) {
      fail(
        "lockfile-drift",
        "communitypool/package-lock.json changed but communitypool/package.json did not. " +
          "Lockfile-only mutations are a supply-chain red flag — confirm the change is intentional.",
      );
    } else {
      ok("lockfile-drift check passed");
    }
  }
}

// 3. No secret-shaped files committed (.env*, *.pem, *.key, *_rsa, etc).
{
  const tracked = (tryGit("ls-files") || "").split("\n").filter(Boolean);
  const allowed = new Set(["communitypool/.env.example"]);
  const secretPatterns = [
    /(^|\/)\.env(\.[^.]+)?$/,
    /\.pem$/,
    /\.key$/,
    /(^|\/)id_(rsa|ed25519|ecdsa)(\.pub)?$/,
    /\.p12$/,
    /\.pfx$/,
    /(^|\/)credentials(\.[^.]+)?$/,
    /(^|\/)secrets?\.json$/,
  ];
  const offenders = tracked.filter(
    (f) => !allowed.has(f) && secretPatterns.some((re) => re.test(f)),
  );
  if (offenders.length) {
    fail(
      "secret-shaped-file",
      "Secret-shaped files are tracked by git:\n  - " + offenders.join("\n  - "),
    );
  } else {
    ok("no secret-shaped files in the index");
  }
}

// 4. Root-level debug/investigation scripts must not exist.
{
  const offenders = [];
  const scan = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      // Skip directories that legitimately contain test/debug code.
      if (
        name === "node_modules" ||
        name === ".git" ||
        name === ".next" ||
        name === "forge-out" ||
        name === "broadcast" ||
        name === "lib"
      )
        continue;
      const full = join(dir, name);
      let s;
      try {
        s = statSync(full);
      } catch {
        continue;
      }
      if (s.isDirectory()) continue;
      if (/_investigate.*\.m?js$|debug.*\.m?js$/.test(name)) {
        offenders.push(relative(repoRoot, full));
      }
    }
  };
  scan(appRoot);
  scan(repoRoot);
  if (offenders.length) {
    fail(
      "debug-script-present",
      "Debug/investigation scripts present at root — should be deleted or gitignored:\n  - " +
        offenders.join("\n  - "),
    );
  } else {
    ok("no root-level debug/investigate scripts");
  }
}

// 5. Mainnet build must not use testnet chain IDs or testnet-only token vars.
{
  const expected = process.env.NEXT_PUBLIC_EXPECTED_CHAIN_ID;
  if (process.env.MAINNET === "1" || process.env.NODE_ENV === "production") {
    if (!expected) {
      fail(
        "mainnet-chain-id-missing",
        "MAINNET=1 set but NEXT_PUBLIC_EXPECTED_CHAIN_ID is not. Mainnet build must pin chain id 1.",
      );
    } else if (expected !== "1") {
      fail(
        "mainnet-chain-id-wrong",
        `MAINNET=1 but NEXT_PUBLIC_EXPECTED_CHAIN_ID=${expected}. Refusing to build a "mainnet" bundle pointed at a testnet.`,
      );
    } else {
      ok("mainnet chain id pinned to 1");
    }
    // Block testnet-only token env vars from leaking into mainnet bundles.
    const testnetVars = Object.keys(process.env).filter((k) =>
      k.startsWith("NEXT_PUBLIC_SEPOLIA_"),
    );
    if (testnetVars.length) {
      fail(
        "mainnet-testnet-vars",
        "Sepolia env vars present in a mainnet build:\n  - " + testnetVars.join("\n  - "),
      );
    } else {
      ok("no Sepolia env vars in mainnet build");
    }
  } else {
    ok("mainnet checks skipped (not a mainnet build)");
  }
}

// 6. High/critical production-dep advisories should be zero. We don't
//    re-run `npm audit` here because CI already does — but we can sanity
//    check that the lockfile exists and is committed when CI runs.
{
  const lock = join(appRoot, "package-lock.json");
  if (!existsSync(lock)) {
    fail("lockfile-missing", "communitypool/package-lock.json is missing.");
  } else {
    ok("lockfile present");
  }
}

if (failures.length) {
  console.error("\nsupply-chain:check FAILED");
  for (const f of failures) {
    console.error(`  ✗ [${f.id}] ${f.msg}`);
  }
  process.exit(1);
}
console.log("\nsupply-chain:check passed");
