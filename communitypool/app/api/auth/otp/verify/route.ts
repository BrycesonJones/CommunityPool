import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  enforceRateLimits,
  getClientIp,
} from "@/lib/security/rate-limit";
import { apiErrorResponse, publicErrorResponse } from "@/lib/security/public-error";
import {
  hashIdentifier,
  requestContextForSecurityEvent,
  securityEvent,
} from "@/lib/security/security-event";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  const ctx = requestContextForSecurityEvent(request);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return apiErrorResponse({
      error: "Invalid request",
      code: "invalid_request",
      status: 400,
      request,
    });
  }

  const emailRaw = typeof body.email === "string" ? body.email.trim() : "";
  if (!emailRaw || !EMAIL_RE.test(emailRaw)) {
    return apiErrorResponse({
      error: "Invalid request",
      code: "invalid_request",
      status: 400,
      request,
    });
  }
  const email = emailRaw.toLowerCase();

  const tokenRaw = typeof body.token === "string" ? body.token : "";
  const token = tokenRaw.replace(/\s/g, "");
  if (!/^\d{6}$/.test(token)) {
    return apiErrorResponse({
      error: "Invalid request",
      code: "invalid_request",
      status: 400,
      request,
    });
  }

  const ip = getClientIp(request);
  // Slow brute force on three axes:
  //   - `otp_verify` keyed on the email (5/60s short-window cap)
  //   - `otp_verify` keyed on the IP (5/60s short-window cap)
  //   - `otp_verify_email_long` keyed on the email (30/600s long-window cap)
  // The long-window email cap is what bounds total attempts per OTP lifetime
  // even if the attacker rotates IPs. Supabase applies its own per-OTP cap
  // independently; these are stacked on top.
  const limited = await enforceRateLimits([
    { name: "otp_verify", identifier: `email:${email}` },
    { name: "otp_verify", identifier: `ip:${ip}` },
    { name: "otp_verify_email_long", identifier: email },
  ]);
  if (limited) {
    securityEvent({
      ...ctx,
      event_type: "auth.otp.verify_rate_limited",
      severity: "high",
      status_code: 429,
      email_hash: hashIdentifier(email),
      rate_limit_key_hash: hashIdentifier(`otp_verify:${email}:${ip}`),
      safe_message: "OTP verify request was rate-limited.",
    });
    return limited;
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: "email",
  });

  if (error) {
    securityEvent({
      ...ctx,
      event_type: "auth.otp.verify_failed",
      severity: "high",
      status_code: 400,
      email_hash: hashIdentifier(email),
      error_code: error.code,
      safe_message: "OTP verification failed.",
    });
    return publicErrorResponse(error, "Invalid or expired code", 400);
  }

  securityEvent({
    ...ctx,
    event_type: "auth.otp.verify_succeeded",
    severity: "info",
    status_code: 200,
    email_hash: hashIdentifier(email),
  });
  return NextResponse.json({ ok: true });
}
