import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SOURCE_DIRS = ["app", "components", "lib"];
const SKIP_PREFIXES = ["lib/openzeppelin-contracts", "lib/chainlink", "lib/forge-std"];

function walk(dir: string, out: string[] = []): string[] {
  const entries = readdirSync(dir);
  for (const name of entries) {
    const full = join(dir, name);
    const rel = relative(ROOT, full).replaceAll("\\", "/");
    if (SKIP_PREFIXES.some((p) => rel.startsWith(p))) continue;
    const s = statSync(full);
    if (s.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mts)$/.test(name)) out.push(full);
  }
  return out;
}

describe("no sensitive console logging in production paths", () => {
  it("does not log session/token/auth header shaped data", () => {
    const offenders: string[] = [];
    const files = SOURCE_DIRS.flatMap((d) => walk(join(ROOT, d)));
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const lines = text.split("\n");
      lines.forEach((line, idx) => {
        if (!/console\.(log|info|warn|error)\(/.test(line)) return;
        if (/(session|access[_-]?token|refresh[_-]?token|authorization|cookie)/i.test(line)) {
          offenders.push(`${relative(ROOT, file)}:${idx + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
