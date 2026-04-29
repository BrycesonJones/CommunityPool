import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  enforceRateLimits,
  getClientIp,
} from "@/lib/security/rate-limit";
import { safeNextPath } from "@/lib/auth/safe-next-path";
import {
  hashIdentifier,
  requestContextForSecurityEvent,
  securityEvent,
} from "@/lib/security/security-event";

/**
 * Allowlist of error codes we surface in the `?error=` query string after a
 * failed OAuth callback. Restricting to a fixed set keeps the URL free of
 * raw provider strings (which can be attacker-controlled and contain
 * arbitrary copy) and gives the login page a stable contract for messaging.
 */
type CallbackErrorCode =
  | "auth"
  | "config"
  | "oauth_provider"
  | "oauth_no_code";

function buildErrorRedirect(
  origin: string,
  code: CallbackErrorCode,
  next: string,
): NextResponse {
  // Always preserve the user's intended landing path so a retry from the
  // login page lands them where they were going. `safeNextPath` has already
  // collapsed anything off-origin / control-byte-bearing to /dashboard.
  const url = new URL(`${origin}/login`);
  url.searchParams.set("error", code);
  if (next && next !== "/dashboard") url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const ctx = requestContextForSecurityEvent(request);
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const providerError = searchParams.get("error");
  const next = safeNextPath(searchParams.get("next"));

  // Rate-limit the callback regardless of whether `code` is present so an
  // attacker can't burn provider-error replays for free.
  const limited = await enforceRateLimits([
    { name: "oauth_callback", identifier: getClientIp(request) },
  ]);
  if (limited) return limited;

  // Provider-side denial (user clicked Cancel on the Google consent screen,
  // or Google returned an error) arrives as `?error=...&error_description=...`.
  // We deliberately do NOT echo `error_description` to the user — it is
  // attacker-influenceable and can carry arbitrary copy. Map to a stable code.
  if (providerError) {
    securityEvent({
      ...ctx,
      event_type: "auth.oauth.callback_failed",
      severity: "medium",
      status_code: 307,
      error_code: "oauth_provider",
      safe_message: "OAuth provider returned callback error.",
      metadata: { next_hash: hashIdentifier(next) },
    });
    return buildErrorRedirect(origin, "oauth_provider", next);
  }

  if (!code) {
    securityEvent({
      ...ctx,
      event_type: "auth.oauth.callback_failed",
      severity: "medium",
      status_code: 307,
      error_code: "oauth_no_code",
      safe_message: "OAuth callback missing authorization code.",
      metadata: { next_hash: hashIdentifier(next) },
    });
    return buildErrorRedirect(origin, "oauth_no_code", next);
  }

  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    securityEvent({
      ...ctx,
      event_type: "auth.oauth.callback_failed",
      severity: "high",
      status_code: 307,
      error_code: "oauth_config",
      safe_message: "OAuth callback missing Supabase config.",
    });
    return buildErrorRedirect(origin, "config", next);
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          cookieStore.set(name, value, options),
        );
      },
    },
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (!error) {
    securityEvent({
      ...ctx,
      event_type: "auth.oauth.callback_succeeded",
      severity: "info",
      status_code: 307,
      metadata: { next_hash: hashIdentifier(next) },
    });
    return NextResponse.redirect(`${origin}${next}`);
  }

  securityEvent({
    ...ctx,
    event_type: "auth.oauth.callback_failed",
    severity: "medium",
    status_code: 307,
    error_code: "oauth_exchange_failed",
    safe_message: "OAuth code exchange failed.",
  });
  return buildErrorRedirect(origin, "auth", next);
}
