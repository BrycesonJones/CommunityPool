/**
 * Account → Security card.
 *
 * v1 is passwordless: sign-in is email one-time codes or Google sign-in via
 * Supabase. There is no second-factor enrollment. We deliberately do NOT
 * render an MFA toggle here — an earlier version showed a switch that only
 * flipped local React state and persisted nothing, which would have led
 * users to believe they had enabled MFA when no factor was enrolled. Replace
 * this card with a real Supabase MFA flow only once enrollment, challenge,
 * and verification are wired end-to-end.
 */
export function AccountSecurityCard() {
  return (
    <section
      aria-label="Security"
      className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-6 shadow-xl"
    >
      <header className="flex items-center gap-3 pb-4">
        <span
          aria-hidden
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/80"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5 text-white"
          >
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
        </span>
        <h2 className="text-lg font-semibold text-white">Security</h2>
      </header>

      <div className="space-y-3 text-sm text-zinc-400">
        <p className="text-zinc-200">
          Two-factor authentication is coming soon.
        </p>
        <p>
          Today, your account is protected by email one-time codes or Google
          sign-in. We never use passwords.
        </p>
      </div>
    </section>
  );
}

export default AccountSecurityCard;
