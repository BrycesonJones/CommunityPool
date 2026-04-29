# A07 Authentication — Mainnet Launch Checklist

This file is the operator-facing pre-launch checklist that backs the OWASP
A07:2025 review. Every item below must be confirmed before mainnet. None of
these checks are visible at runtime — they cover production environment
configuration that a code review cannot inspect.

> Do **not** paste secret values into this document or into any commit
> message, PR description, or issue. Confirm presence and shape only.

## Rate-limit backend

The Upstash Redis backend is the only rate-limit configuration that survives
a multi-instance Vercel deployment. The in-memory fallback in
`lib/security/rate-limit.ts` is per-instance and exists solely so dev /
preview can boot without Redis credentials. A production deployment that
falls through to it offers effectively no rate limiting against a
distributed attacker.

- [ ] `UPSTASH_REDIS_REST_URL` is set in the production Vercel project
      environment (Production scope only — not Preview).
- [ ] `UPSTASH_REDIS_REST_TOKEN` is set in the production Vercel project
      environment (Production scope only).
- [ ] First successful production deploy logs `using Upstash Redis backend`
      from the rate-limit module on cold start. Logs **must not** show
      `falling back to in-process limiter`.
- [ ] Smoke test in production: call `/api/auth/otp/send` with the same
      email 4 times in 60s — the 4th request returns 429 with a
      `Retry-After` header.

## Google OAuth allowlists

Loose redirect-URI allowlists are the most common way an OAuth callback
becomes an authentication-bypass surface. The production Google OAuth
client and the production Supabase project must each list **only** the
canonical production origin.

- [ ] Google Cloud OAuth client (Production) lists exactly one
      `https://<prod-domain>/auth/callback` URI.
- [ ] No `localhost`, `127.0.0.1`, `*.vercel.app`, or staging hostname is
      present on the production Google OAuth client. (Use a separate
      OAuth client for Preview deployments.)
- [ ] Supabase Auth → URL Configuration → Site URL is set to the canonical
      production origin.
- [ ] Supabase Auth → URL Configuration → Redirect URLs lists only the
      production `/auth/callback` URI.

## Auth bypass scan

The application has no password login, no service-role bypass, no
"DEV_LOGIN" or "AUTH_DISABLED" flag. This must remain true.

- [ ] `git grep -nE 'AUTH_DISABLED|DEFAULT_USER|DEFAULT_PASSWORD|DEV_LOGIN|MOCK_AUTH'`
      returns nothing in `app/`, `components/`, `lib/`, or `middleware.ts`.
- [ ] Production env does **not** set any environment variable matching
      that pattern.

## Stripe webhook signing

`/api/stripe/webhook` is the only route that runs without a Supabase
session. It must verify the Stripe signature against the live webhook
secret, and the route must run on the Node runtime (not Edge) so the
crypto module is available.

- [ ] `STRIPE_WEBHOOK_SECRET` is set in production and matches the live
      webhook endpoint configured in the Stripe dashboard.
- [ ] `app/api/stripe/webhook/route.ts` exports
      `runtime = "nodejs"` and `dynamic = "force-dynamic"`.

## Supabase MFA

v1 ships passwordless (email OTP + Google sign-in) without a second
factor. The "Enable 2FA" toggle on the Account → Security card has been
removed and replaced with copy that accurately states MFA is coming soon.

- [ ] `app/(app)/account/account-security-card.tsx` does **not** render
      a working `role="switch"` for 2FA.
- [ ] No live page tells the user they have enabled MFA.

## Wallet / auth boundary

Logout must fully release any wallet state held by the previous user.

- [ ] After signing out and reloading on a shared browser,
      `localStorage["communitypool_wallet_v1"]` is absent.
- [ ] The global wallet bar shows the "Connect" CTA, not a previous
      user's address.

## Protected route coverage

Middleware redirects unauthenticated visitors away from `/dashboard`,
`/account`, `/pools`, `/api-keys`, and `/documents`. The `(app)` layout
backstops with its own `getUser()` check.

- [ ] Visiting each of the five paths above while signed out lands on
      `/login?next=<path>`.
- [ ] No authenticated UI (modals, wallet bar, deploy CTAs) is briefly
      rendered before the redirect.

---

When every box above is checked in the production environment, A07
authentication posture is mainnet-ready. Re-run this checklist whenever
the rate-limit policies, OAuth client list, or middleware matcher change.
