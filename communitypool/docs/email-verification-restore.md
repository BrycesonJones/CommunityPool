# Email verification flow — snapshot for reimplementation

For a chronological, file-level list of what changed (vs. this behavioral spec), see [auth-email-verification-changelog.md](auth-email-verification-changelog.md).

**Current app behavior:** Login and signup no longer call `EmailOtpModal`, `requestEmailVerificationCode`, or `resendSignupConfirmationEmail`. Successful password sign-in goes straight to the app; sign-up redirects when `data.session` exists, otherwise shows `supabaseConfirmEmailHint`.

To restore strict verification: re-attach `EmailOtpModal` and the flows below in `app/login/login-form.tsx` and `app/signup/signup-form.tsx`, re-enable **Confirm email** in Supabase if desired (Authentication → Providers → Email), and optionally gate behind an env flag again.

## Files involved

| Role | Path |
|------|------|
| Helpers + OTP API | `lib/auth/email-verification.ts` |
| Login (OTP removed from UI; restore here) | `app/login/login-form.tsx` |
| Signup (OTP removed from UI; restore here) | `app/signup/signup-form.tsx` |
| OTP UI | `components/email-otp-modal.tsx` |
| Magic link / PKCE return | `app/auth/callback/route.ts` |

## End-to-end behavior (strict mode)

### Login

1. `signInWithPassword({ email, password })`.
2. If error and `isEmailNotConfirmedError`: `resendSignupConfirmationEmail` → open `EmailOtpModal` with flow `unconfirmed`.
3. If success: **`signOut()`** (drop the password session), then `requestEmailVerificationCode(..., "login")` which calls `signInWithOtp` with `shouldCreateUser: false` → open modal with flow `login_mfa`.
4. User enters code → `verifyEmailOtp` tries `type: "email"` then `type: "signup"` → `onVerified` runs `router.push(next)` + `router.refresh()`.

### Signup

1. `signUp` with `emailRedirectTo: ${origin}/auth/callback`.
2. If `data.session` exists, **`signOut()`** to force the OTP path.
3. `requestEmailVerificationCode(..., "signup")`: `signInWithOtp` first; on failure in signup mode, `auth.resend({ type: "signup", ... })`.
4. Open `EmailOtpModal` with flow `signup` → verify → redirect `/dashboard`.

### `requestEmailVerificationCode` (login vs signup)

- Always tries `signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo } })`.
- If that fails and `mode === "signup"`, falls back to `resend({ type: "signup", email, options: { emailRedirectTo } })`.
- If login mode and OTP fails, returns the OTP error (no resend).

### `verifyEmailOtp`

- `verifyOtp({ email, token, type: "email" })`; if error, retry with `type: "signup"`.

### Modal resend

- `unconfirmed` → `resendSignupConfirmationEmail`
- `login_mfa` → `requestEmailVerificationCode(..., "login")`
- `signup` → `requestEmailVerificationCode(..., "signup")`

## Reference implementation (login success path, pre-bypass)

After successful `signInWithPassword`, the app intentionally signed out and required email OTP:

```ts
setOtpFlow("login_mfa");
await supabase.auth.signOut();

const { error: sendError } = await requestEmailVerificationCode(
  supabase,
  trimmedEmail,
  window.location.origin,
  "login",
);

setSubmitting(false);

if (sendError) {
  setErrors({ form: sendError.message });
  return;
}

setOtpEmail(trimmedEmail);
setOtpOpen(true);
```

## Reference implementation (signup post-signUp, pre-bypass)

```ts
if (data.session) {
  await supabase.auth.signOut();
}

const { error: sendError } = await requestEmailVerificationCode(
  supabase,
  trimmedEmail,
  origin,
  "signup",
);

setSubmitting(false);

if (sendError) {
  setErrors({ form: sendError.message });
  return;
}

setOtpEmail(trimmedEmail);
setOtpOpen(true);
```

## Current behavior (no OTP in forms)

- Login: `signInWithPassword` → success → `router.push(next)` + `router.refresh()`; `email_not_confirmed` → `supabaseConfirmEmailHint` only (no email sent by the app).
- Signup: `signUp` → if `data.session`, redirect `/dashboard`; else `supabaseConfirmEmailHint`.
- Helpers in `lib/auth/email-verification.ts` and `components/email-otp-modal.tsx` remain for copy-paste restore.
