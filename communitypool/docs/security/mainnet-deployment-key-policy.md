# Mainnet deployment key policy

CommunityPool is a financial-application smart contract: every mainnet
deploy creates a contract that accepts and custodies real ETH and ERC20
tokens. The deployer key is therefore the most sensitive cryptographic
material the project ever touches, and it must be handled with the care
that implies.

This doc is the load-bearing rule set for human deployers and any
automated agent acting on behalf of the project. Read it before every
mainnet broadcast.

## Hard rules

1. **Never store mainnet private keys in `.env`, `.env.local`, `.env.example`,
   or any committed/uncommitted env template.** The repo's
   [`.env.example`](../../.env.example) intentionally has no
   `PRIVATE_KEY` / `DEPLOYER_PRIVATE_KEY` / `MNEMONIC` field. Do not add one.
2. **Never paste a seed phrase or a raw private key into a terminal,
   chat, prompt, log file, screenshot, recording, agent transcript,
   ticket, or Slack message.** If any of those happen by accident,
   treat the key as compromised: move funds, rotate, retire the
   address. Don't try to reason yourself out of it.
3. **Mainnet deploys must use a hardware wallet (Ledger / Trezor) or an
   encrypted Foundry keystore.** No exceptions. The keystore must be
   protected by a passphrase that lives in a password manager, not in a
   shell variable.
4. **`--private-key <hex>` is a banned flag for any chain ≠ 31337.** Use
   it only against a local Anvil dev chain, where the key is the
   public Anvil-default account (see
   [`test/app/anvil-community-pool.integration.test.ts`](../../test/app/anvil-community-pool.integration.test.ts)).
   Sepolia and any other testnet still use a keystore — testnet keys
   leak too, and a leaked Sepolia key reveals deployer behaviour and
   address-reuse patterns that simplify a future mainnet attack.
5. **The deployer wallet is a single-purpose hot wallet.** It does not
   hold user funds, does not sign messages outside deploys, and has only
   enough ETH to cover gas plus a safety margin. Replenish from a
   separate funding wallet via a clear chain of transactions.
6. **Every mainnet deploy is reviewed before broadcast.** The reviewer
   is a second person (or, for a solo project, a separate session
   started cold against a freshly-pulled main). The review checks:
   chain id, expected `NEXT_PUBLIC_EXPECTED_CHAIN_ID`, contract
   bytecode hash matches what's in `.next` build output, deployer
   address matches the one on file.
7. **Don't ask agents (Claude Code, Cursor, Copilot, etc.) for or about
   private keys, seed phrases, or `--private-key` arguments.** Agents
   should refuse those requests. If an agent volunteers a key — even a
   "test" one — verify it is the public Anvil default and never use it
   anywhere outside Anvil.

## Allowed deploy patterns

### Local Anvil (chain 31337)

```bash
# Public Anvil dev key. Not a secret. Only valid against `anvil`.
forge script script/DeployCommunityPool.s.sol:DeployCommunityPool \
  --rpc-url http://127.0.0.1:8545 \
  --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

### Sepolia (chain 11155111)

```bash
# Foundry encrypted keystore. Prompts for passphrase at runtime.
forge script script/DeployCommunityPool.s.sol:DeployCommunityPool \
  --rpc-url "$ALCHEMY_API_URL_ETH_SEPOLIA" \
  --account communitypool-sepolia \
  --broadcast
```

`forge import` once, then reference the account by name. The
unencrypted key never touches the filesystem in plaintext.

### Mainnet (chain 1) — hardware wallet, preferred

```bash
forge script script/DeployCommunityPool.s.sol:DeployCommunityPool \
  --rpc-url "$ALCHEMY_API_URL_ETH_MAINNET" \
  --ledger \
  --hd-paths "m/44'/60'/0'/0/0" \
  --broadcast \
  --verify
```

Confirm the chain id, contract address, and gas estimate on the Ledger
screen before approving. Match the address on the screen against the
deployer-of-record list in this repo's launch runbook.

### Mainnet (chain 1) — encrypted keystore, fallback

Acceptable only when no hardware wallet is available. The keystore
passphrase must come from a password manager and never live in a shell
variable. After the deploy, immediately confirm via Etherscan that the
deployer address matches the deployer-of-record.

```bash
forge script script/DeployCommunityPool.s.sol:DeployCommunityPool \
  --rpc-url "$ALCHEMY_API_URL_ETH_MAINNET" \
  --account communitypool-mainnet \
  --broadcast \
  --verify
```

## Banned patterns

* `--private-key 0x…` against chain 1 or chain 11155111. **Banned.**
* `PRIVATE_KEY=0x…` env var consumed by `forge script` via
  `--private-key $PRIVATE_KEY`. **Banned.** Even if the value comes
  from a CI secret, the cleartext lives in process env for the whole
  shell, ends up in shell history, ends up in any `set | grep`, and
  ends up in any agent that scrapes the environment.
* Reading a key out of a JSON config file via `jq`. **Banned.**
* Pasting a key into a `.zsh_history`-readable command. **Banned.**
* Any deployer wallet that has previously held user funds. **Banned.**

## Pre-broadcast checklist

Run through this before every mainnet deploy. If anything is off,
abort.

* [ ] `git status` is clean and on `main`.
* [ ] `npm run build && npm run scan:bundle-secrets:ci` passes.
* [ ] `npm test` passes, including the security suite under
      `test/security/`.
* [ ] The hosting-platform env has the rotated mainnet secrets listed in
      [`.env.example`](../../.env.example) under "Pre-mainnet rotation
      checklist". Local `.env` is not used.
* [ ] Hardware wallet is connected, unlocked, on the correct HD path.
* [ ] Deployer address matches deployer-of-record.
* [ ] Wallet is on chain 1, with enough ETH for gas + ~30% safety
      margin.
* [ ] `NEXT_PUBLIC_EXPECTED_CHAIN_ID=1` in the production hosting env;
      the on-chain `assertChainMatchesExpected` guard in
      [`lib/onchain/community-pool.ts`](../../lib/onchain/community-pool.ts)
      will refuse otherwise.
* [ ] You have a clean rollback plan: if the deploy reverts, where does
      the next attempt come from, who reviews it.

## Post-broadcast actions

* Verify the contract on Etherscan via `--verify`.
* Record the deploy in the launch runbook: tx hash, deployer address,
  contract address, block number, gas used, reviewer name.
* Top up gas only, not balance. The deployer wallet remains
  single-purpose.
* Do not reuse the deployer wallet for unrelated transactions.

## What to do if a key is exposed

1. Move all funds out of the affected address to a fresh wallet
   immediately. Do this before anything else.
2. Treat the address as compromised forever. Do not "rotate by waiting
   for the leak to expire."
3. Document the incident: what leaked, where, who saw it, whether the
   leak left the local machine.
4. If the leaked key was used for a contract deploy, audit every
   contract that key controls. CommunityPool does not give the deployer
   privileged runtime control beyond the existing
   `releaseExpiredFundsToDeployer` path, but verify the assumption for
   each release.
5. Update this doc with the lesson learned.

## Related controls

* Build-time bundle secret scan: [`scripts/scan-bundle-secrets.mjs`](../../scripts/scan-bundle-secrets.mjs).
* Server-side error redaction: [`lib/security/redact.ts`](../../lib/security/redact.ts).
* Production chain-id guard: [`lib/wallet/expected-chain.ts`](../../lib/wallet/expected-chain.ts).
* Deploy-broadcast wrong-chain refusal: [`assertChainMatchesExpected`](../../lib/onchain/community-pool.ts).
