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
// Conservative username shape: ASCII letters/digits and the join punctuation
// users actually pick. Anything else (HTML/CSS/script payloads, control bytes,
// emoji, etc.) is refused so it cannot ride into auth.users.user_metadata.
const USERNAME_RE = /^[A-Za-z0-9_.-]{1,40}$/;

const ALLOWED_METADATA_KEYS = new Set(["username"]);

type ParsedMetadata =
  | { ok: true; data: { username: string } | undefined }
  | { ok: false };

/**
 * Allowlisted parser for `body.metadata`. Only `username` is permitted, and
 * only when it matches `USERNAME_RE`. Any other key (or any other shape on
 * `metadata` itself) is a hard 400 — we never silently strip unknown fields,
 * because that would mask a misconfigured client and let a future allowed key
 * smuggle through unnoticed. Returning an empty object when no metadata is
 * supplied is fine; that's distinct from "metadata sent but invalid".
 */
function parseMetadata(raw: unknown): ParsedMetadata {
  if (raw === undefined) return { ok: true, data: undefined };
  if (raw === null) return { ok: false };
  if (typeof raw !== "object") return { ok: false };
  if (Array.isArray(raw)) return { ok: false };

  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_METADATA_KEYS.has(key)) return { ok: false };
  }

  if (!("username" in obj)) return { ok: true, data: undefined };

  const username = obj.username;
  if (typeof username !== "string") return { ok: false };
  const trimmed = username.trim();
  if (!USERNAME_RE.test(trimmed)) return { ok: false };
  return { ok: true, data: { username: trimmed } };
}

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
  securityEvent({
    ...ctx,
    event_type: "auth.otp.send_requested",
    severity: "info",
    email_hash: hashIdentifier(email),
  });

  const parsedMetadata = parseMetadata(body.metadata);
  if (!parsedMetadata.ok) {
    return apiErrorResponse({
      error: "Invalid request",
      code: "invalid_request",
      status: 400,
      request,
    });
  }

  const ip = getClientIp(request);
  const limited = await enforceRateLimits([
    { name: "otp_send_email", identifier: email },
    { name: "otp_send_ip", identifier: ip },
  ]);
  if (limited) {
    securityEvent({
      ...ctx,
      event_type: "auth.otp.send_rate_limited",
      severity: "medium",
      status_code: 429,
      email_hash: hashIdentifier(email),
      rate_limit_key_hash: hashIdentifier(`otp_send:${email}:${ip}`),
      safe_message: "OTP send request was rate-limited.",
    });
    return limited;
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      ...(parsedMetadata.data ? { data: parsedMetadata.data } : {}),
    },
  });

  if (error) {
    securityEvent({
      ...ctx,
      event_type: "auth.otp.send_failed",
      severity: "medium",
      status_code: 400,
      email_hash: hashIdentifier(email),
      error_code: error.code,
      safe_message: "Unable to send verification code.",
    });
    return publicErrorResponse(error, "Unable to send verification code", 400);
  }

  securityEvent({
    ...ctx,
    event_type: "auth.otp.send_succeeded",
    severity: "info",
    status_code: 200,
    email_hash: hashIdentifier(email),
  });
  return NextResponse.json({ ok: true });
}
