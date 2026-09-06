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
| XAU₮ | XAU/USD `0x214eD9Da11D2fbe465a6fc601a91E62EbEc1a0D6` | 8 | 86400 s | 0.3 % | **172800 s** | 2× heartbeat, same policy as PAXG/USD. Chainlink labels this a Precious Metals (market-hours) feed, but the Ethereum feed publishes 24/7/365 — see the measurement below. XAU₮ is enabled at launch; no market-hours exemption exists in the contracts. |

### XAU/USD publishing cadence — measured, not assumed

Phase 2.6 initially set XAU/USD to 259200 s on the assumption that a
Precious-Metals-labelled feed stops publishing when spot gold is closed
(Chainlink's schedule for that asset class is 18:00 ET Sunday open, 17:00 ET
Friday close, holidays Jan 1 / Good Friday / Dec 25). That assumption was taken
from a label, so it was measured against the chain before deployment.

Method: read the live aggregator behind the proxy
(`0x0e3dd634FFbF7EA89BbDCF09Ccc463302FD5f903`), then walk **consecutive**
`getRoundData` round IDs and diff `updatedAt`:

```bash
AGG=0x0e3dd634FFbF7EA89BbDCF09Ccc463302FD5f903
cast call $AGG "latestRound()(uint256)" --rpc-url "$RPC"
# then, for a contiguous range of round ids, diff updatedAt between neighbours
cast call $AGG "getRoundData(uint80)(uint80,int256,uint256,uint256,uint80)" <roundId> --rpc-url "$RPC"
```

Result (measured 2026-09-06, aggregator round 1 = 2024-08-01 through round
10057 = 2026-09-06):

| Window scanned (consecutive rounds) | Largest gap between consecutive rounds |
| --- | --- |
| 2024-11-22 → 2024-12-09 (r601–r721) | 24.01 h |
| 2025-07-22 → 2025-08-14 (r2401–r2521) | 24.01 h |
| 2026-01-30 → 2026-02-01 (r4561–r4681, a full weekend) | 24.01 h |
| Christmas 2025 (r3841–r3961, incl. Dec 25) | 24.01 h |
| Good Friday 2026 (r6841–r6961, incl. Apr 3) | 24.01 h |

The feed honours its 86400 s heartbeat through weekends and gold-market
holidays, republishing the frozen last-close price (e.g. `$4,051.28` unchanged
from Sat 2026-08-01 06:03 UTC to Sun 2026-08-02 14:00 UTC while `updatedAt`
kept advancing). 172800 s therefore leaves 2× margin over the largest gap ever
observed, exactly as for PAXG/USD, and no market-hours exemption is needed.

Consequence if that ever changes: a real publishing pause longer than 48 h
makes XAU₮ contributions revert with `PriceConverter__StalePrice` until a new
round lands. That is fail-closed — pool custody, owner withdrawals and expiry
release never consult the oracle. Because `maxPriceAge` is immutable, adapting
to a changed cadence means deploying a new pool, never touching ProtocolConfig.
Regression tests pin both sides of this in `ProtocolOracle.t.sol`
(`testDailyHeartbeatFeedRepublishingThroughAWeekendStaysFundable`,
`testFullWeekendPublishingPauseFailsClosedInsteadOfBeingWavedThrough`).

Incidental observation, recorded for transparency: in the sampled recent window
XAU/USD alternated between two values ~0.76 % apart (`$4,430.30` / `$4,464.03`)
on a roughly 3-minute cadence. It affects only which contributions clear the USD
minimum, by under 1 %; it cannot affect the fee split, the amount transferred or
custody.

### XAU₮ is priced from XAU/USD — documented assumption

Chainlink publishes no XAUT/USD **Data Feed** on Ethereum, so a XAU₮ pool prices
the token from spot gold (XAU/USD, per troy ounce; XAU₮ is 1 token = 1 troy
ounce, 6 decimals). This is an estimate of XAU₮'s value, not a XAU₮ market
price: any premium or discount of XAU₮ against spot gold, and any Tether Gold
redemption/credit risk, is not observed by the oracle. The same shape of
assumption already applies to WBTC, which is priced from BTC/USD.

It affects **only** the `minimumUsd` eligibility gate. The number of XAU₮ tokens
pulled from the funder, the protocol fee in XAU₮, the net XAU₮ credited to the
pool, and every withdrawal amount are all computed in token units and are
independent of the price.

Feed facts observed on the fork (all four): `decimals() == 8`, aggregator
`version() == 6`, `answeredInRound == roundId`, `updatedAt` within the chosen
threshold. Heartbeat and deviation are off-chain operator parameters and
cannot be read from the contract; they were taken from Chainlink's reference
data and should be re-checked on the day of deployment.

The `maxPriceAge` values are compiled into `script/DeployCommunityPool.s.sol`
as constants for chain id 1 and are immutable per pool once deployed. Changing
a threshold later means deploying a new pool; it never involves ProtocolConfig.

### Validation evidence (Phase 2.6)

- `forge test`: 247 tests passed, 13 skipped (fork and env-gated suites skip without RPC); `ProtocolOracle.t.sol` adds 44 tests.
- `npm run contracts:security` (fuzz 5000 runs, invariant 500 × depth 100): 120 passed.
- Mainnet fork (`MAINNET_RPC_URL`): 8 passed, including live feed inspection, a recent-round cadence check on both 24h-heartbeat feeds, and a real-feed fail-closed check.
- `vitest`: 486 passed; artifact boundary test asserts the 9-input constructor, the immutable oracle surface (no setters on V2, no oracle functions on ProtocolConfig) and the typed oracle errors.
- Anvil integration (V1 production helper and V2 candidate): passed.
- Candidate artifacts regenerated and gated by `git diff --exit-code`; frozen V1 unchanged.

### Not done in Phase 2.6 (by design)

No deployment, no testnet or mainnet transaction, no ProtocolConfig
deployment, no Fees-page change (it still states no fee is collected), no gas
optimization.

## Chainlink Data Streams: evaluated and not used for V2

XAU₮ pricing via a Chainlink **Data Stream** (pull-based, 24/7/365) was
evaluated as an alternative to the XAU/USD Data Feed and rejected for the V2
launch. Recorded so the decision is not re-litigated from scratch:

| Question | Finding (2026-09-06) |
| --- | --- |
| Ethereum mainnet usable? | Yes for verification: `VerifierProxy` `0x5A1634A86e9b7BfEf33F0f3f3EA3b1aBBc4CC85F` is deployed on chain 1 (7 KB of code; `s_feeManager()` returns the zero address, consistent with the documented subscription billing). |
| Is there a public XAUT/USD stream? | Not in the public catalog. The unauthenticated discovery endpoint (`https://api.dataengine.chain.link/api/v1/discovery`) returned 234 streams, including `PAXG/USD-Streams-CexPrice`, and **no** XAU or XAUT stream. Chainlink documents entitlement-gated "hidden streams" visible only to a provisioned API key, so obtaining XAUT/USD would require a commercial provisioning step. |
| Report retrieval | Pull model: the consumer fetches a signed report from the Data Streams REST API or WebSocket and passes the bytes into `verifierProxy.verify(payload, "")` in the same transaction. |
| Credentials | HMAC-SHA256 with a user ID plus a shared secret (three headers). Only the discovery endpoint is unauthenticated. The secret cannot live in browser code, so CommunityPool would need a server-side report proxy — a new privileged secret and a new availability dependency on the critical path of every XAU₮ contribution. |
| Cost | Subscription billing through `app.chain.link` (Stripe, 30-day cycles). Pay-per-verification is deprecated and there is **no free tier**. Self-service REST limit is 10 req/s. |
| Contract impact | A report-carrying funding path (e.g. `fundERC20(token, amount, report)`), a new external call to the verifier, report decoding, `feedId` and `expiresAt` validation, and replay handling — i.e. a second funding ABI alongside the plain one, and a larger audit surface, for exactly one asset. |
| UX impact | Funding stays one wallet transaction, but it first requires a successful backend + Chainlink API round trip; an outage of either makes XAU₮ unfundable. |

**Classification: HIGH complexity. Not used for V2.** The deciding factors are
the absent public stream, the paid subscription with no free tier, and the
server-side secret that would put a backend on the critical path of a funding
transaction that is otherwise wallet-to-contract. The Data Feed path needs none
of that, and the measurement above shows it already provides 24/7 coverage for
XAU₮.

## Phase 2.7 canary checklist (non-executing)

Each step is a gate; stop at the first failure. Never paste private keys or
RPC URLs with embedded keys into a shell history, a log or this repo.

1. **Freeze the code.** Merge Phase 2.6; tag the commit; confirm
   `npm run contracts:check-artifact` and `contracts:check-v1-frozen` pass on
   the tag and the candidate keccaks match the record above.
2. **Re-verify feeds on deployment day.** For each of the four proxies:
   `decimals() == 8`, `latestRoundData()` fresh within the chosen
   `maxPriceAge`, heartbeat/deviation unchanged in Chainlink's reference data.
   Re-run the XAU/USD consecutive-round walk above over the most recent full
   weekend and confirm the largest gap is still well inside 172800 s; if the
   feed has moved to market-hours publishing, stop and re-decide the threshold
   before deploying.
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
