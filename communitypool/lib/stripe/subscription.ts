import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export const FREE_PLAN = "free" as const;
export const PRO_PLAN = "pro" as const;

const PRO_STATUSES = new Set<Stripe.Subscription.Status>(["active", "trialing"]);

// Pinned to the fields the predicate actually reads so callers can narrow
// their .select() to just those columns. `subscription_current_period_end`
// is required because the cache must not outlive the paid period — without
// the time bound, a missed `customer.subscription.deleted` would grant
// permanent Pro access (OWASP A06 F-05).
export type ProGateRow = Pick<
  Database["public"]["Tables"]["user_billing_state"]["Row"],
  | "subscription_plan"
  | "subscription_status"
  | "subscription_current_period_end"
>;

export const PRO_GATE_COLUMNS =
  "subscription_plan, subscription_status, subscription_current_period_end" as const;

export function isProActive(
  state: ProGateRow | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!state) return false;
  if (state.subscription_plan !== PRO_PLAN) return false;
  const status = state.subscription_status as Stripe.Subscription.Status | null;
  if (status === null || !PRO_STATUSES.has(status)) return false;
  // Period-end gate: the webhook may fail to fire `customer.subscription.deleted`
  // (or a renewal failure may not emit any event we listen for). Require the
  // cached period_end to be in the future so the cache can't grant entitlement
  // past the paid window.
  const periodEnd = state.subscription_current_period_end;
  if (!periodEnd) return false;
  const t = Date.parse(periodEnd);
  if (!Number.isFinite(t)) return false;
  return t > nowMs;
}

function planForStatus(status: Stripe.Subscription.Status): string {
  return PRO_STATUSES.has(status) ? PRO_PLAN : FREE_PLAN;
}

function periodEndIso(subscription: Stripe.Subscription): string | null {
  const item = subscription.items.data[0];
  const seconds = item?.current_period_end ?? null;
  return seconds ? new Date(seconds * 1000).toISOString() : null;
}

/**
 * Derive our domain interval ("monthly" | "yearly") from a Stripe subscription.
 * Prefer `metadata.interval` (set on Checkout for new subs in our flow), falling
 * back to the price's recurring.interval so renewal events and externally-created
 * subs still resolve correctly.
 */
function intervalFromSubscription(
  subscription: Stripe.Subscription,
): "monthly" | "yearly" | null {
  const meta = subscription.metadata?.interval;
  if (meta === "monthly" || meta === "yearly") return meta;
  const recurring = subscription.items.data[0]?.price.recurring?.interval;
  if (recurring === "year") return "yearly";
  if (recurring === "month") return "monthly";
  return null;
}

/**
 * On Stripe API versions ≥ 2025-08-27 (incl. 2026-04-22.dahlia), scheduling a
 * cancellation through the billing portal sets `cancel_at` (a unix timestamp)
 * rather than flipping the legacy `cancel_at_period_end` boolean. Treat either
 * signal as "scheduled to cancel" so the UI can show the correct copy.
 */
function isScheduledToCancel(subscription: Stripe.Subscription): boolean {
  if (subscription.cancel_at_period_end) return true;
  const cancelAt = (subscription as unknown as { cancel_at?: number | null }).cancel_at ?? null;
  return typeof cancelAt === "number" && cancelAt > 0;
}

/**
 * Write or refresh the per-user billing state. Upsert keys on user_id so
 * first-time subscribers get a row created and renewal events update in
 * place. Caller MUST resolve the Supabase user id (via metadata.user_id,
 * client_reference_id, or stripe_customer_id lookup) before invoking; we
 * never trust user_id from anywhere user-controllable.
 */
export async function applySubscriptionToBillingState(args: {
  admin: SupabaseClient<Database>;
  userId: string;
  customerId: string;
  subscription: Stripe.Subscription;
}): Promise<void> {
  const { admin, userId, customerId, subscription } = args;
  const status = subscription.status;
  const plan = planForStatus(status);

  const { error } = await admin.from("user_billing_state").upsert(
    {
      user_id: userId,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscription.id,
      subscription_status: status,
      subscription_plan: plan,
      subscription_current_period_end: periodEndIso(subscription),
      subscription_cancel_at_period_end: isScheduledToCancel(subscription),
      subscription_interval: intervalFromSubscription(subscription),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (error) {
    throw new Error(`Failed to update billing state for user ${userId}: ${error.message}`);
  }
}

/**
 * Downgrade a user to the Free plan. Used when a subscription is deleted or
 * permanently lost (e.g. after `customer.subscription.deleted`). Preserves
 * the stripe_customer_id so a re-subscribe re-uses the same customer.
 *
 * OWASP A08 F-01: Stripe retries `customer.subscription.deleted` for up to
 * 3 days and event ordering is best-effort. Without binding the downgrade
 * to a specific `stripe_subscription_id`, an old delete event for sub_OLD
 * arriving after the user has started sub_NEW would wipe the active
 * subscription. We require `subscriptionId` and verify it matches the row's
 * current `stripe_subscription_id` before downgrading. A mismatch is logged
 * and treated as a no-op (success) so Stripe stops retrying.
 *
 * Returns `{ downgraded: true }` when the row was updated, `{ downgraded: false }`
 * when the event was for a stale/unknown subscription. Either is success;
 * callers should not retry.
 */
export async function markSubscriptionCanceled(args: {
  admin: SupabaseClient<Database>;
  userId: string;
  subscriptionId: string;
}): Promise<{ downgraded: boolean }> {
  const { admin, userId, subscriptionId } = args;

  // Read the current row so we can confirm the deleted subscription is the
  // one we have on file. If there is no row at all we have nothing to undo,
  // and writing one would create a "ghost canceled" record for a user who
  // never subscribed.
  const { data: existing, error: readError } = await admin
    .from("user_billing_state")
    .select("stripe_subscription_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (readError) {
    throw new Error(
      `Billing state read failed for user ${userId}: ${readError.message}`,
    );
  }
  if (!existing) {
    console.warn(
      `[stripe] subscription.deleted for unknown user_billing_state user=${userId} sub=${subscriptionId}; ignoring`,
    );
    return { downgraded: false };
  }
  const currentSubId = existing.stripe_subscription_id;
  if (!currentSubId) {
    // Already downgraded — replay or out-of-order; no-op.
    console.warn(
      `[stripe] subscription.deleted received but row already has no subscription user=${userId} sub=${subscriptionId}; ignoring`,
    );
    return { downgraded: false };
  }
  if (currentSubId !== subscriptionId) {
    // The deleted subscription is NOT the one we have on file. This is the
    // out-of-order race: an old sub_OLD delete arriving after sub_NEW was
    // activated. Refusing to overwrite preserves the active subscription.
    console.warn(
      `[stripe] subscription.deleted ignored: stale subscription id user=${userId} deleted_sub=${subscriptionId} active_sub=${currentSubId}`,
    );
    return { downgraded: false };
  }

  const { error } = await admin
    .from("user_billing_state")
    .update({
      subscription_plan: FREE_PLAN,
      subscription_status: "canceled",
      stripe_subscription_id: null,
      subscription_current_period_end: null,
      subscription_cancel_at_period_end: false,
      subscription_interval: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    // Defence-in-depth: even if the read above raced with a concurrent
    // upsert, the update is still bound to the deleted subscription id at
    // the SQL layer.
    .eq("stripe_subscription_id", subscriptionId);
  if (error) {
    throw new Error(`Failed to cancel subscription for user ${userId}: ${error.message}`);
  }
  return { downgraded: true };
}

/**
 * Resolve the Supabase user id for a Stripe event.
 *
 * OWASP A08 F-06: today's checkout-session route sets `metadata.user_id`
 * from the authenticated session, so the field is trusted-on-write. But a
 * future Stripe Customer Portal misconfiguration (or a stripe-cli replay
 * with arbitrary metadata) could let the field claim a different user.
 * Treating an existing `(stripe_customer_id → user_id)` mapping as the
 * source of truth prevents metadata from re-binding billing state to a
 * different user.
 *
 * Resolution order:
 *   1. If we already have a row for this `stripe_customer_id`, return its
 *      `user_id`. If `metadataUserId` disagrees, log a warning and stick
 *      with the existing mapping.
 *   2. Otherwise, return `metadataUserId` (this is the new-customer seed
 *      path — checkout.session.completed for a brand-new subscriber).
 *   3. Otherwise, return null and let the caller log + skip.
 */
export async function resolveUserIdForCustomer(args: {
  admin: SupabaseClient<Database>;
  customerId: string | null;
  metadataUserId?: string | null;
}): Promise<string | null> {
  const { admin, customerId, metadataUserId } = args;

  // Customer-id mapping wins when it exists (F-06).
  if (customerId) {
    const { data, error } = await admin
      .from("user_billing_state")
      .select("user_id")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();
    if (error) {
      throw new Error(`Lookup by stripe_customer_id failed: ${error.message}`);
    }
    if (data?.user_id) {
      if (metadataUserId && metadataUserId !== data.user_id) {
        console.warn(
          `[stripe] metadata.user_id mismatch with stored customer mapping; preferring stored mapping customer=${customerId} stored_user=${data.user_id} metadata_user=${metadataUserId}`,
        );
      }
      return data.user_id;
    }
  }

  // No existing mapping — this is the first event for this customer. Trust
  // metadata.user_id (which is set by /api/stripe/create-checkout-session
  // from the authenticated session).
  if (metadataUserId) return metadataUserId;
  return null;
}

/**
 * Read the billing state for a user via the service-role admin client.
 * Used by routes that need to know whether the user already has a Stripe
 * customer id (e.g. checkout reuses the existing customer).
 */
export async function fetchBillingStateForUser(args: {
  admin: SupabaseClient<Database>;
  userId: string;
}): Promise<Database["public"]["Tables"]["user_billing_state"]["Row"] | null> {
  const { admin, userId } = args;
  const { data, error } = await admin
    .from("user_billing_state")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(`Billing state lookup failed: ${error.message}`);
  }
  return data ?? null;
}

/**
 * Persist a freshly-created Stripe customer id for a user. Upserts so the
 * first-time-checkout path works even if the user has no prior billing row.
 */
export async function persistStripeCustomerId(args: {
  admin: SupabaseClient<Database>;
  userId: string;
  customerId: string;
}): Promise<void> {
  const { admin, userId, customerId } = args;
  const { error } = await admin.from("user_billing_state").upsert(
    {
      user_id: userId,
      stripe_customer_id: customerId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) {
    throw new Error(`Failed to persist stripe_customer_id for ${userId}: ${error.message}`);
  }
}
