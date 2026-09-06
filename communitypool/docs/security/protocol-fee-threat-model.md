# Protocol fee: threat model, tested invariants, and trust assumptions

Scope: the CommunityPool **V2 candidate** (`src/CommunityPool.sol`) and
`src/ProtocolConfig.sol` after Phase 2.3–2.4 (fee collection) and Phase 2.5
(adversarial hardening). Production still deploys the frozen V1 artifact; V2
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

## Phase 2.5 findings

| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| F-1 | Low | Cross-function reentrancy by a fee recipient that is also an explicit owner: guarding only the funding paths let it call `withdraw`/`cheaperWithdraw`/`withdrawToken`/`withdrawTokenAmount` from inside the ETH fee callback (`Withdrawn` emitted before the contribution's `Funded`; for a callback ERC-20 the exact-transfer check then reverted the contribution). No authority gain, no fund loss; settlement/event ordering incoherent. | Fixed: shared `nonReentrant` on all state-changing functions. Regression: `ProtocolFeeReentrancy.t.sol` (fails before the fix). |
| F-2 | Informational (pre-existing V1) | `PriceConverter` validates only `answer > 0`; Chainlink `updatedAt`/round completeness are not checked. Affects only the USD minimum gate, never the fee split or custody. | Documented; evaluate for Phase 2.6 deployment readiness. |
| F-3 | Informational | A gas-burning or reverting fee recipient can block or inflate fee-bearing ETH contributions. | Expected: fail closed; admin recovers by changing the recipient (tested). |
| F-4 | Expected behavior | A fee-on-transfer token that only taxes `transfer` is accepted at 0 bps (no outbound transfer occurs) and rejected at any non-zero rate. | Documented; policy is that such assets are unsupported. |

No Critical, High, or Medium findings. No fee bypass, double fee, over-cap
fee, admin/treasury asset access, or partial settlement was found by review,
fuzzing, or invariant testing.

## Running the campaigns

```bash
forge test --match-path 'test/fee-security/*'     # default: fuzz 512 runs, invariant 128 × depth 64
npm run contracts:security                         # heavy: fuzz 5000 runs, invariant 500 × depth 100 (~20 s)
MAINNET_RPC_URL=<rpc> forge test --match-contract ForkProtocolFeeMainnetTest -vv   # real WBTC/PAXG on a local fork
```

CI runs both the default-strength and the heavy campaign on every PR (the
heavy run completes in well under a minute), plus the mainnet-fork suites
whenever `MAINNET_RPC_URL` is available (they skip cleanly otherwise).

## Gas after hardening (optimization deferred)

| Function | Pre-fee | Fee-enabled (Phase 2.4) | After Phase 2.5 guard | Note |
| --- | --- | --- | --- | --- |
| `fund` (1%, median) | ~35.3k | ~81.7k | ~81.7k | unchanged; dominated by the fee transfer |
| `fundERC20` (1%, median) | ~72.8k | ~116.9k | ~116.9k | unchanged |
| `withdraw` | ~23.7k | ~23.7k | ~28.9k | +~5.1k for the shared reentrancy guard |
| `cheaperWithdraw` | ~23.5k | ~23.5k | ~28.6k | +~5.1k |
| `withdrawToken` / `withdrawTokenAmount` | — | ~24k | ~29.2k / ~29.3k | +~5k |

Gas optimization is intentionally deferred until after the security review;
none of the checks above may be removed to recover gas.

Suites: `ProtocolFeeFuzz`, `ProtocolFeeInvariant` (handler with two funders,
owner, co-owner, attacker, two admins, two treasuries; actions: fund ETH via
`fund`/`receive`/`fallback`, fund ERC-20, set fee (incl. over-cap and
unauthorized attempts), set treasury, propose/accept admin, partial/full ETH
and token withdrawals by owners and attacker, warp, expiry release),
`ProtocolFeeReentrancy`, `ProtocolFeeAdversarialERC20`,
`ProtocolFeeRoleAliasing`, `ProtocolFeeExpiration`, `ForkProtocolFeeMainnet`.
Mocks live in `test/fee-security/mocks/AdversarialMocks.sol` and
`test/mocks/FeeMocks.sol`.

## Deferred, security-neutral gas observations (not implemented)

Recorded for a later optimization pass; none are required for correctness:
cache `address(this)` balances read twice in `fundERC20`; skip the recipient
`balanceOf` pair when `feeAmount == 0` (already skipped); consider
`transient` reentrancy storage (EIP-1153) once the toolchain and target EVM
are pinned to support it; avoid re-reading `protocolFeeBps` in
`getProtocolFeeConfig` callers that already hold a snapshot; custom-error
gas is already minimal.
