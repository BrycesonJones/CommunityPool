# AI-Agent Supply-Chain Rules

These rules apply to every AI coding agent (Claude Code, Cursor, Copilot, etc.)
that has write access to this repository. They exist to keep the supply-chain
attack surface small and human-reviewed. They map to OWASP A03:2025
(Software Supply Chain Failures).

If a rule blocks an agent from completing a task, the agent must stop and
ask a human, not work around the rule.

## Hard rules

1. **No new npm dependency without human approval.** An agent must not run
   `npm install <pkg>`, `npm add`, or any equivalent that adds a new entry
   to `dependencies` / `devDependencies` without a human explicitly
   approving the package by name and version in the same PR description.

2. **No silent version bumps.** An agent must not edit
   `communitypool/package.json` or `communitypool/package-lock.json` to
   change a version unless the change is part of a labeled dependency
   update PR with a human-readable rationale.

3. **No new dependency on an auto-deploy branch.** Agents must not push
   `package.json` / `package-lock.json` changes directly to `main` or any
   branch wired to a production deploy. Dependency changes go through a PR.

4. **Inspect for typosquatting.** Before approving a new package, confirm:
   - exact name (compare letter-for-letter against the legitimate package),
   - maintainer / org owns the GitHub repo linked from npm,
   - weekly download count is plausible for the package's claimed purpose,
   - the GitHub repo has more than one human contributor and recent commits.

5. **Inspect the lockfile diff.** A dependency PR must show the
   `package-lock.json` diff. Watch for:
   - new top-level packages you didn't add directly,
   - `resolved` URLs that don't point to `https://registry.npmjs.org/`,
   - sudden version jumps in unrelated packages,
   - packages that newly add `install` / `postinstall` lifecycle scripts.
   The CI guard `npm run supply-chain:check` fails if the lockfile changes
   without `package.json` changing.

6. **Never expose live secrets to an agent.** Agents must not be given
   read access to:
   - `SUPABASE_SERVICE_ROLE_KEY`,
   - live (`sk_live_*`) Stripe keys,
   - production Alchemy / Etherscan keys with billing,
   - private keys for any deployer wallet.
   Use Sepolia/test keys when an agent needs to exercise a flow.

7. **Delete or gitignore agent-created debug scripts.** The
   `*_investigate*.mjs` and `*debug*.mjs` patterns are gitignored. Any
   one-off investigation script an agent writes (especially one that
   handles a service-role key or a private key) must either be deleted
   when the task ends or named to match those gitignore patterns.

8. **No credentials in generated code.** Agents must never inline an
   API key, private key, password, or webhook secret into committed
   source — even temporarily, even with a "TODO: remove". CI rejects
   secret-shaped files via `npm run supply-chain:check`.

9. **Production deploys require human review.** No agent may approve its
   own PR. No agent may merge a PR. No agent may run a mainnet broadcast.

10. **Prefer the package already in `package.json`.** If the user asks
    for "an X library", the agent should first check whether one is
    already installed (`grep -l <feature>` in `node_modules` or
    `package.json`). Adding a fourth date library when three are already
    in the tree is itself a supply-chain risk.

## Procedure for adding a new dependency

When a human has approved adding a package, the agent should:

1. State the exact `name@version` it intends to install.
2. Link to the package's npm page and GitHub repo.
3. Note: weekly downloads, last release date, number of maintainers,
   whether it has install/postinstall scripts.
4. Run `npm install <name>@<version>` (one package at a time, no
   wildcards).
5. Run `npm audit --audit-level=high --omit=dev` and report the result.
6. Run `npm ls <name>` and report the resolved version + transitive
   dependents pulled in.
7. Run `npm run supply-chain:check` and `npm run sbom`.
8. Commit `package.json` and `package-lock.json` together in one
   focused commit — never ship lockfile-only commits.

## Procedure for upgrading a dependency

1. Confirm whether the bump is a patch / minor / major.
2. For major bumps, link to the package's release notes / changelog.
3. Run the full validation set: `npm run lint && npm test && npx tsc
   --noEmit && npm run build`.
4. Do not bypass test failures. If a test fails, surface the failure
   to a human and stop.

## What CI enforces

`npm run supply-chain:check` (run from `communitypool/`) blocks merge if:

- `packageManager`, `engines.node`, or `engines.npm` are missing.
- `package-lock.json` changed but `package.json` did not.
- A secret-shaped file (`.env*`, `*.pem`, `*.key`, `id_rsa`, `credentials*`,
  `secrets*.json`) is in the git index.
- A root-level `*_investigate*.mjs` or `*debug*.mjs` script exists.
- A mainnet build (`MAINNET=1` or `NODE_ENV=production`) is run with
  `NEXT_PUBLIC_EXPECTED_CHAIN_ID` unset, set to a testnet value, or with
  any `NEXT_PUBLIC_SEPOLIA_*` env var present.
- The lockfile is missing.

The CI `node` job additionally fails on any high/critical production
advisory from `npm audit --audit-level=high --omit=dev`. The `contracts`
job fails if `lib/onchain/community-pool-artifact.json` does not match
the freshly built `forge-out/CommunityPool.sol/CommunityPool.json`.

## Reporting a suspected supply-chain compromise

If an agent (or human) suspects a published npm package has been
compromised — unexpected `postinstall`, network calls to unknown hosts,
sudden owner change, malicious-looking commit by an unfamiliar account —
stop work, do not run `npm install`, and surface the finding immediately.
Note: a `package-lock.json` integrity hash mismatch on `npm ci` is a
strong signal — never override it with `npm install`.
