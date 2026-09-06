# ProtocolConfig: shared protocol configuration (Phase 2.1–2.2)

`src/ProtocolConfig.sol` is the control plane for the upcoming protocol-fee
model. It holds the protocol fee rate and the fee recipient once, for the whole
chain; every fee-enabled CommunityPool holds an immutable reference to it and
reads the current values on demand.

> ProtocolConfig controls protocol configuration, not CommunityPool assets.

```text
                    ProtocolConfig
                    ──────────────
                    admin
                    pendingAdmin
                    feeRecipient
                    protocolFeeBps            0 … 300 (bps)
                    BPS_DENOMINATOR           10_000  (= 100%)
                    MAX_PROTOCOL_FEE_BPS      300     (= 3%, compile-time constant)
                           │
                  live reads (never snapshotted)
                           │
             ┌─────────────┼─────────────┐
             ▼             ▼             ▼
      CommunityPool   CommunityPool   CommunityPool   (V2 candidates)
        immutable       immutable       immutable
       protocolConfig  protocolConfig  protocolConfig
```

## Contract versions

| | V1 (production today) | V2 candidate (this repository's `src/`) |
| --- | --- | --- |
| Constructor | 7 arguments | 8 arguments: adds `address protocolConfig_` |
| Config reference | none | `IProtocolConfig public immutable protocolConfig` |
| Config read | none | `getProtocolFeeConfig() → (feeBps, recipient)`, live |
| `PoolCreated` | 7 fields | adds `address indexed protocolConfig` |
| Funding economics | 100% stays in the pool | gross contribution split: `fee = floor(gross × bps / 10_000)` → recipient, `net = gross − fee` → pool |
| Fee transfer | none | ETH: checked low-level call to the recipient; ERC-20: `safeTransfer` with exact balance-delta verification |
| Withdrawal / ownership rules | as today | **identical** |
| Existing mainnet pools | `0x0b4D…47c0`, `0xb740…B767`, immutable | unaffected; they never charge a fee |

No production funding fee is active: production still deploys the frozen V1
artifact, no ProtocolConfig is deployed, and the live Fees page still says the
model is transitioning. Fee collection exists only in the V2 candidate
(`src/CommunityPool.sol`) and its tests.

## V2 candidate fee economics (Phase 2.3–2.4)

- **Gross semantics.** The amount the funder chooses is the gross contribution
  (`msg.value`, or the ERC-20 `grossAmount`). The fee is deducted from it; a
  funder is never charged gross + fee, and the ERC-20 path never pulls more
  than `grossAmount`, so an allowance of exactly `grossAmount` is sufficient.
- **Fee math.** `feeAmount = floor(gross × protocolFeeBps / 10_000)` via
  `Math.mulDiv`; `netAmount = gross − feeAmount`; always `fee + net == gross`
  and `fee ≤ 3% of gross`. Rounding to a zero fee is valid and makes no
  transfer. At 100 bps: 10,000 → 100; 1,000 → 10; 100 → 1; 99 → 0.
- **Minimum.** `minimumUsd` is evaluated on the gross contribution, before the
  fee. A contribution exactly at the minimum is accepted even though the pool
  receives slightly less.
- **One snapshot per contribution.** The rate is read once; the recipient is
  read only when a fee is due; both are validated; then the transfer happens.
- **Defense in depth.** The pool re-checks the 300 bps cap and rejects a zero
  or self (`address(this)`) recipient, so a malformed non-official config fails
  closed (`CommunityPool__ProtocolFeeExceedsMaximum`,
  `CommunityPool__InvalidFeeRecipient`). A reverting config read propagates.
- **ETH.** Fee sent with a checked `call{value}`; the pool already holds
  `msg.value`, so only the fee leaves. A recipient that rejects ETH reverts the
  whole contribution (`CommunityPool__ProtocolFeeTransferFailed`); nothing is
  skipped or retained. Operational consequence: a fee recipient must be able to
  receive ETH, and a misconfigured recipient blocks fee-bearing ETH
  contributions until the admin corrects it. `fund`, `receive`, and `fallback`
  charge identically.
- **ERC-20.** Pull exactly `grossAmount` with `safeTransferFrom`, forward
  exactly `feeAmount` with `safeTransfer`, verify both balance deltas. Any
  deviation reverts (`CommunityPool__UnsupportedTokenBehavior`). **CommunityPool
  V2 supports ERC-20 assets with exact transfer accounting. Fee-on-transfer /
  rebasing behavior is unsupported unless explicitly added in a future reviewed
  contract version.**
- **Reentrancy.** Every state-changing function (`fund`, `fundERC20`,
  `withdraw`, `cheaperWithdraw`, `withdrawToken`, `withdrawTokenAmount`,
  `releaseExpiredFundsToDeployer`) shares one OpenZeppelin `ReentrancyGuard`.
  Phase 2.5 showed that guarding only the funding paths let a fee recipient
  that is *also* an explicitly authorized owner withdraw from inside the ETH fee
  callback, emitting `Withdrawn` before the contribution's `Funded` event and,
  for a callback-capable ERC-20, tripping the exact-transfer check. No
  authority was gained, but settlement ordering was incoherent. With the shared
  guard, nothing else can execute while a contribution settles; owner rights are
  unchanged outside the callback.
- **Events.** `Funded(funder, feeRecipient, gross, fee, net)` and
  `FundedERC20(token, funder, feeRecipient, gross, fee, net)` are emitted only
  after all transfers succeed; `feeRecipient` is zero when the fee is zero.
- **Owners withdraw only what remains.** The paid fee is with the treasury;
  `cheaperWithdraw` and `releaseExpiredFundsToDeployer` release the net.

## Authority model

| Actor | May | May not |
| --- | --- | --- |
| ProtocolConfig `admin` | set `protocolFeeBps` within 0–300; set `feeRecipient` to any non-zero address (EOA or contract); propose a successor admin | withdraw or move any pool ETH or ERC-20; change pool owners, expiry, minimum, or allowlist; raise the 300 bps cap; renounce (no such function) |
| ProtocolConfig `feeRecipient` | receive fees (V2 candidate) | anything else; it is not an admin and not a pool owner |
| CommunityPool owners (deployer + explicit co-owners) | withdraw pool assets before expiry, exactly as today | change protocol configuration |

Being the ProtocolConfig admin grants no CommunityPool ownership or withdrawal
privilege by itself. A pool deployer may deliberately list any address,
including the admin, as a co-owner; that is pool-level consent and does not
propagate to other pools. Tests: `test/ProtocolConfigIntegration.t.sol`
(`testConfigAdminCannotWithdrawEth`, `testConfigAdminCannotWithdrawErc20`,
`testFeeRecipientCannotWithdraw`, `testExplicitCoOwnershipIsTheOnlyPathToPoolAuthority`).

ProtocolConfig has no payable function, no `receive`/`fallback`, no
`delegatecall`, no external calls, no proxy, and no upgrade path. It cannot
hold or move ETH or tokens.

## Two-step admin handoff

```text
admin ──transferAdmin(newAdmin)──▶ pendingAdmin = newAdmin   (admin keeps full authority)
newAdmin ──acceptAdmin()──▶ admin = newAdmin, pendingAdmin = 0
```

Only the current admin may propose; a zero address is rejected; only the
pending admin may accept; the previous admin loses authority atomically on
acceptance. This lets the control key move from the dedicated MetaMask
account to a Safe/multisig later without redeploying ProtocolConfig or any
pool. There is deliberately no `renounceAdmin`.

## Constructor and deployment values

`ProtocolConfig(admin_, feeRecipient_, initialProtocolFeeBps_)`; all validated
(non-zero addresses, fee ≤ 300). The intended mainnet values (admin, treasury,
100 bps) are deployment-time parameters for a later phase. They are not
hardcoded in any contract, script, or frontend module, and the artifact
boundary test asserts that they are absent from production code.

`script/DeployCommunityPool.s.sol` requires `PROTOCOL_CONFIG_ADDRESS` on
mainnet and Sepolia (an address with code) and refuses to run without it. On a
local chain it deploys a throwaway fixture config for the broadcaster if no
address is supplied.

## Why the constructor requires code at the config address

The reference is immutable, and once fee collection exists every funding call
will read from it. A pool bound to an address without code would revert on
every future fee-aware funding call and be permanently bricked. Requiring
`protocolConfig_.code.length > 0` at construction catches a mistyped or
not-yet-deployed address at the only moment it can still be corrected. It does
not block any deployment pattern in use here (the config always exists before
pools do).

## Production activation boundary

Production continues to deploy V1 from the frozen artifact
`lib/onchain/community-pool-v1-artifact.json`. The V2 candidate artifact and
the ProtocolConfig candidate artifact are generated and gated in CI but are not
wired into `deployCommunityPool`. Activation requires a real ProtocolConfig
deployment on the target chain and is an explicit future phase; see
`docs/contracts-build.md`.
