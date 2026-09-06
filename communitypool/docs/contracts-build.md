# CommunityPool contract build: canonical toolchain and V1 provenance

This document is the source of truth for how `src/CommunityPool.sol` is
compiled into `lib/onchain/community-pool-artifact.json`, the file the
Next.js app uses to deploy every new pool. It was established in Phase 2.0
(2026-09-06) after the artifact was found to be non-reproducible.

## Canonical build (from Phase 2.0 onward)

| Input | Pinned value | Where |
| --- | --- | --- |
| Solidity compiler | `0.8.26+commit.8a97fa7a` | `foundry.toml` `solc_version`, `auto_detect_solc = false` |
| EVM target | `cancun` | `foundry.toml` `evm_version` |
| Optimizer | enabled, 200 runs | `foundry.toml` |
| `via_ir` | `false` | `foundry.toml` |
| Metadata | `bytecode_hash = "ipfs"`, `cbor_metadata = true` | `foundry.toml` |
| Remappings | the four explicit entries in `foundry.toml`; `auto_detect_remappings = false` | `foundry.toml` |
| OpenZeppelin | git submodule `lib/openzeppelin-contracts` at tag `v5.6.1` | `.gitmodules` pointer + `foundry.lock` |
| Chainlink, forge-std, foundry-devops | submodule pointers as committed | `foundry.lock` |
| Foundry (CI) | `v1.8.1` via `foundry-rs/foundry-toolchain` | `.github/workflows/ci.yml` |
| Artifact generation | `forge clean && forge build && node scripts/sync-contract-artifact.mjs` | `scripts/sync-contract-artifact.mjs` |

Why each pin exists:

- **Explicit remappings only.** Foundry auto-discovers remappings from every
  directory under `lib/`, including nested submodules and leftover untracked
  checkouts. The full remapping list is part of the solc metadata JSON, whose
  IPFS hash is embedded in the last 53 bytes of the bytecode. With
  auto-detection on, the *same source and compiler* produced different
  bytecode depending on which directories happened to exist on disk. Two
  otherwise identical clean builds differed only because one machine had a
  stale `lib/openzeppelin-contracts/lib/halmos-cheatcodes` directory.
- **`evm_version` pinned.** solc 0.8.26 defaults to cancun, and Foundry
  normalises its own default to the compiler's maximum, but a future Foundry
  or solc bump must not be able to change codegen silently.
- **Foundry pinned in CI.** Foundry 1.5.1 and 1.8.1 produced identical logic
  bytecode for this source with explicit remappings, but the toolchain still
  decides defaults, so it is pinned and bumped deliberately.
- **Settings asserted at artifact time.** `sync-contract-artifact.mjs` reads
  the compiler settings recorded in `forge-out` and refuses to write or
  check an artifact produced with a different compiler, EVM target,
  optimizer, remapping set, or linked libraries.

Reproducing locally:

```bash
cd communitypool
git submodule update --init --recursive
forge clean && forge build --sizes
node scripts/sync-contract-artifact.mjs           # regenerate
git diff --exit-code -- lib/onchain/community-pool-artifact.json   # must be empty
node scripts/sync-contract-artifact.mjs --check   # local equivalent
```

Any diff in the artifact means either the contract, a dependency, or the
canonical configuration changed. A changed `bytecode` field changes what the
app deploys and must be reviewed as a deployment-affecting change before it
is committed.

## CI integrity gate

The `contracts` job runs, in order: checkout with submodules, pinned Foundry,
`forge clean`, `forge build --sizes`, `forge test`, regenerate the artifact,
then `git diff --exit-code -- lib/onchain/community-pool-artifact.json`.
The diff is against the file committed at the SHA under test, so the check is
independent of the regeneration step. The previous pipeline regenerated the
file and then ran `--check` against the file it had just written, which could
never fail.

## V1 provenance (pools deployed before Phase 2)

Facts established read-only in Phase 2.0:

- The V1 artifact (unchanged from the initial commit on 2026-04-29 until
  Phase 2.0; creation bytecode keccak
  `0xba3a946b29d13e94ff71502371d46778235ce342f6250134b0dd1bbafc534f44`)
  is byte-for-byte the creation code of both
  mainnet V1 pools, `0x0b4DfD735680B6d3d2c0c9bda23A80f5E15A47c0` and
  `0xb740dFB3F3C93bc33e8AAF76B205E91CCdeAB767` (chain 1, blocks 25043443 and
  25043446, 2026-05-07). Their runtime code, with the four immutables
  (`minimumUsd`, `expiresAt`, `deployer`, `i_ethUsdFeed`) normalised using the
  compiler's `immutableReferences`, equals the runtime template of a clean
  build against OpenZeppelin v5.5.0 through v5.7.0, and the runtime CBOR
  trailer equals the artifact's.
- The artifact's **logic** bytecode is reproduced exactly by solc 0.8.26,
  optimizer 200 runs, cancun, with OpenZeppelin at any revision from v5.5.0
  (2025-10-31) through master as of 2026-04-12. It is **not** reproduced by
  the OpenZeppelin v5.0.2 revision the submodule pointed at: 5.0.x
  `SafeERC20` pulls in `Address` and adds three ABI errors and ~240 bytes.
- The artifact's **metadata hash** (last 53 bytes) was not reproduced by any
  evidence-driven candidate. The remaining unknown is the exact auto-detected
  remapping list on the developer's machine in April 2026, which is precisely
  the nondeterminism the canonical configuration removes.

Consequence: the canonical build produces the same runtime and creation
logic as the V1 pools, with a different metadata trailer. The canonical
artifact's creation bytecode keccak is
`0xf564efc7c38adc4016e2e09b431d33797f597d4e0fb174bd818bebafb4060c98`; it
differs from the V1 artifact only in the trailing CBOR metadata (IPFS hash of
the metadata JSON). New pools deployed from the canonical artifact are
functionally identical to V1 pools.
