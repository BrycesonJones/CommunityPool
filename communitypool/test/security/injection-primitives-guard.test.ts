import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// First-party scan roots. We deliberately do NOT walk node_modules, vendored
// Solidity (lib/openzeppelin-contracts, lib/chainlink-brownie-contracts,
// lib/forge-std, lib/foundry-devops), build artifacts, or our own scanner —
// the scanner naturally contains the literal strings it forbids.
const ROOTS = ["app", "components", "lib"] as const;

// Subdirectories under ROOTS to skip entirely. Anything under lib/<vendored>
// is third-party Solidity / Hardhat code and not application surface.
const EXCLUDED_DIR_PREFIXES = [
  path.join("lib", "openzeppelin-contracts"),
  path.join("lib", "chainlink-brownie-contracts"),
  path.join("lib", "forge-std"),
  path.join("lib", "foundry-devops"),
] as const;

const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

// Files that are explicitly allowed to mention a forbidden primitive. Each
// entry must justify *why* — usually because the file is itself a security
// guard, an OWASP-review artifact, or a test that asserts the primitive is
// absent. Add new entries sparingly and only with a reason.
const ALLOWLIST: ReadonlyArray<{ file: string; reason: string }> = [
  {
    file: path.join("test", "security", "injection-primitives-guard.test.ts"),
    reason: "this file — it lists the forbidden primitives in order to scan",
  },
];

type ForbiddenPattern = {
  /** Human-readable name shown when the test fails. */
  name: string;
  /** Regex applied per-line against source files. */
  pattern: RegExp;
};

// Patterns intentionally use `(?<![.\w])` to require a standalone identifier
// rather than a property access. `RegExp#exec`, `Promise#spawn`-style
// false positives would otherwise dominate (`YMD_RE.exec(ymd)` is fine).
// child_process.<fn>(…) is still caught by the `child_process` import rule,
// since the only way to reach those builtins is via that module.
const FORBIDDEN: ForbiddenPattern[] = [
  { name: "dangerouslySetInnerHTML", pattern: /\bdangerouslySetInnerHTML\b/ },
  { name: ".innerHTML", pattern: /\.innerHTML\b/ },
  { name: ".outerHTML", pattern: /\.outerHTML\b/ },
  { name: ".insertAdjacentHTML", pattern: /\.insertAdjacentHTML\s*\(/ },
  { name: "document.write", pattern: /\bdocument\.write\s*\(/ },
  { name: "eval(", pattern: /(?<![.\w])eval\s*\(/ },
  { name: "new Function(", pattern: /\bnew\s+Function\s*\(/ },
  {
    name: 'import "child_process"',
    pattern:
      /\b(?:require\s*\(\s*["']child_process["']\s*\)|from\s+["']child_process["'])/,
  },
  {
    name: 'import "node:child_process"',
    pattern:
      /\b(?:require\s*\(\s*["']node:child_process["']\s*\)|from\s+["']node:child_process["'])/,
  },
  { name: 'import "vm"', pattern: /\bfrom\s+["'](?:node:)?vm["']/ },
  { name: "vm.runInNewContext", pattern: /\bvm\.runInNewContext\s*\(/ },
  // Standalone calls (i.e. used as imported functions, not as a method on
  // some object). These are only meaningfully dangerous when combined with
  // child_process, which is already banned above, but we keep the literal
  // names so a dynamic require can't sneak by.
  { name: "exec(", pattern: /(?<![.\w])exec\s*\(/ },
  { name: "execSync(", pattern: /(?<![.\w])execSync\s*\(/ },
  { name: "spawnSync(", pattern: /(?<![.\w])spawnSync\s*\(/ },
  { name: "spawn(", pattern: /(?<![.\w])spawn\s*\(/ },
];

function isExcluded(rel: string): boolean {
  return EXCLUDED_DIR_PREFIXES.some(
    (p) => rel === p || rel.startsWith(p + path.sep),
  );
}

function listFiles(root: string): string[] {
  const out: string[] = [];
  const queue = [root];
  while (queue.length > 0) {
    const dir = queue.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      // Hidden directories (.git, .next) and node_modules are never source.
      if (name === "node_modules" || name.startsWith(".")) continue;
      const full = path.join(dir, name);
      const rel = path.relative(REPO_ROOT, full);
      if (isExcluded(rel)) continue;
      let s;
      try {
        s = statSync(full);
      } catch {
        continue;
      }
      if (s.isDirectory()) {
        queue.push(full);
      } else if (s.isFile() && SCAN_EXTENSIONS.has(path.extname(name))) {
        out.push(full);
      }
    }
  }
  return out;
}

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function isAllowlisted(relFromRepo: string): boolean {
  // Normalize on POSIX separators in the comparison so the test works on
  // Windows too — repo paths are stored with forward slashes in the
  // ALLOWLIST entries but readdir gives us native separators on disk.
  const norm = relFromRepo.split(path.sep).join("/");
  return ALLOWLIST.some(
    (entry) => entry.file.split(path.sep).join("/") === norm,
  );
}

describe("injection-dangerous primitives are absent from app code", () => {
  const offenders: string[] = [];

  for (const root of ROOTS) {
    const abs = path.join(REPO_ROOT, root);
    let files: string[] = [];
    try {
      files = listFiles(abs);
    } catch {
      continue;
    }

    for (const file of files) {
      const rel = path.relative(REPO_ROOT, file);
      if (isAllowlisted(rel)) continue;
      const text = readFileSync(file, "utf8");
      // Cheap fast-path: skip files with none of the substrings before
      // walking them line-by-line for accurate reporting.
      const anyHit = FORBIDDEN.some((p) => p.pattern.test(text));
      if (!anyHit) continue;
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i]!;
        for (const { name, pattern } of FORBIDDEN) {
          if (pattern.test(line)) {
            offenders.push(`${rel}:${i + 1}\t${name}\t${line.trim()}`);
          }
        }
      }
    }
  }

  it("contains zero matches for the forbidden primitives", () => {
    expect(offenders, offenders.join("\n") || undefined).toEqual([]);
  });
});
