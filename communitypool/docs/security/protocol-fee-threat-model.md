# Protocol fee: threat model, tested invariants, and trust assumptions

Scope: the CommunityPool **V2 candidate** (`src/CommunityPool.sol`) and
`src/ProtocolConfig.sol` after Phase 2.3–2.4 (fee collection), Phase 2.5
(adversarial hardening) and Phase 2.6 (oracle hardening). Production still deploys the frozen V1 artifact; V2
is not deployed anywhere. Nothing here claims formal verification or absolute
security; it records the reviewed threat model, the invariants that are
tested, and the operational assumptions that remain.

## Actors and trust

| Actor | Can | Cannot (enforced by contract) |
| --- | --- | --- |
| Funder | contribute ETH / whitelisted ERC-20 | pay less than the configured fee, bypass the fee via `receive`/`fallback`, be charged more than the gross they chose, be pulled more than `grossAmount` |
| Pool owner / co-owner (explicit at deploy) | withdraw remaining pool assets before expiry | recover a paid protocol fee, withdraw during another party's contribution settlement, change protocol configuration |
| Protocol admin | set fee 0–300 bps, set fee recipient, propose a successor (two-step) | exceed 300 bps, withdraw or move pool assets, change owners / expiry / minimum / allowlist, renounce, act through a pending (unaccepted) successor |
| Pending admin | accept the role | anything else |
| Fee recipient (treasury) | receive fees | change configuration, withdraw pool assets, gain ownership by receiving fees, execute any pool action from inside a fee callback |
| Non-official `IProtocolConfig` implementation | be pointed at by a pool at deploy time | make a pool charge > 300 bps, burn fees to zero address, make a pool pay itself; malformed/reverting reads fail closed |
| ERC-20 token | move balances as it likes | make the pool record an amount that its own `balanceOf` does not confirm (exact-transfer accounting); re-enter any pool function during a contribution |
| Chainlink feed (per asset, immutable) | publish rounds; go silent | make the pool settle a contribution on a non-positive, incomplete, future-dated or stale price (older than the pool's immutable `maxPriceAge`); change the fee split or custody (price only gates the USD minimum) |

Deliberate protocol policy (not vulnerabilities): the admin may move the fee
anywhere in 0–300 bps and may change the treasury at any time for **future**
contributions; a compromised admin's strongest outcome is a 3% fee to an
attacker-chosen recipient on future contributions. A treasury key compromise
alone yields only the fees already paid to it.

Operational assumptions (documented, not enforced): the configured fee
recipient must be able to receive ETH (a Safe is fine); a recipient that
rejects or reverts blocks fee-bearing ETH contributions until the admin changes
it. A gas-burning recipient raises funders' costs and can force out-of-gas
failure (fail closed). Exact-transfer accounting trusts each token's own
observable `balanceOf`; CommunityPool cannot make a malicious token truthful,
it can only refuse to settle when balances do not reconcile.

## Invariants (tested)

Per successful contribution:

```text
fee   = floor(gross × feeBps / 10_000)         (Math.mulDiv; never rounds up)
fee   ≤ gross,  fee ≤ floor(gross × 300 / 10_000)
net   = gross − fee,  fee + net = gross
pool  += net,  recipient += fee,  funder transferFrom request = gross (ERC-20) / msg.value = gross (ETH)
exactly one Funded / FundedERC20 event, emitted after all transfers, values = actual settlement
```

Rejected contributions leave no partial state: no pool delta, no treasury
delta, no event. Globally (stateful invariant suite): lifetime gross = lifetime
fee + lifetime net per asset; lifetime net = current pool balance + owner
withdrawals + expiry releases; treasuries hold exactly the lifetime fees paid to
them; the configured and observed rate never exceeds 300 bps; the admin,
pending admin, treasuries, the config contract and attackers are never pool
owners; the config never holds assets.

Aliasing: actors may overlap (treasury == funder / owner / co-owner / admin;
admin == owner / funder; funder == owner; successor admin == treasury). Asset
flow is asserted, not naive per-address deltas: e.g. when the treasury is the
ERC-20 funder the pool still pulls exactly `gross`, then returns `fee`, so the
funder's net debit is `net`. The only prohibited overlap is treasury == pool
(`CommunityPool__InvalidFeeRecipient`).

## Reentrancy model

All state-changing functions share one `ReentrancyGuard`: `fund`, `fundERC20`,
`withdraw`, `cheaperWithdraw`, `withdrawToken`, `withdrawTokenAmount`,
`releaseExpiredFundsToDeployer`. While a contribution settles, nothing else on
the pool can execute, from any caller, including a fee recipient that is also
an authorized owner and including ERC-20 hook callbacks during
`transferFrom`/`transfer`. `receive` and `fallback` route into `fund` and
inherit the guard. Config reads are `view` (STATICCALL): a config
implementation cannot mutate state or re-enter during a read, so one
contribution always uses one coherent (rate, recipient) snapshot.

## Oracle validation (Phase 2.6)

Every price read (`PriceConverter.getPrice18`) validates `latestRoundData()`
before the value is used, in this order, each with a typed custom error:

```text
answer > 0                                  PriceConverter__InvalidPrice(answer)
updatedAt != 0                              PriceConverter__IncompleteRound()
updatedAt <= block.timestamp                PriceConverter__FutureTimestamp(updatedAt, now)
block.timestamp - updatedAt <= maxPriceAge  PriceConverter__StalePrice(updatedAt, now, maxPriceAge)   (age == max is valid)
```

`maxPriceAge` is a per-feed `uint32` fixed at pool construction (ETH/USD via
the constructor, each ERC-20 via `TokenConfig.maxPriceAge`), must be non-zero
(`PriceConverter__InvalidMaxPriceAge`), and has **no setter**: neither the
pool owner nor the protocol admin can loosen or tighten it, and ProtocolConfig
gained no oracle authority. Feed decimals are read once at construction
(`decimals()`), rejected above 18 (`PriceConverter__UnsupportedFeedDecimals`),
stored alongside the feed, and every answer is scaled up to 18 decimals; the
former implicit 8-decimal assumption is gone. `answeredInRound` is not
consulted (Chainlink documents it as deprecated; OCR feeds report it equal to
`roundId`), nor is `startedAt`.

A rejected price fails the contribution closed on every ingress (`fund`,
`receive`, `fallback`, `fundERC20`) before any asset moves: no pool delta, no
treasury delta, no allowance consumed, no event. There is no cached or
fallback price. The oracle influences **only** the USD-minimum gate; the fee
split, the exact-transfer checks and custody are price-independent (tested
with fuzzed prices). Per-feed thresholds are independent: a stale ETH/USD feed
blocks ETH contributions while ERC-20 contributions with a fresh feed proceed,
and vice versa. Mainnet values and their rationale are recorded in
`docs/deployment/phase-2-7-mainnet-canary.md`.

Residual (documented, not enforced): a feed that goes silent longer than its
`maxPriceAge` makes that asset unfundable until a new round lands; owners can
still withdraw and expiry release is unaffected. A feed publishing a wrong but
positive, fresh price can mis-gate the minimum; this is Chainlink's trust
boundary and no on-chain check can detect it.

## Phase 2.5 findings

| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| F-1 | Low | Cross-function reentrancy by a fee recipient that is also an explicit owner: guarding only the funding paths let it call `withdraw`/`cheaperWithdraw`/`withdrawToken`/`withdrawTokenAmount` from inside the ETH fee callback (`Withdrawn` emitted before the contribution's `Funded`; for a callback ERC-20 the exact-transfer check then reverted the contribution). No authority gain, no fund loss; settlement/event ordering incoherent. | Fixed: shared `nonReentrant` on all state-changing functions. Regression: `ProtocolFeeReentrancy.t.sol` (fails before the fix). |
| F-2 | Informational (pre-existing V1) | `PriceConverter` validated only `answer > 0`; Chainlink `updatedAt`/round completeness were not checked and feed decimals were implicitly assumed to be 8. Affects only the USD minimum gate, never the fee split or custody. | **Fixed in Phase 2.6**: freshness (`updatedAt != 0`, not in the future, age ≤ immutable per-feed `maxPriceAge`), positive answer, decimals read at construction and normalized to 18, typed errors, fail-closed on all ingress paths. Regression: `ProtocolOracle.t.sol` (mock matrix, max−1/max/max+1 boundaries, fuzz) and `ForkProtocolFeeMainnet.t.sol` (real feeds). V1 in production is unchanged and retains the original behavior. |
| F-3 | Informational | A gas-burning or reverting fee recipient can block or inflate fee-bearing ETH contributions. | Expected: fail closed; admin recovers by changing the recipient (tested). |
| F-4 | Expected behavior | A fee-on-transfer token that only taxes `transfer` is accepted at 0 bps (no outbound transfer occurs) and rejected at any non-zero rate. | Documented; policy is that such assets are unsupported. |

No Critical, High, or Medium findings. No fee bypass, double fee, over-cap
fee, admin/treasury asset access, or partial settlement was found by review,
fuzzing, or invariant testing.

## Running the campaigns

```bash
forge test --match-path 'test/fee-security/*'     # default: fuzz 512 runs, invariant 128 × depth 64
npm run contracts:security                         # heavy: fuzz 5000 runs, invariant 500 × depth 100 (~20 s)
MAINNET_RPC_URL=<rpc> forge test --match-contract ForkProtocolFeeMainnetTest -vv   # real feeds + WBTC/PAXG/XAU₮ on a local fork
```

CI runs both the default-strength and the heavy campaign on every PR (the
heavy run completes in well under a minute), plus the mainnet-fork suites
whenever `MAINNET_RPC_URL` is available (they skip cleanly otherwise).

## Gas after hardening (optimization deferred)

| Function | Pre-fee | Fee-enabled (Phase 2.4) | After Phase 2.5 guard | After Phase 2.6 oracle checks | Note |
| --- | --- | --- | --- | --- | --- |
| `fund` (1%, median) | ~35.3k | ~81.7k | ~81.7k | ~82.3k | +~0.6k for freshness checks and 18-decimal scaling |
| `fundERC20` (1%, median) | ~72.8k | ~116.9k | ~116.9k | ~117.7k | +~0.8k (per-token feed decimals / max age read from the packed slot) |
| `withdraw` | ~23.7k | ~23.7k | ~28.9k | ~28.9k | unchanged |
| `cheaperWithdraw` | ~23.5k | ~23.5k | ~28.6k | ~28.6k | unchanged |
| `withdrawToken` / `withdrawTokenAmount` | — | ~24k | ~29.2k / ~29.3k | ~29.2k / ~29.3k | unchanged |

Phase 2.6 numbers: `forge test --match-path test/ProtocolFeeFunding.t.sol --gas-report`
on the branch vs. its base (`e3804f5`). `TokenInfo` stays in one storage slot
(feed 20 B + token decimals 1 B + feed decimals 1 B + max age 4 B).

Gas optimization is intentionally deferred until after the security review;
none of the checks above may be removed to recover gas.

Suites: `ProtocolFeeFuzz`, `ProtocolFeeInvariant` (handler with two funders,
owner, co-owner, attacker, two admins, two treasuries; actions: fund ETH via
`fund`/`receive`/`fallback`, fund ERC-20, set fee (incl. over-cap and
unauthorized attempts), set treasury, propose/accept admin, partial/full ETH
and token withdrawals by owners and attacker, warp, expiry release),
`ProtocolFeeReentrancy`, `ProtocolFeeAdversarialERC20`,
`ProtocolFeeRoleAliasing`, `ProtocolFeeExpiration`, `ProtocolOracle`
(Phase 2.6: construction validation, mock matrix for zero/negative answer,
incomplete round, future timestamp, staleness, reverting feed; max−1/max/max+1
boundaries for ETH and ERC-20; fail-closed via `fund`/`receive`/`fallback`/
`fundERC20`; fee independence from price; decimal normalization and freshness
fuzz), `ForkProtocolFeeMainnet` (adds live inspection of ETH/USD, BTC/USD,
PAXG/USD and XAU/USD against the chosen thresholds and a real-feed
fail-closed check by warping the fork clock). Mocks live in
`test/fee-security/mocks/AdversarialMocks.sol`,
`test/fee-security/mocks/OracleMocks.sol` and `test/mocks/FeeMocks.sol`.

## Deferred, security-neutral gas observations (not implemented)

Recorded for a later optimization pass; none are required for correctness:
cache `address(this)` balances read twice in `fundERC20`; skip the recipient
`balanceOf` pair when `feeAmount == 0` (already skipped); consider
`transient` reentrancy storage (EIP-1153) once the toolchain and target EVM
are pinned to support it; avoid re-reading `protocolFeeBps` in
`getProtocolFeeConfig` callers that already hold a snapshot; custom-error
gas is already minimal.
