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
| Funding economics | 100% stays in the pool | **100% stays in the pool (unchanged)** |
| Fee transfer | none | **none** |
| Withdrawal / ownership rules | as today | **identical** |
| Existing mainnet pools | `0x0b4D…47c0`, `0xb740…B767`, immutable | unaffected; they never charge a fee |

No production funding fee is active. The configured 1% exists only as
configuration in tests and candidate contracts. There is no ETH fee transfer
and no ERC-20 fee transfer anywhere in the code. Fee collection is a later,
separately reviewed change.

## Authority model

| Actor | May | May not |
| --- | --- | --- |
| ProtocolConfig `admin` | set `protocolFeeBps` within 0–300; set `feeRecipient` to any non-zero address (EOA or contract); propose a successor admin | withdraw or move any pool ETH or ERC-20; change pool owners, expiry, minimum, or allowlist; raise the 300 bps cap; renounce (no such function) |
| ProtocolConfig `feeRecipient` | receive fees once collection exists | anything else; it is not an admin and not a pool owner |
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
