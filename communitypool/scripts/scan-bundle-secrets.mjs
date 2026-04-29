#!/usr/bin/env node
/**
 * Post-build A04 guard: scan the Next.js production output for forbidden
 * secret names and secret-shaped strings.
 *
 * Usage:
 *   npm run build
 *   npm run scan:bundle-secrets [-- --root <path>]
 *
 * Exit codes:
 *   0 — clean (or build output absent in non-CI mode)
 *   1 — at least one forbidden token found
 *   2 — build output missing in CI mode (--require-build)
 *
 * The script scans two surfaces with different rule sets:
 *   - browser bundle (.next/static)             → strict: NEXT_PUBLIC_* OK only
 *   - server bundle  (.next/server/app)         → loose: only forbidden names
 *
 * Always check `npm run scan:bundle-secrets` after a `next build` before
 * promoting the artifact. CI should run `npm run build && npm run
 * scan:bundle-secrets -- --require-build`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");

// Argv: `--root <path>` overrides REPO_ROOT (used by the vitest runner so it
// can scan whatever build the developer happens to have around).
function parseArgs(argv) {
  const out = { root: REPO_ROOT, requireBuild: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root" && argv[i + 1]) {
      out.root = path.resolve(argv[i + 1]);
      i++;
    } else if (argv[i] === "--require-build") {
      out.requireBuild = true;
    }
  }
  return out;
}

/** Names that must never appear in any bundle (browser or server). */
const FORBIDDEN_SECRET_NAMES = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "Google_CLIENT_SECRET",
  "GOOGLE_CLIENT_SECRET",
  "UPSTASH_REDIS_REST_TOKEN",
  "ETHERSCAN_API_KEY",
  "ALCHEMY_API_KEY",
  "SUPABASE_Dev_Password",
  "SUPABASE_DB_PASSWORD",
  "DATABASE_URL",
  "POSTGRES_PASSWORD",
];

/**
 * Patterns that indicate a *value* of a secret, not just the name. These are
 * applied to the browser bundle only — the server bundle legitimately needs
 * to embed Stripe SDK constants and Supabase service-role-shaped JWTs.
 */
const FORBIDDEN_VALUE_PATTERNS = [
  // Stripe live secret key
  { name: "Stripe live secret key", regex: /\bsk_live_[A-Za-z0-9]{20,}/g },
  // Stripe test secret key (the test key still grants Stripe API access)
  { name: "Stripe test secret key", regex: /\bsk_test_[A-Za-z0-9]{20,}/g },
  // Stripe webhook signing secret
  { name: "Stripe webhook secret", regex: /\bwhsec_[A-Za-z0-9]{20,}/g },
  // Postgres connection URL
  {
    name: "Postgres connection URL",
    regex: /\bpostgres(?:ql)?:\/\/[^\s'"`<>]+/g,
  },
  // service-role-shaped JWT: a JWT whose header decodes to {"role":"service_role"}.
  // Detect by the literal substring `"role":"service_role"` (only present in
  // a service-role JWT payload after b64-decode); we look for the encoded
  // form in JS source by spotting the eyJ prefix near the literal "service_role".
  // To minimise false positives we require BOTH the `eyJ` JWT prefix AND the
  // ASCII string `service_role` within 200 chars on the same line.
  {
    name: "service-role JWT",
    regex: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    requireNeighborhood: /service_role/,
  },
];

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function shouldScanFile(filePath, browserSurface) {
  if (browserSurface) {
    // Static surface: html, js, css, json, txt, map (source maps embed
    // strings too — fail closed if they leak).
    return /\.(?:js|mjs|cjs|html|css|json|txt|map)$/.test(filePath);
  }
  return /\.(?:js|mjs|cjs)$/.test(filePath);
}

function scanFile(filePath, rules) {
  const content = fs.readFileSync(filePath, "utf8");
  const findings = [];
  for (const name of rules.forbiddenNames ?? []) {
    if (content.includes(name)) {
      findings.push({ kind: "name", token: name });
    }
  }
  for (const pattern of rules.forbiddenValues ?? []) {
    let match;
    pattern.regex.lastIndex = 0;
    while ((match = pattern.regex.exec(content)) !== null) {
      const matchStart = match.index;
      const matchEnd = matchStart + match[0].length;
      if (pattern.requireNeighborhood) {
        const windowStart = Math.max(0, matchStart - 200);
        const windowEnd = Math.min(content.length, matchEnd + 200);
        const window = content.slice(windowStart, windowEnd);
        if (!pattern.requireNeighborhood.test(window)) continue;
      }
      findings.push({
        kind: "value",
        token: pattern.name,
        // Never log the actual matched value — record offset + length only.
        atOffset: matchStart,
        length: match[0].length,
      });
      // One per pattern per file is enough; we want a clean failure list.
      break;
    }
  }
  return findings;
}

function scanSurface({ surfaceLabel, surfaceRoot, rules, browserSurface }) {
  const findings = [];
  if (!fs.existsSync(surfaceRoot)) {
    return { surfaceLabel, surfaceRoot, missing: true, findings };
  }
  const files = walk(surfaceRoot).filter((f) =>
    shouldScanFile(f, browserSurface),
  );
  for (const file of files) {
    const fileFindings = scanFile(file, rules);
    if (fileFindings.length === 0) continue;
    findings.push({ file, fileFindings });
  }
  return { surfaceLabel, surfaceRoot, missing: false, findings };
}

export function runScan(repoRoot) {
  const browser = scanSurface({
    surfaceLabel: "browser",
    surfaceRoot: path.join(repoRoot, ".next", "static"),
    browserSurface: true,
    rules: {
      forbiddenNames: FORBIDDEN_SECRET_NAMES,
      forbiddenValues: FORBIDDEN_VALUE_PATTERNS,
    },
  });
  const server = scanSurface({
    surfaceLabel: "server",
    surfaceRoot: path.join(repoRoot, ".next", "server", "app"),
    browserSurface: false,
    rules: {
      // The server bundle legitimately embeds service-role JWTs / stripe
      // secrets (as values, post-build). What is NOT legitimate is for the
      // raw .env name to appear in a server bundle — that means the source
      // is reading from process.env at request time but ALSO accidentally
      // shipping the literal value as a string. We only flag that here.
      forbiddenNames: [
        "SUPABASE_Dev_Password",
        "SUPABASE_DB_PASSWORD",
        "POSTGRES_PASSWORD",
      ],
      forbiddenValues: [
        // Postgres connection URLs should never be embedded — they include
        // credentials inline.
        {
          name: "Postgres connection URL",
          regex: /\bpostgres(?:ql)?:\/\/[^\s'"`<>]+/g,
        },
      ],
    },
  });
  return { browser, server };
}

function formatFindings(label, surface) {
  if (surface.missing) {
    return `  [skip] ${label} surface not found at ${path.relative(
      REPO_ROOT,
      surface.surfaceRoot,
    )}`;
  }
  if (surface.findings.length === 0) {
    return `  [ok]   ${label} surface clean`;
  }
  const lines = [`  [FAIL] ${label} surface contains forbidden tokens:`];
  for (const { file, fileFindings } of surface.findings) {
    lines.push(`    ${path.relative(REPO_ROOT, file)}`);
    for (const f of fileFindings) {
      if (f.kind === "name") {
        lines.push(`      - secret name: ${f.token}`);
      } else {
        lines.push(
          `      - secret value pattern: ${f.token} @ offset ${f.atOffset} (len ${f.length})`,
        );
      }
    }
  }
  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const buildExists = fs.existsSync(path.join(args.root, ".next"));
  if (!buildExists) {
    if (args.requireBuild) {
      console.error(
        `[scan-bundle-secrets] .next not found in ${args.root}. Run \`npm run build\` first.`,
      );
      process.exit(2);
    }
    console.warn(
      `[scan-bundle-secrets] .next not found in ${args.root}. Skipping (run \`npm run build\` first to scan).`,
    );
    process.exit(0);
  }

  const { browser, server } = runScan(args.root);
  console.log(`scan-bundle-secrets: scanning ${args.root}/.next`);
  console.log(formatFindings("browser", browser));
  console.log(formatFindings("server", server));

  const failed =
    browser.findings.length > 0 || server.findings.length > 0;
  if (failed) {
    console.error(
      "scan-bundle-secrets: FAILED — see findings above. Treat any leak as critical and rotate the affected secret.",
    );
    process.exit(1);
  }
  console.log("scan-bundle-secrets: PASS");
  process.exit(0);
}

const isDirectInvocation =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith(process.argv[1]);
if (isDirectInvocation) {
  main();
}
