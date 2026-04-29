# Changelog: email verification / login OTP

This log records changes made so you can reimplement strict email OTP later. Step-by-step behavior and copy-paste reference code live in [`email-verification-restore.md`](email-verification-restore.md).

## How to roll back in git

If these commits are still in history, use `git log --oneline -- communitypool/app/login/login-form.tsx communitypool/app/signup/signup-form.tsx communitypool/lib/auth/email-verification.ts` and `git checkout <commit> -- <paths>` for the files you want. Otherwise follow the restore doc and this changelog.

---

## Phase A — Optional env bypass (later removed)

**Intent:** Allow skipping OTP when `NEXT_PUBLIC_SKIP_EMAIL_VERIFICATION=true`.

**Added**

- `skipEmailVerification` in `lib/auth/email-verification.ts` (read `NEXT_PUBLIC_SKIP_EMAIL_VERIFICATION === "true"`).
- `supabaseConfirmEmailHint` for cases where Supabase still required confirmation.
- Branches in `app/login/login-form.tsx` and `app/signup/signup-form.tsx` that skipped `signOut` / `requestEmailVerificationCode` when the flag was true.

**Docs**

- [`email-verification-restore.md`](email-verification-restore.md) created with strict-mode flow and reference snippets.
- Cursor todo to reimplement strict verification (optional; may exist only in the IDE).

**Removed in Phase B** — The env flag and all `skipEmailVerification` branches were deleted; the app no longer depends on `NEXT_PUBLIC_SKIP_EMAIL_VERIFICATION`.

---

## Phase B — Remove email sends and OTP from login/signup (current)

**Intent:** No app-triggered verification email on sign-in; password session is enough for testing. No `signInWithOtp` / `resend` from these forms.

### `app/login/login-form.tsx`

- **Removed:** `EmailOtpModal` and imports; state `otpOpen`, `otpEmail`, `otpFlow`; calls to `requestEmailVerificationCode`, `resendSignupConfirmationEmail`, `skipEmailVerification`; post-success `signOut` + OTP flow; unconfirmed branch that called `resendSignupConfirmationEmail` and opened the modal.
- **Kept:** `isEmailNotConfirmedError`, `supabaseConfirmEmailHint`.
- **Current success path:** `signInWithPassword` → `router.push(nextPath)` + `router.refresh()`.
- **Current unconfirmed path:** set form error to `supabaseConfirmEmailHint` only (no network call that sends email).

### `app/signup/signup-form.tsx`

- **Removed:** `EmailOtpModal` and imports; OTP state; `skipEmailVerification` branching; `signOut` after `signUp`; `requestEmailVerificationCode`; opening the OTP modal.
- **Kept:** `supabaseConfirmEmailHint`.
- **Current success path:** if `data.session` → `/dashboard` + `router.refresh()`.
- **Current no-session path:** form error `supabaseConfirmEmailHint`.

### `lib/auth/email-verification.ts`

- **Removed:** `skipEmailVerification` and any reference to `NEXT_PUBLIC_SKIP_EMAIL_VERIFICATION`.
- **Updated:** `supabaseConfirmEmailHint` copy (no env-var sentence).
- **Unchanged (kept for reimplementation):** `isEmailNotConfirmedError`, `resendSignupConfirmationEmail`, `requestEmailVerificationCode`, `verifyEmailOtp`.

### `components/email-otp-modal.tsx`

- **Unchanged** — still implements verify/resend using the helpers above; not mounted from login/signup until you restore.

### `app/auth/callback/route.ts`

- **Unchanged** — still used for magic-link / PKCE if you re-enable those flows.

### `docs/email-verification-restore.md`

- **Updated:** Describes current “no OTP in forms” behavior and how to re-attach the modal and strict flows.

---

## Reimplementation checklist

1. Re-add the login flow from the “Reference implementation” sections in [`email-verification-restore.md`](email-verification-restore.md) (success: `signOut` + `requestEmailVerificationCode` + modal; unconfirmed: `resend` + modal).
2. Re-add the signup flow from the same doc (`signOut` if session, then `requestEmailVerificationCode`, then modal).
3. Import and render `EmailOtpModal` in both forms with the appropriate `EmailOtpFlow` values.
4. Optionally reintroduce `skipEmailVerification` + `NEXT_PUBLIC_SKIP_EMAIL_VERIFICATION` if you want a toggle.
5. Align Supabase **Confirm email** with product needs (on for production strict verification, off for frictionless dev if you prefer).
