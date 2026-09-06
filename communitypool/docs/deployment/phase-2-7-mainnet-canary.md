# Phase 2.7 mainnet canary: deployment-readiness record and checklist

Status: **record only**. Nothing in this document has been executed. Phase 2.6
left the V2 candidate ready for a canary deployment; Phase 2.7 is a separate,
explicitly authorized step. Production keeps deploying the frozen V1 artifact
until Phase 2.8 activation.

## Readiness record (Phase 2.6, 2026-09-06)

| Item | Value |
| --- | --- |
| Target chain | Ethereum mainnet (chain id 1) |
| Contracts | `ProtocolConfig` (candidate artifact) and `CommunityPool` V2 (candidate artifact) |
| Canonical build | solc 0.8.26, EVM cancun, optimizer 200 runs, OpenZeppelin v5.6.1, Foundry v1.8.1 (see `docs/contracts-build.md`) |
| V2 candidate creation-bytecode keccak | `0x65b585a164c956282c7efc27775926b54fbcc58387e3fea442e1fcff3db7181f` |
| ProtocolConfig candidate creation-bytecode keccak | `0x5caa00a303fa82eaee556ef89cc31424c1c1dcd9ab0c858ae5d231ad2717196c` |
| Frozen V1 (production) keccak | `0xf564efc7c38adc4016e2e09b431d33797f597d4e0fb174bd818bebafb4060c98` (unchanged) |
| ProtocolConfig constructor values | admin `0xD57Eb1eBebB688914974742d24997A8E491A92DA`, feeRecipient (treasury) `0x826fFBd71350b9d1Ed3c23d9f48f92a061b2C222`, initial fee 100 bps. **Deployment-time inputs only**: they appear in no contract, script or frontend module (asserted by `test/security/contract-artifact-boundary.test.ts`). |
| Fee cap | 300 bps, enforced in ProtocolConfig and re-checked in every pool |
| Upgradeability | none; per-pool thresholds and feeds are immutable |

### Verified Chainlink mainnet feeds

Source: Chainlink's reference data directory (`feeds-mainnet.json`) and
on-chain reads of each proxy on a local fork at block 25919164 (2026-09-06).
The deploy script wires exactly these addresses; the same addresses already
serve V1 in `lib/onchain/pool-chain-config.ts`.

| Asset priced | Feed (proxy) | Decimals | Heartbeat | Deviation | Chosen `maxPriceAge` | Rationale |
| --- | --- | --- | --- | --- | --- | --- |
| ETH (native) | ETH/USD `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419` | 8 | 3600 s | 0.5 % | **7200 s** | 2× heartbeat: tolerates one late round, rejects two |
| WBTC | BTC/USD `0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c` | 8 | 3600 s | 0.5 % | **7200 s** | Chainlink publishes no WBTC/USD feed (only WBTC/BTC and a WBTC proof-of-reserve). Pricing WBTC at BTC/USD assumes the peg; this is the existing V1 policy and is unchanged. |
| PAXG | PAXG/USD `0x9944D86CEB9160aF5C5feB251FD671923323f8C3` | 8 | 86400 s | 0.5 % | **172800 s** | 2× heartbeat |
| XAU₮ | XAU/USD `0x214eD9Da11D2fbe465a6fc601a91E62EbEc1a0D6` | 8 | 86400 s | 0.3 % | **259200 s** | Market-hours feed (Precious_Metals): no rounds over weekends/holidays, so 2× heartbeat would make XAU₮ unfundable every weekend. 3× (72 h) covers a normal weekend; long holiday weekends still exceed it and XAU₮ simply becomes temporarily unfundable (fail closed). **User decision required before the canary**: keep XAU₮ at 259200 s, or exclude it from the canary pool. |

Feed facts observed on the fork (all four): `decimals() == 8`, aggregator
`version() == 6`, `answeredInRound == roundId`, `updatedAt` within the chosen
threshold. Heartbeat and deviation are off-chain operator parameters and
cannot be read from the contract; they were taken from Chainlink's reference
data and should be re-checked on the day of deployment.

The `maxPriceAge` values are compiled into `script/DeployCommunityPool.s.sol`
as constants for chain id 1 and are immutable per pool once deployed. Changing
a threshold later means deploying a new pool; it never involves ProtocolConfig.

### Validation evidence (Phase 2.6)

- `forge test`: 245 tests passed, 13 skipped (fork and env-gated suites skip without RPC); `ProtocolOracle.t.sol` adds 42 tests.
- `npm run contracts:security` (fuzz 5000 runs, invariant 500 × depth 100): 120 passed.
- Mainnet fork (`MAINNET_RPC_URL`): 7 passed, including live feed inspection and a real-feed fail-closed check.
- `vitest`: 486 passed; artifact boundary test asserts the 9-input constructor, the immutable oracle surface (no setters on V2, no oracle functions on ProtocolConfig) and the typed oracle errors.
- Anvil integration (V1 production helper and V2 candidate): passed.
- Candidate artifacts regenerated and gated by `git diff --exit-code`; frozen V1 unchanged.

### Not done in Phase 2.6 (by design)

No deployment, no testnet or mainnet transaction, no ProtocolConfig
deployment, no Fees-page change (it still states no fee is collected), no gas
optimization.

## Phase 2.7 canary checklist (non-executing)

Each step is a gate; stop at the first failure. Never paste private keys or
RPC URLs with embedded keys into a shell history, a log or this repo.

1. **Freeze the code.** Merge Phase 2.6; tag the commit; confirm
   `npm run contracts:check-artifact` and `contracts:check-v1-frozen` pass on
   the tag and the candidate keccaks match the record above.
2. **Re-verify feeds on deployment day.** For each of the four proxies:
   `decimals() == 8`, `latestRoundData()` fresh within the chosen
   `maxPriceAge`, heartbeat/deviation unchanged in Chainlink's reference data.
   Decide XAU₮ (keep at 259200 s or exclude).
3. **Deploy ProtocolConfig** with admin, feeRecipient and 100 bps from a
   funded deployer; verify source on Etherscan against the canonical build;
   read back `admin()`, `feeRecipient()`, `protocolFeeBps()`; confirm the
   treasury can receive ETH (send a dust transfer from the deployer).
4. **Deploy one canary pool** via `script/DeployCommunityPool.s.sol` with
   `PROTOCOL_CONFIG_ADDRESS` set, a small `MINIMUM_USD`, a short expiry, and
   the deployer as sole owner; verify source; read `getEthUsdFeed()` and
   `getTokenInfo()` for every asset and compare with the table.
5. **Exercise with dust.** One ETH contribution above the minimum (expect a
   `Funded` event with fee == 1 % of gross to the treasury); one below the
   minimum (expect `CommunityPool__BelowMinimumUsd`); one WBTC contribution
   if inventory is available; one owner withdrawal. Record tx hashes and gas
   spent; gas is a real cost even on success.
6. **Observe for at least one ETH/USD heartbeat interval** (1 h) and one
   PAXG/XAU interval (24 h) with no unexpected reverts; watch for
   `PriceConverter__StalePrice` on the feeds.
7. **Decision.** Either close the canary (withdraw, let it expire) and proceed
   to Phase 2.8 activation, or roll back by simply not activating; nothing
   deployed in the canary is referenced by production.
8. **Record** the ProtocolConfig address, pool address, tx hashes, gas totals
   and any anomalies in this document before Phase 2.8.
