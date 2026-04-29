import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static check: the production code must not contain a hard-coded auth
 * bypass flag. This guards against a future engineer (or a careless paste)
 * introducing `if (process.env.AUTH_DISABLED) return user` style escape
 * hatches that would survive a code review otherwise. We intentionally do
 * NOT scan `test/`, `docs/`, or `.md` files — those legitimately discuss
 * the patterns.
 */

const BAD_PATTERNS = [
  "AUTH_DISABLED",
  "DEV_LOGIN",
  "MOCK_AUTH",
  "DEFAULT_USER",
  "DEFAULT_PASSWORD",
  "BYPASS_AUTH",
] as const;

const SCAN_DIRS = ["app", "components", "lib", "middleware.ts"];

const REPO_CWD = path.resolve(process.cwd());

function gitGrep(pattern: string, dirs: string[]): string {
  try {
    return execFileSync("git", ["grep", "-nIE", pattern, "--", ...dirs], {
      cwd: REPO_CWD,
      encoding: "utf8",
    }).trim();
  } catch (err) {
    const e = err as { status?: number };
    // git grep exits 1 when there are zero matches; treat that as success.
    if (e.status === 1) return "";
    throw err;
  }
}

describe("auth bypass grep", () => {
  for (const pattern of BAD_PATTERNS) {
    it(`production code does not reference ${pattern}`, () => {
      const hits = gitGrep(pattern, SCAN_DIRS);
      expect(hits, `unexpected references:\n${hits}`).toBe("");
    });
  }
});
