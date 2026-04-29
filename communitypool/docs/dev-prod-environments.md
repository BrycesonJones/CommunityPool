# Dev / Prod environments

How CommunityPool's two environments are wired and how to ship changes from
Dev → Prod without breaking either.

## Project map

| Layer | Dev | Prod |
| --- | --- | --- |
| Supabase project | `CommunityPoolDev` (`femdttcdyklzjmhwnzvu`) | `CommunityPoolProd` (`yturmkjltuxfmrewgicq`) |
| Pooler region | `aws-0-us-west-2` | `aws-1-us-west-2` |
| Auth Site URL | (local: `http://localhost:3000`) | `https://communitypool.online` |
| Resend sender | `onboarding@resend.dev` (sandbox) | `noreply@communitypool.online` (verified) |
| App host | `npm run dev` (local), Vercel Preview | Vercel Production |
| Custom domain | none | `https://communitypool.online` (apex) + `https://www.communitypool.online` |
| Expected chain | `11155111` (Sepolia) | `11155111` (Sepolia until launch; flip to `1` for mainnet) |

Both Supabase projects live in the org `Bryceson's Apps`
(`flykzsnrxeopqlpislfe`) in West US (Oregon).

## Environment-variable contract

All Supabase/Stripe/etc. env vars live in **two places only**:

1. Local `.env` (gitignored) — Dev values for `npm run dev` and local scripts.
2. Vercel Project Settings → Environment Variables — Prod values scoped to
   **Production**, Dev values scoped to **Preview** (and optionally
   Development).

Never paste real keys into `.env.example`, the repo, or chat tools.

### Per-scope assignment

| Variable | Production scope | Preview scope |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://yturmkjltuxfmrewgicq.supabase.co` | `https://femdttcdyklzjmhwnzvu.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Prod `anon` JWT | Dev `anon` JWT |
| `SUPABASE_URL` | (mirror of NEXT_PUBLIC_SUPABASE_URL) | (mirror of NEXT_PUBLIC_SUPABASE_URL) |
| `SUPABASE_SERVICE_ROLE_KEY` | Prod `service_role` JWT (mark Sensitive) | Dev `service_role` JWT (Sensitive) |
| `NEXT_PUBLIC_EXPECTED_CHAIN_ID` | `11155111` (Sepolia) — flip to `1` for mainnet launch | `11155111` |
| `NEXT_PUBLIC_APP_URL` | `https://communitypool.online` | (unset — preview URLs are dynamic) |
| `UPSTASH_REDIS_REST_URL` | real Upstash endpoint (us-east-1 to match Vercel iad1) | optional |
| `UPSTASH_REDIS_REST_TOKEN` | real Upstash token (Sensitive) | optional |
| `STRIPE_SECRET_KEY` | live `sk_live_...` | test `sk_test_...` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | live `pk_live_...` | test `pk_test_...` |
| `STRIPE_PRO_MONTHLY_PRICE_ID` | live `price_...` | test `price_...` |
| `STRIPE_WEBHOOK_SECRET` | live `whsec_...` (per Stripe Dashboard endpoint) | test `whsec_...` (from `stripe listen`) |

`SUPABASE_SERVICE_ROLE_KEY` is server-side only. Never use the
`NEXT_PUBLIC_` prefix on it — that would inline the key into the browser
bundle.

`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are required in
production. The rate limiter (`lib/security/rate-limit.ts`) throws on
missing-Upstash when `NODE_ENV=production`; the OTP send / login routes
catch the throw and return a 503 `{"code":"service_unavailable"}`.

## Daily workflow

Local dev (most of the time):

```sh
npm run dev   # reads .env (Dev values), talks to CommunityPoolDev
```

Vercel Preview deploys (any non-`main` branch / PR):

- Build pulls Preview-scoped env vars → talks to CommunityPoolDev.
- Safe to test signup, OTP, RLS without touching real users.

Vercel Production deploy (push to `main`):

- Build pulls Production-scoped env vars → talks to CommunityPoolProd.
- Live users see this.

## Schema migrations Dev → Prod

Migration files live in `communitypool/supabase/migrations/`.

`supabase` CLI link state is per-workdir. The active project ref for a
given workdir lives in `<workdir>/supabase/.temp/linked-project.json` —
that file is the only authoritative answer to "which project will
`db push` write to right now?". Cat it before any push.

Standard ship sequence:

```sh
# 1. Confirm Dev is the link target
cat communitypool/supabase/.temp/linked-project.json
# -> femdttcdyklzjmhwnzvu

# 2. Push pending migrations to Dev, smoke test there
supabase db push --linked --workdir communitypool

# 3. Re-link the workdir to Prod
supabase link --project-ref yturmkjltuxfmrewgicq --workdir communitypool

# 4. Push the same migrations to Prod
supabase db push --linked --workdir communitypool

# 5. Re-link back to Dev for normal dev work
supabase link --project-ref femdttcdyklzjmhwnzvu --workdir communitypool
```

Migrations in this repo are written idempotently (`drop ... if exists`,
`create ... if not exists`). Re-running is safe.

If a migration fails on Prod with constraint-violation errors that
pre-existing rows trigger, sanitize Prod data first (or write a one-off
migration that does the cleanup before adding the constraint, mirroring
the pattern in `20260427150200_user_pool_activity_constraints.sql`).

### Cross-schema objects

`pg_dump --schema=public` does **not** capture:

- Triggers on `auth.users` that call `public.*` functions
  (e.g. `on_auth_user_created` calling `public.handle_new_user()`)
- Database-level event triggers
  (e.g. `ensure_rls` calling `public.rls_auto_enable()`)

Both exist on Dev and Prod. If you ever rebuild a Supabase project from
scratch via dump-and-replay, also apply the supplemental DDL captured at
`communitypool/supabase/.prod-clone/dev_supplemental.sql` (gitignored;
re-generate by querying `pg_trigger` + `pg_event_trigger` on Dev).

## Auth differences worth knowing

| Concern | Dev | Prod |
| --- | --- | --- |
| SMTP sender | `onboarding@resend.dev` (sandbox; only delivers to Resend account-owner email) | `noreply@communitypool.online` (verified domain; delivers to anyone) |
| Site URL | `http://localhost:3000` | `https://communitypool.online` |
| Redirect URL allowlist | `http://localhost:3000/auth/callback` | `https://communitypool.online/auth/callback` |
| Google OAuth client | shared Dev client (acceptable for testing) | dedicated Prod client in Google Cloud Console (callback URI = `https://yturmkjltuxfmrewgicq.supabase.co/auth/v1/callback`) |
| Email templates (Confirm Signup, Magic Link) | OTP-code body using `{{ .Token }}` | OTP-code body using `{{ .Token }}` |

The app code calls `signInWithOtp({ email })` without `emailRedirectTo`
(see `app/api/auth/otp/send/route.ts`), so Supabase always sends OTP codes,
not magic links. Both templates therefore need `{{ .Token }}` in the body
— `{{ .ConfirmationURL }}` in either template would render an empty
section in the email.

## Vercel project gotchas

These cost real time during the initial Prod rollout; capture so they
don't recur.

### Framework preset can be locked into a Production override

The Vercel "New Project" form's **Application Preset** dropdown defaults
to `Other`. If you click Deploy without explicitly switching it to
`Next.js`, Vercel locks `Other` into a per-deployment override. Later
fixing **Project Settings → Framework Preset** to `Next.js` does *not*
clear the override — subsequent deploys still build as `Other` and
serve every URL with Vercel's text/plain `NOT_FOUND`, even though the
build log claims success.

Fix: **Settings → Build & Development Settings → Production Overrides**
must show framework `Next.js` (not `Other`). If it shows `Other`,
remove the override and redeploy with the cache cleared.

### Next.js 16 renamed `middleware.ts` to `proxy.ts`

`middleware.ts` still works in Next.js 16 with a deprecation warning,
but Vercel packages it as an Edge Function and rejects bundles that
reference helper files via `@/lib/supabase/middleware`-style import
paths. Symptom is a deploy error:

> The Edge Function "middleware" is referencing unsupported modules:
> `__vc__ns__/0/communitypool/middleware.js: @/lib/supabase/middleware`

The rename is already done in this repo (`proxy.ts` + `lib/supabase/session.ts`).
Don't reintroduce a `middleware.ts` file or import paths that contain
`/middleware`.

### `next.config.ts` `turbopack.root` warning

Vercel sets its own `outputFileTracingRoot` to `/vercel/path0` and
overrides `turbopack.root` with a build-time warning:

> Both `outputFileTracingRoot` and `turbopack.root` are set, but they must have the same value.

Non-fatal. Drop the `turbopack: { root: __dirname }` block from
`next.config.ts` whenever convenient.

## Production smoke test

Run after any change that could affect auth, RLS, or session state:

1. **Email OTP signup** — fresh email from outside the Resend account
   owner address. Confirms domain-verified SMTP delivery.
2. **OTP code → /dashboard** — confirms `on_auth_user_created` trigger
   creates `user_profiles` row + RLS read policy works.
3. **Second user in incognito + cross-user read attempt** — confirms RLS
   isolation between `auth.uid()`s.
4. **Google OAuth** — confirms Google client + Supabase callback URL
   wiring. "Unverified app" warning is expected until Google verification
   paperwork is filed.
5. **Profile edit + reload** — confirms write RLS policy on
   `user_profiles`.

If any block fails, probe the API endpoint directly with `curl` to see
the real status code + body before assuming it's a UI bug; the UI layer
maps every server failure to the same generic "Service unavailable"
banner.
