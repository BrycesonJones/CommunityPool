# Phase 2.8 — production V2 activation

Status: **application activation merged; no contract deployed by this phase.** New CommunityPools
created through the app are V2 and pay the live protocol fee. Pools created before this phase are
V1 and are unchanged in every respect.

## Phase 2.7 mainnet canary — record

The canary was executed manually with MetaMask. Every address and transaction below is on Ethereum
mainnet (chain 1).

### Contracts

| What | Address | Deployment tx |
| --- | --- | --- |
| Shared `ProtocolConfig` | `0x2eD7F089a6C2971B24eA91121aD65f9242F622c0` | `0x8b3249d41ce0935d9987a388f710aaf65d5e89116bc7bf80be6f3011899ce4d7` |
| V2 canary pool | `0x7Bcf72d773FEc6C69A027BBAf4F48606c6C39136` | `0x5cd7a81d540f2e01d985f40cdfbc36779ce0c9a0ca0ea0f5c13780b6022c31f4` |

### Live validations

| Step | Transaction |
| --- | --- |
| ETH funding at 1 % | `0x42a026d9e50b53584fe6f8846e17b7ac4c856ca951f757d830cf8d5d0d12e69a` |
| ETH withdrawal | `0x44e694c8a0f3e56de9ba3d49da2b5e24e9708d3524aea3a19c62d030bb28bfd9` |
| PAXG funding | `0x23b3feb20973646e61fe4588db489e5b8bad626d9fa1f03aa2ec05f15e924dc3` |
| PAXG withdrawal | `0x668eb9900023ac8ab1d3d93e244bd13cf1d41ca9ffd02a3bb5bb022e2659f822` |
| XAU₮ funding (via the XAU/USD oracle path) | `0x2f697a67c0d71281c9bcf9c8c3b5c15600bfbe178feba0be9a7d7436d0770944` |
| XAU₮ withdrawal | `0x42f4e841d558110a769dbbaebf2d1394840445fc6bd876d86d72670efca5f64f` |
| Fee change 100 → 75 bps | `0xac82cce255862ac4c6c15f851144ca7bc57cd864f45cad468d7fc737cbb666c9` |
| ETH funding settling at 75 bps | `0xf024c4f7ba70ebe72b988a52dc7ee0505b6408065e10ea41c6968e16b55e6dae` |
| Fee restored 75 → 100 bps | `0x145ca3758b83224ee5eb1bbdd316352617bfae85260530acc99b1e3c08b91f37` |
| Final ETH cleanup | `0x508b80871aa26d45dee2b0b0d4c749a04cfc17fe791f5ad747cb1013030017ae` |

The fee-change pair proves the property the funding UI depends on: an existing pool picks up an
admin rate change with no redeployment, so the rate must be read live rather than assumed.

### WBTC

WBTC was **intentionally not repeated** as a live-wallet canary. Its real-token behaviour is
covered by the mainnet-fork suite (`ForkProtocolFeeMainnet.t.sol` exercises a WBTC contribution
against the real token and the real BTC/USD feed with exact-transfer accounting), and two distinct
live ERC-20s — PAXG and XAU₮ — were exercised end to end on mainnet with real funds. This is
redundant coverage that was skipped, not a gate that failed: WBTC is fully supported and is wired
into every new pool.

### Artifact provenance

The canary pool's deployed runtime bytecode was compared byte for byte against the committed
artifact with the constructor immutables masked out:

```
masked runtime keccak (on-chain 0x7Bcf72d7…) = 0x86f70dd4b6e8557328bbc73de173587b197ff9b2740bddfe0ec80e992f8d6938
masked runtime keccak (lib/onchain/community-pool-v2-artifact.json) = same
```

29 immutable slots (928 bytes) differ, and they decode exactly to the pool's constructor inputs:
`minimumUsd` 1e16, `expiresAt` 1789330323, deployer, ETH/USD feed `0x5f4eC3Df…`, feed decimals 8,
max price age 7200, ProtocolConfig `0x2eD7F089…`. The deployed `ProtocolConfig` runtime matches
`lib/onchain/protocol-config-artifact.json` with no masking at all.

## What Phase 2.8 changed in the application

| Area | Before | After |
| --- | --- | --- |
| New pool deployment | frozen V1 artifact | V2 artifact + shared ProtocolConfig |
| Existing pools | V1, no fee | unchanged — still V1, still no fee |
| Funding UI | no fee shown | live rate read from the pool, split shown before confirming |
| Fees page | "transitioning to a protocol-fee model" | states the live 1 % rate, the deduction direction and the 3 % ceiling |

### V1 / V2 compatibility

Detection is a deterministic on-chain capability probe in `lib/onchain/protocol-fee.ts`: the pool's
runtime bytecode must contain **both** V2-only function selectors, `protocolConfig()` and
`getProtocolFeeConfig()`. Solidity's dispatcher embeds every selector as a `PUSH4` operand, so a
compiled-in function is literally present in the code; requiring two independent 4-byte matches
makes a chance collision implausible. This is the same mechanism the app already used for
`poolSupportsPartialWithdraw`.

An `eth_call` probe was rejected: V1's `fallback()` routes unknown selectors into `fund()`, so a V1
pool answers with a revert that cannot be told apart from an RPC failure. Reading code once keeps
"this is a V1 pool" separate from "the network call failed" — which matters because a failed read
must never be rendered as "no fee". An address with no code at all raises an error rather than
being classified as V1.

Fund and withdraw helpers are unchanged and drive both generations: V2 keeps every V1 function with
identical selectors, so the frozen V1 ABI still works for them.

### Funding fails closed on unresolved economics

No wallet prompt opens while the fee for a contribution is unknown. The Fund button stays disabled
while the preview is loading and while a read has failed; a failed read shows the reason plus a
Retry action rather than letting the transaction proceed under a generic "never more than 3%"
warning. A confirmed V1 pool needs no fee resolution and funds normally.

Immediately before signing, a V2 contribution re-reads the live rate. If it moved since the
preview, the transaction is not submitted: the preview refreshes to the new economics and the user
must press Fund again to confirm what they can now see. The rate can still change between that
re-read and mining — V2 has no `maxFeeBps` transaction parameter — so the UI says so, and bounds it
with the contract's immutable 3% ceiling. That last window is the only remaining one in either
flow: every earlier opportunity for the rate to move unseen is now closed by a re-read.

The deploy flow submits two transactions back to back — create the pool, then fund it — with no
review in between, so it re-reads the rate at both prompts:

1. **Step 4 review** shows the initial contribution's gross, fee and net in token-native units.
   Deployment is blocked (with Retry) while the live ProtocolConfig fee cannot be read.
2. **Before the deployment prompt**, the rate is read again and compared with the reviewed one. If
   it moved, nothing is deployed: the split is rebuilt at the new rate and Deploy must be pressed
   again. If that read fails, the review drops back to its blocked state with Retry.
3. **After the pool is confirmed, before the deposit prompt**, the rate is read a third time. If it
   moved or cannot be read, the deposit is not sent and no wallet prompt opens.

In that last case the pool already exists on chain and is never rolled back. It is persisted
through the existing recovery path as `funding_pending` with `needsRecovery: true`, and the modal
says plainly that the pool was created, that funding was paused, and that no funding transaction
was submitted. "Review and fund this pool" hands it to the normal Fund flow, which performs its own
fee confirmation — the deploy modal deliberately does not implement a second one.

### Fee presentation

The fee is deducted **from** the gross contribution, never added on top. The preview uses the same
integer arithmetic as the contract — `floor(gross × bps / 10_000)` — on the exact amount the
transaction will send, so it matches settlement to the wei, including the case where a small
contribution floors the fee to zero. The rate is read live from the pool on every preview, so an
on-chain rate change between 0 and 300 bps needs no frontend deploy. If the read fails, the UI says
so and shows no numbers; it never falls back to a default rate.

## Not done in this phase

No contract was deployed, no ProtocolConfig was modified, no mainnet or testnet transaction was
sent by the tooling. Gas optimization remains deferred.

## Hotfix: initial-contribution preview failed closed incorrectly (2026-09-06)

The first production smoke test never reached a deployment. The step-4 review reported
"Could not read the current protocol fee", and Retry repeated it, even though the fee was
readable: `cast call protocolFeeBps()` returned 100, and the same call from the production
browser through `window.ethereum` returned 100 as well.

**Root cause.** Two defects compounded:

1. `weiForUsdContribution` (and the ERC-20 equivalent) built the Chainlink contract with the
   **signer** as its runner. ethers then populates the call before sending it, so the wallet
   receives `eth_call {from, to, data}` for a plain view. The console checks that proved the chain
   healthy used `eth_call {to, data}` — a different shape, and the one that works. Protocol-fee
   reads already used the provider, which is why the fee read succeeded while the price read did
   not. A view has no caller; requiring signing context for one is wrong regardless of wallet.
2. `loadInitialFundSplit` wrapped the fee read, the price read and the split arithmetic in one
   `try`/`catch` whose only outcome was `setInitialFundSplit(null)`, which the UI rendered as
   "could not read the current protocol fee". So a price-feed failure was reported as a
   ProtocolConfig failure, sending diagnosis to the wrong contract.

**Fix.** `readerFor()` resolves a signer to its provider, and every read-only call — Chainlink
feeds, `protocolFeeBps()`, `getProtocolFeeConfig()` — now goes through the provider, sending
`eth_call {to, data}` with no `from`. The preview runs in three stages, each classified: fee,
price (naming the asset's feed, e.g. "ETH/USD" or "PAXG/USD"), and calculation. Every state still
fails closed with Retry and Deploy disabled; no rate is ever assumed. `test/onchain/read-only-runner.test.ts`
pins the call shape against a wallet that rejects `from`-bearing `eth_call`, reproducing the exact
production failure.

## Hotfix: ERC-20 approval / amount-drift race (2026-09-07)

The first production ERC-20 contribution failed at gas estimation with PAX Gold's
`InsufficientAllowance()` (`0x13be252b`). No funding transaction was broadcast and no PAXG moved.

**Root cause.** The flow converted the USD input to a token amount **twice**: once for the review,
and again inside submit. Between them a Chainlink round updated, so the second conversion produced
a slightly larger amount than the first. That is invisible while the allowance is `MaxUint256`, but
the smoke test used MetaMask's Edit Spending Cap to approve exactly the reviewed
`2,259,000,000,000` raw PAXG. The funding call then asked for more than the cap:

```
approved  0x20df6e47e00   = 2,259,000,000,000
attempted 0x20df74…       > the approved cap        -> InsufficientAllowance()
```

**Fix.** One deliberate contribution now establishes one canonical raw gross. The bigint the review
displays is the one the fee is computed from, the one the allowance is checked against, and the one
passed to `fundERC20` — never re-derived after confirmation. The app still *requests* `MaxUint256`
so repeat contributions need no second approval, but correctness no longer depends on the user
accepting it: after an approval confirms, the resulting allowance is read back, and if it is still
short the flow stops before any funding transaction rather than letting the user pay gas for a call
that cannot succeed. An exact cap equal to the reviewed amount succeeds.

If the price moves enough that the confirmed amount no longer clears `minimumUsd`, the contract
refuses it and the user reviews a fresh amount; the approved gross is never silently increased to
compensate.

Failures are also no longer rendered raw. `lib/onchain/funding-errors.ts` maps revert selectors to
plain sentences — insufficient allowance, insufficient balance, cancelled prompt, below minimum,
stale price, unsupported token behaviour — with no calldata or provider internals in the UI. The
unredacted original still reaches the security-event pipeline.

