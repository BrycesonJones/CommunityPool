/**
 * Browser-facing helpers that proxy email-OTP send/verify through the app's
 * own server routes (`/api/auth/otp/send`, `/api/auth/otp/verify`). Going via
 * server routes is what lets us enforce IP- and email-keyed rate limits in
 * `lib/security/rate-limit.ts` — the previous direct browser → Supabase calls
 * had no enforceable cap beyond Supabase's own internal limits.
 *
 * Returns `{ error: Error | null }` so call sites match the prior shape. A
 * 429 from the rate limiter surfaces as an Error whose message is the
 * server's `message` field (so the existing form alert renders it directly).
 */

interface OtpResponse {
  ok?: boolean;
  error?: string;
  message?: string;
  retryAfter?: number;
}

async function postOtp(
  path: "/api/auth/otp/send" | "/api/auth/otp/verify",
  body: Record<string, unknown>,
): Promise<{ error: Error | null }> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error";
    return { error: new Error(message) };
  }

  let payload: OtpResponse = {};
  try {
    payload = (await response.json()) as OtpResponse;
  } catch {
    /* ignore — error path below uses statusText */
  }

  if (!response.ok) {
    if (response.status === 429) {
      const retry = payload.retryAfter ?? 60;
      const message =
        payload.message ??
        `Too many requests. Please try again in ${retry} seconds.`;
      return { error: new Error(message) };
    }
    const message =
      payload.error ?? payload.message ?? response.statusText ?? "Request failed";
    return { error: new Error(message) };
  }

  return { error: null };
}

/**
 * Send a 6-digit OTP to `email`. Server route enforces rate limits keyed by
 * email and client IP before forwarding to Supabase.
 */
export async function sendEmailOtp(
  email: string,
  metadata?: Record<string, unknown>,
): Promise<{ error: Error | null }> {
  return postOtp("/api/auth/otp/send", {
    email,
    ...(metadata ? { metadata } : {}),
  });
}

/**
 * Verify a 6-digit code. Server route enforces brute-force throttling before
 * calling Supabase; on success Supabase sets the session cookie via the
 * server response.
 */
export async function verifyEmailOtp(
  email: string,
  token: string,
): Promise<{ error: Error | null }> {
  return postOtp("/api/auth/otp/verify", { email, token });
}
