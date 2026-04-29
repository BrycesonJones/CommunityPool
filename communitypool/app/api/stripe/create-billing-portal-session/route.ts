import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAppUrl, getStripe } from "@/lib/stripe/server";
import { fetchBillingStateForUser } from "@/lib/stripe/subscription";
import { enforceRateLimits } from "@/lib/security/rate-limit";
import { apiErrorResponse, publicErrorResponse } from "@/lib/security/public-error";
import {
  hashIdentifier,
  requestContextForSecurityEvent,
  securityEvent,
} from "@/lib/security/security-event";

export async function POST(request: Request) {
  const ctx = requestContextForSecurityEvent(request);
  try {
    return await handle(request, ctx);
  } catch (err) {
    securityEvent({
      ...ctx,
      event_type: "stripe.billing_portal.failed",
      severity: "high",
      status_code: 500,
      safe_message: "Unable to open billing portal.",
    });
    return publicErrorResponse(err, "Unable to open billing portal", 500);
  }
}

async function handle(
  request: Request,
  ctx: ReturnType<typeof requestContextForSecurityEvent>,
) {
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

  const limited = await enforceRateLimits([
    { name: "stripe_portal_user", identifier: user.id },
  ]);
  if (limited) return limited;

  const admin = createAdminClient();
  const billingState = await fetchBillingStateForUser({ admin, userId: user.id });

  if (!billingState?.stripe_customer_id) {
    return apiErrorResponse({
      error: "Invalid request",
      code: "invalid_request",
      status: 400,
      request,
    });
  }

  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: billingState.stripe_customer_id,
    return_url: `${getAppUrl()}/account`,
  });

  securityEvent({
    ...ctx,
    event_type: "stripe.billing_portal.created",
    severity: "info",
    status_code: 200,
    user_id_hash: hashIdentifier(user.id),
    stripe_customer_id_hash: hashIdentifier(billingState.stripe_customer_id),
    safe_message: "Stripe billing portal session created.",
  });
  return NextResponse.json({ url: session.url });
}
