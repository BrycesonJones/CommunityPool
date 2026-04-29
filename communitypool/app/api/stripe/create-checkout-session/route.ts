import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getAppUrl,
  getProPriceIdForInterval,
  getStripe,
  type ProInterval,
} from "@/lib/stripe/server";
import {
  fetchBillingStateForUser,
  persistStripeCustomerId,
} from "@/lib/stripe/subscription";
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
    return await handle(request);
  } catch (err) {
    securityEvent({
      ...ctx,
      event_type: "stripe.checkout.failed",
      severity: "high",
      status_code: 500,
      safe_message: "Unable to start checkout.",
    });
    return publicErrorResponse(err, "Unable to start checkout", 500);
  }
}

async function handle(request: Request) {
  const ctx = requestContextForSecurityEvent(request);
  const parsedInterval = await readInterval(request);
  if (!parsedInterval.ok) {
    securityEvent({
      ...ctx,
      event_type: "stripe.checkout.invalid_request",
      severity: "medium",
      status_code: 400,
      safe_message: "Invalid checkout request payload.",
    });
    return NextResponse.json(
      { error: "Invalid request", code: "invalid_request" },
      { status: 400 },
    );
  }
  const interval = parsedInterval.interval;
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
    { name: "stripe_checkout_user", identifier: user.id },
  ]);
  if (limited) return limited;

  const stripe = getStripe();
  const admin = createAdminClient();

  // user_profiles is created lazily (only on first KYC save), so a brand-new
  // signup may not have a row yet. Seed one here so the Stripe customer can
  // carry the user's email/username, and so KYC has a row to update later.
  const profileLookup = await admin
    .from("user_profiles")
    .select("email, username")
    .eq("id", user.id)
    .maybeSingle();
  let profile = profileLookup.data;
  if (profileLookup.error) {
    return publicErrorResponse(profileLookup.error, "Unable to start checkout", 500);
  }

  if (!profile) {
    const email = user.email ?? "";
    const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
    const username =
      typeof meta.username === "string" && meta.username.trim()
        ? meta.username.trim()
        : email || user.id;
    const { data: inserted, error: insertError } = await admin
      .from("user_profiles")
      .insert({ id: user.id, email, username })
      .select("email, username")
      .single();
    if (insertError || !inserted) {
      return publicErrorResponse(
        insertError ?? new Error("user_profiles insert returned no row"),
        "Unable to start checkout",
        500,
      );
    }
    profile = inserted;
  }

  const billingState = await fetchBillingStateForUser({ admin, userId: user.id });
  let customerId = billingState?.stripe_customer_id ?? null;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: profile.email ?? user.email ?? undefined,
      name: profile.username ?? undefined,
      metadata: { user_id: user.id },
    });
    customerId = customer.id;
    await persistStripeCustomerId({ admin, userId: user.id, customerId });
  }

  const appUrl = getAppUrl();
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: user.id,
    line_items: [{ price: getProPriceIdForInterval(interval), quantity: 1 }],
    success_url: `${appUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/pricing`,
    allow_promotion_codes: true,
    metadata: { user_id: user.id, plan: "pro", interval },
    subscription_data: {
      metadata: { user_id: user.id, plan: "pro", interval },
    },
  });

  if (!session.url) {
    return publicErrorResponse(
      new Error("Stripe Checkout returned no session URL"),
      "Unable to start checkout",
      502,
    );
  }

  securityEvent({
    ...ctx,
    event_type: "stripe.checkout.created",
    severity: "info",
    status_code: 200,
    user_id_hash: hashIdentifier(user.id),
    stripe_customer_id_hash: hashIdentifier(customerId),
    safe_message: "Stripe checkout session created.",
  });
  return NextResponse.json({ url: session.url });
}

type IntervalParseResult =
  | { ok: true; interval: ProInterval }
  | { ok: false };

async function readInterval(request: Request): Promise<IntervalParseResult> {
  const raw = await request.text();
  if (!raw.trim()) {
    // Empty body is explicitly allowed and defaults to monthly.
    return { ok: true, interval: "monthly" };
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false };
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false };
  }

  const interval = (body as { interval?: unknown }).interval;
  if (interval === undefined) return { ok: true, interval: "monthly" };
  if (interval === "monthly" || interval === "yearly") {
    return { ok: true, interval };
  }
  return { ok: false };
}
