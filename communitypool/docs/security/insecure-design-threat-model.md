# CommunityPool — Insecure Design Threat Model (OWASP A06:2025)

Last reviewed: 2026-04-27.
Scope: A06 (Insecure Design) only. A01/A02/A03/A04/A05 referenced only where the design control is the missing piece.

This document is the design-level companion to the per-control docs in this folder. It captures critical assets, sources of truth, misuse cases, required invariants, and accepted v1 tradeoffs so future contributors don't have to rediscover them.

## 1. Critical assets

| Asset | Why it matters |
|---|---|
| Deployer EOA / hardware-wallet keys | Sign mainnet pool deploys and any owner withdraws. Loss = loss of funds. (See `mainnet-deployment-key-policy.md`.) |
| User Supabase row (auth + profile + billing cache) | Drives KYC gate, Pro gate (display), pool-activity cache, watch-only address list. |
| `user_billing_state` row | Cached subscription state. Misread = wrongful Pro grant or wrongful denial. |
| `pool_owner_memberships` row | Cached owner list. Out-of-sync = withdraw UX deny/false grant. |
| Pool contract (deployed) | Holds real ETH/ERC20. Owner array immutable. |
| Pool funds | Any single owner can drain. No threshold control. |
| Stripe customer + subscription | Source of truth for Pro entitlement. |
| Self-reported KYC fields | Self-reported only — gate, not verification. |

## 2. Actors and trust levels

| Actor | Trust |
|---|---|
| Anonymous web visitor | None. Limited to public reads (pricing, marketing). |
| Authenticated user (anon-key session) | RLS-bounded; can read/write only own rows. |
| Authenticated user holding wallet | Trusted to sign their own txs; not trusted about chain state. |
| Service-role admin client (server) | Trusted; used only by `/api/*` handlers and webhook. Compromise = full DB control. |
| Stripe webhook | Trusted only after signature verification with `STRIPE_WEBHOOK_SECRET`. |
| RPC/Indexer (Alchemy, Etherscan v2) | Untrusted for finality; used for reads, not as final auth signal. |
| Smart contract on-chain | Source of truth for ownership, balance, expiry. |

## 3. Trust boundaries

1. **Browser ↔ Supabase (anon key)** — RLS enforces per-user scoping. Users cannot write `user_billing_state`, `pool_owner_memberships`, or pool ownership rows (service-role-only after migration `20260427130000`).
2. **Browser ↔ Next.js API routes** — Routes are server-side; they read auth via Supabase SSR client and re-verify on-chain state before persisting (see `/api/pools/owners/route.ts`).
3. **Server ↔ Stripe** — Webhook is signature-verified. Outbound calls use server-only `STRIPE_SECRET_KEY`.
4. **Server ↔ chain** — Reads via RPC providers, writes via the user's wallet (server never holds user keys).
5. **Wallet ↔ chain** — `assertChainMatchesExpected` (`lib/onchain/community-pool.ts`) blocks tx broadcast if wallet chain ID ≠ `NEXT_PUBLIC_EXPECTED_CHAIN_ID`.

## 4. Sources of truth

| Domain | Source of truth | Cache / derived | Reconciliation control |
|---|---|---|---|
| Auth identity | Supabase Auth (signed JWT) | Session cookie | Middleware (`lib/supabase/middleware.ts`) refreshes per request. |
| Profile / KYC completion | `user_profiles` row (PG generated column `kyc_profile_completed`) | Frontend form state | Server-side `fetchKycStatus` re-checks before deploy (`deploy-pool-modal.tsx`). |
| Subscription / Pro entitlement | **Stripe** | `user_billing_state` (RLS read-own, service-role-only writes) | Webhook events: `checkout.session.completed`, `customer.subscription.{created,updated,deleted}`, `invoice.{paid,payment_failed}`. |
| Pool deployment existence | **On-chain bytecode** | `user_pool_activity` row + browser localStorage | Upserted in `onDeployed` callback after both deploy + initial fund tx confirm. |
| Pool ownership | **On-chain `isOwner(addr)`** | `pool_owner_memberssh` (service-role-only, server pre-verifies on chain before insert) | Modal re-checks `pool.isOwner(walletAddress)` immediately before withdraw. DB cache is never authoritative. |
| Pool balance | **RPC `balanceOf` / `getBalance`** | `user_pool_activity.total_usd_estimate` | Cache refreshed inside `upsertPoolActivity` from chain reads. |
| Tx success | **RPC receipt (1 confirmation)** | `user_pool_activity.last_tx_hashes[]` (deduped via Set) | None for confirmed-then-DB-failed orphan. (See finding F-01.) |
| Open/closed state | **On-chain `expiresAt`** | `expires_at_unix` in DB | Read at render; modal re-reads on open. |
| Chain (mainnet vs testnet) | `NEXT_PUBLIC_EXPECTED_CHAIN_ID` (build-time) + wallet chain ID | — | Hard-fail in prod if env unset (`lib/wallet/expected-chain.ts`). |
| Token allowlist (per pool) | **Pool constructor `tokenConfigs` (immutable)** | `lib/onchain/pool-chain-config.ts` presets | Sepolia presets require explicit env vars; no fallback to mainnet addresses. |
| Watch-only saved addresses | User's own `user_address_balances` row | Memory cache TTL'd | RLS read-own only. **Not** an authorization signal. |

## 5. Critical workflows

### 5.1 Auth (email OTP code-only + Google OAuth)
- Server-issued OTP via Supabase; rate-limited per email + per IP.
- No password paths, no `emailRedirectTo` (per `project_resend_sandbox` memory).
- Session cookies are signed by Supabase and refreshed by middleware.

### 5.2 Profile / KYC completion
- 7 self-reported fields (full name, phone, address line 1, city, state, postal, country).
- `kyc_profile_completed` is a Postgres GENERATED column — clients cannot forge.
- Gate is server-checked before deploy via `fetchKycStatus`.
- **Self-reported only — not identity verification.** UI must not claim "verified."

### 5.3 Subscription (Stripe)
- Stripe is authoritative; `user_billing_state` is an eventually-consistent cache populated by signed webhooks.
- `user_id` resolved via `metadata.user_id` first (Stripe-signed), fallback to `stripe_customer_id` lookup.
- Upserts keyed on `user_id`; idempotent on duplicate webhooks.
- `cancel_at_period_end` and `cancel_at` (Dahlia API) both treated as "scheduled to cancel."

### 5.4 Pool deployment
- Two-tx flow: (1) `deployCommunityPool` then (2) initial `fund(USD)` from same modal.
- Chain ID asserted before tx broadcast.
- Co-owner list normalized + deduped client-side; contract also rejects duplicates and zero-address.
- `onDeployed` callback fires only after **both** txs confirm. DB write happens in callback; localStorage updated.
- Owner persistence path: `POST /api/pools/owners` re-verifies each candidate via `pool.isOwner()` before service-role insert.

### 5.5 Funding
- USD input → on-chain conversion via Chainlink at tx submit time.
- `+1` wei rounding bias to clear `MINIMUM_USD` boundary.
- ERC20 path uses `approve` then `fund`; no over-approval.
- DB write occurs in `onFunded` callback after `await tx.wait()`.

### 5.6 Withdrawal
- Ownership re-verified via `pool.isOwner(walletAddress)` immediately before sign.
- Partial-vs-full detected by selector scan in pool bytecode (`poolSupportsPartialWithdraw`); legacy pools fall back to full-balance only.
- For custom (non-preset) ERC20s, partial USD-denominated withdraw is disabled; only Max is allowed.
- Pool can have ETH and ERC20 withdrawn in the same flow; on partial failure, succeeded txs are not rolled back.

### 5.7 Owner sync
- Owners cannot be added/removed post-deployment on-chain (immutable).
- DB cache is service-role-write-only; reads are read-only.
- Backfill script `scripts/backfill-pool-owner-memberships.mjs` handles older pools.

### 5.8 Watch-only address tracking
- Authenticated, rate-limited (`/api/onchain/lookup`).
- RLS-scoped to `auth.uid()`.
- Cache has TTL via `expires_at`; UI does not display cache age (gap F-09).

### 5.9 Chain switching
- `expectedChainId()` resolved at module load from env var; throws in prod if unset.
- Wrong-chain wallet states block deploy/fund/withdraw at modal level.
- Pool records keyed by `(chain_id, pool_address)` everywhere.

### 5.10 Stripe billing lifecycle
- Checkout session → `/billing/success` → webhook lands → `user_billing_state` upserted.
- Billing portal return URL points to `/account`; UI re-fetches from Supabase only (no synchronous poll-from-Stripe path).

## 6. Required invariants

I-01. Never mark a pool deployed in DB unless deploy tx is confirmed on the expected chain.
I-02. Never mark a fund/withdraw final unless the tx has at least 1 confirmation.
I-03. The DB owner cache must never override on-chain `isOwner()` for any authorization decision.
I-04. The frontend must never authorize a chain action on its own; ownership/chain/balance must be re-read at sign time.
I-05. Stripe is authoritative for entitlement. The cache must not grant access past `current_period_end` even if `subscription.deleted` was missed.
I-06. Self-reported KYC fields must be labeled "profile completion," never "KYC verified."
I-07. Watch-only addresses must never be treated as connected wallets or as proof of authorization.
I-08. Production must fail-closed if `NEXT_PUBLIC_EXPECTED_CHAIN_ID` is unset or mismatched.
I-09. Sepolia tokens must never be substituted for mainnet allowlist entries (and vice versa).
I-10. Rate limits enforced server-side with a backend that survives multi-instance prod (Upstash, not in-process Map).
I-11. The chain ID stored on a pool record must equal the chain ID the pool was deployed to.
I-12. Webhook handlers must be idempotent on duplicate / out-of-order delivery.

## 7. Misuse cases (selected)

| ID | Misuse case | Expected safe behavior |
|---|---|---|
| M-01 | Non-owner attempts withdraw | Modal step-2 verification fails on `pool.isOwner(addr)`; sign blocked. |
| M-02 | DB owner cache stale (user is owner on-chain, not in DB) | Withdraw still works; cache is not consulted for auth. |
| M-03 | DB owner cache poisoned (user not owner on-chain, but cached as owner) | Insert path requires `pool.isOwner` to return true; impossible after `20260427130000` migration. |
| M-04 | User changes wallet account between verify and sign | Re-verification at sign; mismatch blocks tx. *(Currently: gap, see F-04.)* |
| M-05 | Wrong-chain deploy | `assertChainMatchesExpected` throws before broadcast. |
| M-06 | Stripe webhook delayed → user paid but UI shows Free | Idempotent retry via Stripe; user sees stale Free state until webhook lands. *(No client-side poll; gap F-06.)* |
| M-07 | Subscription canceled but cached Pro lingers past period end | Cache plan stays "pro" until next subscription event. *(Gap F-05: predicate ignores period_end.)* |
| M-08 | Profile blanked after deploying a pool | Pool stays deployed (chain immutable); future deploys re-blocked by KYC gate. Acceptable. |
| M-09 | KYC bypass via direct Supabase upsert | Blocked by RLS (`auth.uid() = id`) and PG generated column. |
| M-10 | Fake "community" pool name impersonating a brand | Not blocked. Pool names are free-form. *(Gap F-10.)* |
| M-11 | Duplicate fund tx submitted | DB merges via tx-hash Set; idempotent. ✓ |
| M-12 | Deploy tx confirmed, DB upsert fails | Pool orphaned (in chain but not in localStorage / DB). *(Gap F-01.)* |
| M-13 | Deploy succeeds, initial fund reverts | "Close" partial-fail path; pool exists on chain but never in DB. *(Gap F-01.)* |
| M-14 | Two co-owners race to withdraw at the same time | Whoever's tx mines first wins; second reverts gracefully on insufficient balance. UI shows generic error. *(Gap F-08.)* |
| M-15 | Watch-only address mistaken for connected wallet | Saved addresses are read-only; the UI shows them in a "Saved Addresses" panel, not in the wallet bar. *(Risk: minor UX gap; no funds at stake.)* |
| M-16 | RPC returns stale balance during withdraw preview | Modal re-reads balance on open; partial withdraw computed against cached read. Race with concurrent withdraws still possible. *(Gap F-08.)* |
| M-17 | Charge refunded / disputed | No webhook handler for `charge.refunded` or `charge.dispute.*`; user keeps Pro after refund. *(Gap F-07.)* |
| M-18 | In-process rate limit per Vercel container | If `UPSTASH_*` unset, limits are per-instance; trivially bypassed across replicas. *(Gap F-12.)* |

## 8. Mainnet readiness gates

Must have before mainnet:
- F-01 (deploy/fund partial-fail orphan) — explicit recovery path or a server-side reconciliation pass.
- F-05 (Pro predicate ignores `current_period_end`) — bound entitlement.
- F-12 (rate-limit in-process fallback in prod) — hard-fail without Upstash.
- F-02 (no Pro gate on deploy) — decision: either gate at API level or remove "unlimited pools" from Pro pitch.
- F-08 (withdraw `totalUsdEstimate: 0`) — fix or document as ephemeral cache zeroing.

Should have:
- F-04 (wallet account/chain re-check between modal steps).
- F-06 (post-checkout polling or manual resync endpoint).
- F-07 (refund/dispute webhook handler).

Nice-to-have:
- F-09 (cache-age UX on watch-only).
- F-10 (pool-name moderation).
- F-11 (RPC redundancy / fallback strategy).

## 9. Open design risks and accepted tradeoffs (v1)

| ID | Risk | Owner | Reason accepted | User-facing disclosure | Future improvement |
|---|---|---|---|---|---|
| T-01 | No multisig — any single owner can drain | bryceson | Out of scope for v1. Adding multisig changes the contract. | Pool deploy modal must say "Any owner can withdraw the full balance." | v2 contract with quorum. |
| T-02 | Self-reported KYC, not identity verification | bryceson | No KYC vendor wired up; profile is the gate for v1. | Field labels say "Profile" / "Complete your profile to deploy" — never "Verified." | Integrate Persona/Onfido/Sumsub when scope demands. |
| T-03 | Cached watch-only balance, not exchange-grade real-time | bryceson | Live RPC reads on every render are too costly. | "Last refreshed" timestamp on each card *(currently missing — F-09)*. | Push-based subscription / websocket. |
| T-04 | Non-custodial wallet signing only | bryceson | By design — never custody user funds. | Disclosed in Terms + onboarding. | None — invariant. |
| T-05 | Public on-chain data is publicly visible | bryceson | EVM is public. Pool deployer + balance + activity are public on-chain regardless of app. | Disclosed on the deploy review screen. | None. |
| T-06 | Stripe state, not on-chain entitlement, gates Pro | bryceson | Subscription model fits a SaaS layer; on-chain gating would force users into a token contract. | Pricing page and account card both source from Stripe via webhook cache. | None planned. |
| T-07 | Supabase service-role admin key holds full DB write access | bryceson | Required for webhook + server routes that bypass RLS. Rotation policy in `mainnet-deployment-key-policy.md`. | None (internal key). | Per-route signing, kms-backed key. |
| T-08 | Single-RPC dependency (Alchemy primary) | bryceson | Provider redundancy is v2. | Status page surfaces RPC outages. | Multi-provider failover. |
| T-09 | Chainlink staleness not asserted | bryceson | Mainnet ETH/USD feed is well-monitored; staleness has not been a real failure mode in v1 testing. | None. | Add `updatedAt` floor before mainnet if a stale-feed incident is reported. |
| T-10 | Custom (non-preset) ERC20s allowed at withdraw, not at deploy whitelist | bryceson | Withdraw of custom token allowed only via Max button (no USD partial), so user can't be tricked by stale price preview. | UI hides USD input for custom ERC20. | Document allowlist policy more loudly. |
