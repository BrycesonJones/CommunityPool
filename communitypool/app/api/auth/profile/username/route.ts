import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { apiErrorResponse, publicErrorResponse } from "@/lib/security/public-error";
import {
  hashIdentifier,
  requestContextForSecurityEvent,
  securityEvent,
} from "@/lib/security/security-event";

export const runtime = "nodejs";

// Same shape used at sign-up in `/api/auth/otp/send` so the post-login edit
// path can't smuggle a longer or differently-shaped username into
// `auth.users.user_metadata.username` than what we accept on first contact.
// Anything outside ASCII letters/digits and `_.-`, or longer than 40 chars,
// is refused — including HTML, control bytes, emoji, and whitespace runs.
const USERNAME_RE = /^[A-Za-z0-9_.-]{1,40}$/;

/**
 * POST /api/auth/profile/username
 *
 * Authenticated; updates the caller's `user_metadata.username`. The browser
 * SDK's `auth.updateUser({ data: { username } })` was previously called from
 * `account-profile-card.tsx` with no length/regex guard — clients could write
 * arbitrary UTF-8 (HTML, control chars, multi-KB blobs) into metadata that
 * is then echoed back across the app and sent to Stripe as `customer.name`.
 * Routing through the server lets us re-apply `USERNAME_RE` and use the
 * service-role admin client to update only the authenticated user's metadata.
 *
 * Identity comes from the Supabase session cookie (`getUser()`); we never
 * read `user_id` from the request body. The `data` field on `updateUserById`
 * is merged into `raw_user_meta_data`, so existing keys (e.g. `full_name`)
 * are preserved.
 */
export async function POST(request: Request) {
  const ctx = requestContextForSecurityEvent(request);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    securityEvent({
      ...ctx,
      event_type: "api.auth_required",
      severity: "medium",
      status_code: 401,
      safe_message: "Authenticated API access required.",
    });
    return apiErrorResponse({
      error: "Authentication required",
      code: "authentication_required",
      status: 401,
      request,
    });
  }

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

  const raw = typeof body.username === "string" ? body.username.trim() : "";
  if (!USERNAME_RE.test(raw)) {
    return apiErrorResponse({
      error: "Invalid request",
      code: "invalid_request",
      status: 400,
      request,
    });
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(user.id, {
    user_metadata: { username: raw },
  });
  if (error) {
    securityEvent({
      ...ctx,
      event_type: "auth.profile.username_update_failed",
      severity: "medium",
      status_code: 500,
      user_id_hash: hashIdentifier(user.id),
      safe_message: "Unable to update username.",
    });
    return publicErrorResponse(error, "Unable to update username", 500);
  }

  securityEvent({
    ...ctx,
    event_type: "auth.profile.username_updated",
    severity: "info",
    status_code: 200,
    user_id_hash: hashIdentifier(user.id),
  });
  return NextResponse.json({ ok: true, username: raw });
}
