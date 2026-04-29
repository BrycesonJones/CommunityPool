# KYC field-level encryption plan

This doc captures **what is acceptable today** and **what triggers
mandatory field-level encryption** for KYC data in CommunityPool. We
are deliberately not implementing field-level encryption at launch —
this note records the plan so future contributors do not re-litigate the
question and so the trigger conditions are unambiguous.

## Scope

Personal data currently stored in `public.user_profiles`:

* `full_name`
* `address_line1`, `address_line2`
* `city`, `state`, `postal_code`, `country`
* `phone_number`
* `email`, `username`

Stripe customer / subscription identifiers live in `public.user_billing_state`
(service-role-only writes; see [`billing-state-rls.test.ts`](../../test/security/billing-state-rls.test.ts)).

## Current launch state — acceptable

For the KYC-1 fields above, plaintext storage is acceptable at launch
because:

* **Provider encryption at rest.** Supabase Postgres is encrypted at
  rest (AES-256). Backups are encrypted. Disk-level reads are not in
  the realistic threat model.
* **TLS in transit.** All client-server traffic uses HTTPS, enforced
  by HSTS in [`next.config.ts`](../../next.config.ts).
* **Row-Level Security (RLS).** `user_profiles` has read/insert/update
  policies keyed on `auth.uid() = id`
  ([migration](../../supabase/migrations/20250425120000_user_profiles_kyc.sql)).
  No other authenticated user can read another user's row.
* **No identity documents.** We do not store SSNs, passport numbers,
  driver's license numbers, document images, or tax IDs. The
  cardinality of breachable PII per row is bounded.
* **No third-party support tooling with DB access.** Only the project
  maintainer holds Supabase dashboard credentials. There is no
  Zendesk/Linear integration with read access to `user_profiles`.

## When field-level encryption becomes mandatory

Implement field-level encryption *before* any of the following ships.
Treat each as an independent trigger.

### A. New high-value identity fields

Required if the schema gains any of:

* Government ID number — SSN, ITIN, passport, driver's license, national ID.
* Tax ID (EIN, VAT number, foreign equivalents).
* Date of birth (in combination with name + address — DOB alone is
  lower-risk, but the triple is a credit-application kit).
* Identity verification document images or document hashes (KYC
  selfies, ID photos).
* Bank account / routing numbers.
* Wallet recovery hints.

The KYC-2 trigger is binary: ship encryption *with* the migration that
adds the column, not after.

### B. Operational-access changes

Required if any of:

* A non-maintainer human gains `read` access to the `user_profiles`
  table (support engineer, contractor, customer-success seat).
* A third-party tool (Zendesk, Linear, Intercom, Salesforce) is wired
  to read `user_profiles` directly or via Supabase webhooks.
* Logical replication / read-replicas / data-warehouse pipelines copy
  the table downstream.

In each case, provider-level encryption no longer protects against the
new actor. The encrypted-column path must travel through that boundary.

### C. Regulatory triggers

Required if the project becomes subject to GDPR Article 32 ("appropriate
technical measures"), CCPA, NYDFS Part 500, PCI-DSS Level 1, or any
explicit jurisdictional requirement for "encryption of personal data at
the field level" — even if the existing fields don't change.

## Candidate fields, in priority order

When the trigger fires, encrypt in this order. The first three are the
high-leverage cases; the fourth is conditional.

1. `phone_number` — high re-identifiability, low query value, easy to
   encrypt without breaking workflows.
2. `address_line1`, `address_line2` — full street address is the
   highest-value linkability field. Postal code can stay plaintext for
   coarse analytics.
3. `full_name` — encrypt the legal name; keep `username` plaintext for
   UI display.
4. `email` — **conditional**. Email is also the OTP delivery target
   and must remain queryable for `signInWithOtp`. Encryption here would
   require either (a) a deterministic encryption scheme so we can still
   `eq` on it, or (b) moving identity to Supabase Auth's `auth.users`
   table (which is already encrypted at the provider level) and
   denormalising only what we need. Defer until trigger A or B fires.

## Tradeoffs to acknowledge

Field-level encryption is not free. Each item below is a real cost
that should be priced into the migration that introduces it.

* **Search degrades.** `ilike '%smith%'` against an encrypted
  `full_name` becomes impossible. Exact-match lookups still work via
  HMAC-based blind indexes, but partial / fuzzy search requires either
  a separate searchable index (with its own attack surface) or
  acceptance of "no admin search."
* **Generated columns must move.** The `kyc_profile_completed`
  generated column in
  [`user_profiles_kyc.sql`](../../supabase/migrations/20250425120000_user_profiles_kyc.sql)
  uses `btrim()` over the plaintext fields. With encryption, that
  computation moves to either:
  * a SQL function over a `pgsodium` decryption view (server-only
    role), or
  * application code (`isKycProfileComplete` in
    [`lib/profile/kyc.ts`](../../lib/profile/kyc.ts)).
  The application-code path is simpler and is already implemented;
  drop the generated column and have the app set
  `kyc_profile_completed` explicitly on upsert.
* **Indexing changes.** Existing indexes on plaintext columns become
  meaningless; replace with HMAC indexes for any column that needs
  exact-match.
* **Recovery is harder.** A lost data-encryption key (DEK) renders
  encrypted columns unrecoverable. Plan for KEK-wrapped DEKs in
  Supabase Vault or an external KMS, not "the key lives in env."
* **Backups need re-thinking.** A backup that contains the encrypted
  ciphertext + the wrapping KEK is no better than a plaintext backup.
  Backups must split: ciphertext in Supabase backups, KEK in the cloud
  KMS, neither alone usable.
* **Support workflows change.** "Update this user's address" no
  longer supports a one-shot `update user_profiles set
  address_line1 = …`. Either expose a server route that decrypts /
  re-encrypts, or push the change through the user's own session.

## Key management — must be defined before implementation

Before any code change, agree on:

* **Where is the DEK?** Recommended: Supabase Vault with a KMS-wrapped
  KEK; fallback: a cloud KMS (AWS KMS / Google Cloud KMS) accessed by
  the service role only.
* **Where is the KEK?** Recommended: cloud KMS, never on the
  application servers.
* **Rotation cadence.** Annual KEK rotation; DEK rotation only on
  compromise.
* **Recovery story.** Who can decrypt without the application running
  (legal hold, incident response). Document the steps; rehearse them
  before they're needed.
* **Audit logging.** Every decryption call logged with caller, row,
  timestamp. Without this the encryption is theatre.

## Out of scope for this pass

This document is the *plan*. The actual implementation is deliberately
out of scope until a trigger above fires, because:

* Implementing it speculatively forces a key-management decision before
  the operational context is clear.
* The current threat model does not justify the operational cost.
* Premature encryption is the worst kind: it hides assumed-protected
  data in a way that makes leaks harder to detect.

## Related documents

* [Mainnet deployment key policy](./mainnet-deployment-key-policy.md)
* [`.env.example`](../../.env.example) — secret rotation checklist.
* [`billing-state-rls.test.ts`](../../test/security/billing-state-rls.test.ts) — RLS regression for the related billing-state table.
