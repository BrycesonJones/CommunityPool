import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe/server";
import {
  applySubscriptionToBillingState,
  markSubscriptionCanceled,
  resolveUserIdForCustomer,
} from "@/lib/stripe/subscription";
import { publicErrorResponse } from "@/lib/security/public-error";
import {
  hashIdentifier,
  requestContextForSecurityEvent,
  securityEvent,
} from "@/lib/security/security-event";

// `runtime = "nodejs"` is required so `stripe.webhooks.constructEvent` has
// access to the Node crypto module for signature verification. Edge runtime
// would silently break verification. `dynamic = "force-dynamic"` ensures the
// raw request body is preserved (no caching, no body parsing). Do not remove.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const ctx = requestContextForSecurityEvent(request);
  try {
    const signature = request.headers.get("stripe-signature");
    if (!signature) {
      securityEvent({
        ...ctx,
        event_type: "stripe.webhook.signature_failed",
        severity: "high",
        status_code: 400,
        safe_message: "Missing stripe-signature header.",
      });
      return publicErrorResponse(
        new Error("missing stripe-signature header"),
        "Unable to verify webhook",
        400,
      );
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      securityEvent({
        ...ctx,
        event_type: "stripe.webhook.processing_failed",
        severity: "critical",
        status_code: 500,
        error_code: "missing_webhook_secret",
        safe_message: "STRIPE_WEBHOOK_SECRET not configured.",
      });
      return publicErrorResponse(
        new Error("STRIPE_WEBHOOK_SECRET not configured"),
        "Service unavailable",
        500,
      );
    }

    const stripe = getStripe();
    const rawBody = await request.text();

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err) {
      securityEvent({
        ...ctx,
        event_type: "stripe.webhook.signature_failed",
        severity: "critical",
        status_code: 400,
        safe_message: "Stripe signature verification failed.",
      });
      return publicErrorResponse(err, "Unable to verify webhook", 400);
    }

    const admin = createAdminClient();
    const refs = extractStripeRefs(event);
    securityEvent({
      ...ctx,
      event_type: "stripe.webhook.received",
      severity: "info",
      stripe_event_id: event.id,
      stripe_customer_id_hash: hashIdentifier(refs.customerId),
      stripe_subscription_id_hash: hashIdentifier(refs.subscriptionId),
      metadata: { stripe_event_type: event.type },
    });
    const started = await startProcessedEventRow(admin, event, refs);
    if (started === "duplicate") {
      await markDuplicateDecision(admin, event.id);
      securityEvent({
        ...ctx,
        event_type: "stripe.webhook.duplicate_ignored",
        severity: "high",
        stripe_event_id: event.id,
        stripe_customer_id_hash: hashIdentifier(refs.customerId),
        stripe_subscription_id_hash: hashIdentifier(refs.subscriptionId),
        safe_message: "Duplicate Stripe event ignored.",
      });
      return NextResponse.json({ received: true });
    }

    const stale = await isOutOfOrderEvent(admin, event, refs);
    if (stale) {
      await finalizeProcessedEventRow(
        admin,
        event.id,
        "stale_ignored",
        "older_than_latest_processed",
      );
      securityEvent({
        ...ctx,
        event_type: "stripe.webhook.out_of_order_ignored",
        severity: "high",
        stripe_event_id: event.id,
        stripe_customer_id_hash: hashIdentifier(refs.customerId),
        stripe_subscription_id_hash: hashIdentifier(refs.subscriptionId),
        safe_message: "Out-of-order Stripe event ignored.",
      });
      return NextResponse.json({ received: true });
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "subscription") break;
        const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
        const subscriptionId =
          typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;
        if (!customerId || !subscriptionId) break;

        if (
          await hasMetadataMismatch(
            admin,
            customerId,
            session.client_reference_id ?? session.metadata?.user_id ?? null,
          )
        ) {
          await finalizeProcessedEventRow(
            admin,
            event.id,
            "failed",
            "metadata_customer_mismatch",
          );
          securityEvent({
            ...ctx,
            event_type: "stripe.webhook.metadata_customer_mismatch",
            severity: "critical",
            stripe_event_id: event.id,
            stripe_customer_id_hash: hashIdentifier(customerId),
            stripe_subscription_id_hash: hashIdentifier(subscriptionId),
            safe_message: "Metadata and customer ownership mismatch.",
          });
          return publicErrorResponse(
            new Error("metadata customer mismatch"),
            "Webhook processing failed",
            500,
          );
        }

        const userId = await resolveUserIdForCustomer({
          admin,
          customerId,
          metadataUserId: session.client_reference_id ?? session.metadata?.user_id ?? null,
        });
        if (!userId) {
          await finalizeProcessedEventRow(admin, event.id, "failed", "user_mapping_failed");
          securityEvent({
            ...ctx,
            event_type: "stripe.webhook.processing_failed",
            severity: "high",
            stripe_event_id: event.id,
            stripe_customer_id_hash: hashIdentifier(customerId),
            stripe_subscription_id_hash: hashIdentifier(subscriptionId),
            error_code: "user_mapping_failed",
            safe_message: "Webhook user mapping failed.",
          });
          return publicErrorResponse(
            new Error("user mapping failed"),
            "Webhook processing failed",
            500,
          );
        }

        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        await applySubscriptionToBillingState({ admin, userId, customerId, subscription });
        securityEvent({
          ...ctx,
          event_type: "stripe.webhook.billing_state_changed",
          severity: "info",
          stripe_event_id: event.id,
          stripe_customer_id_hash: hashIdentifier(customerId),
          stripe_subscription_id_hash: hashIdentifier(subscription.id),
          user_id_hash: hashIdentifier(userId),
          safe_message: "Billing state updated from checkout completion.",
        });
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId =
          typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
        if (
          await hasMetadataMismatch(
            admin,
            customerId,
            subscription.metadata?.user_id ?? null,
          )
        ) {
          await finalizeProcessedEventRow(
            admin,
            event.id,
            "failed",
            "metadata_customer_mismatch",
          );
          securityEvent({
            ...ctx,
            event_type: "stripe.webhook.metadata_customer_mismatch",
            severity: "critical",
            stripe_event_id: event.id,
            stripe_customer_id_hash: hashIdentifier(customerId),
            stripe_subscription_id_hash: hashIdentifier(subscription.id),
            safe_message: "Metadata and customer ownership mismatch.",
          });
          return publicErrorResponse(
            new Error("metadata customer mismatch"),
            "Webhook processing failed",
            500,
          );
        }
        const userId = await resolveUserIdForCustomer({
          admin,
          customerId,
          metadataUserId: subscription.metadata?.user_id ?? null,
        });
        if (!userId) {
          await finalizeProcessedEventRow(admin, event.id, "failed", "user_mapping_failed");
          securityEvent({
            ...ctx,
            event_type: "stripe.webhook.processing_failed",
            severity: "high",
            stripe_event_id: event.id,
            stripe_customer_id_hash: hashIdentifier(customerId),
            stripe_subscription_id_hash: hashIdentifier(subscription.id),
            error_code: "user_mapping_failed",
            safe_message: "Webhook user mapping failed.",
          });
          return publicErrorResponse(
            new Error("user mapping failed"),
            "Webhook processing failed",
            500,
          );
        }
        await applySubscriptionToBillingState({ admin, userId, customerId, subscription });
        securityEvent({
          ...ctx,
          event_type: "stripe.webhook.billing_state_changed",
          severity: "info",
          stripe_event_id: event.id,
          stripe_customer_id_hash: hashIdentifier(customerId),
          stripe_subscription_id_hash: hashIdentifier(subscription.id),
          user_id_hash: hashIdentifier(userId),
          safe_message: "Billing state updated from subscription event.",
        });
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId =
          typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
        const userId = await resolveUserIdForCustomer({
          admin,
          customerId,
          metadataUserId: subscription.metadata?.user_id ?? null,
        });
        if (!userId) {
          await finalizeProcessedEventRow(admin, event.id, "failed", "user_mapping_failed");
          securityEvent({
            ...ctx,
            event_type: "stripe.webhook.processing_failed",
            severity: "high",
            stripe_event_id: event.id,
            stripe_customer_id_hash: hashIdentifier(customerId),
            stripe_subscription_id_hash: hashIdentifier(subscription.id),
            error_code: "user_mapping_failed",
            safe_message: "Webhook user mapping failed.",
          });
          return publicErrorResponse(
            new Error("user mapping failed"),
            "Webhook processing failed",
            500,
          );
        }
        // OWASP A08 F-01: bind the downgrade to the deleted subscription
        // id. If a stale `subscription.deleted` for sub_OLD arrives after
        // the user has activated sub_NEW, `markSubscriptionCanceled`
        // returns `{ downgraded: false }` without overwriting the active
        // subscription. We log + return 200 so Stripe stops retrying.
        const result = await markSubscriptionCanceled({
          admin,
          userId,
          subscriptionId: subscription.id,
        });
        if (!result.downgraded) {
          await finalizeProcessedEventRow(
            admin,
            event.id,
            "stale_ignored",
            "subscription_id_does_not_match_active",
          );
          securityEvent({
            ...ctx,
            event_type: "stripe.webhook.out_of_order_ignored",
            severity: "high",
            stripe_event_id: event.id,
            stripe_customer_id_hash: hashIdentifier(customerId),
            stripe_subscription_id_hash: hashIdentifier(subscription.id),
            user_id_hash: hashIdentifier(userId),
            safe_message:
              "subscription.deleted ignored — does not match active subscription.",
          });
          return NextResponse.json({ received: true });
        }
        securityEvent({
          ...ctx,
          event_type: "stripe.webhook.billing_state_changed",
          severity: "info",
          stripe_event_id: event.id,
          stripe_customer_id_hash: hashIdentifier(customerId),
          stripe_subscription_id_hash: hashIdentifier(subscription.id),
          user_id_hash: hashIdentifier(userId),
          safe_message: "Billing state marked canceled.",
        });
        break;
      }

      case "invoice.paid":
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = readInvoiceSubscriptionId(invoice);
        if (!subscriptionId) break;
        const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id ?? null;
        if (!customerId) {
          await finalizeProcessedEventRow(admin, event.id, "failed", "user_mapping_failed");
          securityEvent({
            ...ctx,
            event_type: "stripe.webhook.processing_failed",
            severity: "high",
            stripe_event_id: event.id,
            stripe_subscription_id_hash: hashIdentifier(subscriptionId),
            error_code: "user_mapping_failed",
            safe_message: "Webhook user mapping failed.",
          });
          return publicErrorResponse(
            new Error("user mapping failed"),
            "Webhook processing failed",
            500,
          );
        }
        const userId = await resolveUserIdForCustomer({
          admin,
          customerId,
          metadataUserId: null,
        });
        if (!userId) {
          await finalizeProcessedEventRow(admin, event.id, "failed", "user_mapping_failed");
          securityEvent({
            ...ctx,
            event_type: "stripe.webhook.processing_failed",
            severity: "high",
            stripe_event_id: event.id,
            stripe_customer_id_hash: hashIdentifier(customerId),
            stripe_subscription_id_hash: hashIdentifier(subscriptionId),
            error_code: "user_mapping_failed",
            safe_message: "Webhook user mapping failed.",
          });
          return publicErrorResponse(
            new Error("user mapping failed"),
            "Webhook processing failed",
            500,
          );
        }
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        await applySubscriptionToBillingState({ admin, userId, customerId, subscription });
        securityEvent({
          ...ctx,
          event_type: "stripe.webhook.billing_state_changed",
          severity: "info",
          stripe_event_id: event.id,
          stripe_customer_id_hash: hashIdentifier(customerId),
          stripe_subscription_id_hash: hashIdentifier(subscription.id),
          user_id_hash: hashIdentifier(userId),
          safe_message: "Billing state updated from invoice event.",
        });
        break;
      }

      case "charge.refunded": {
        securityEvent({
          ...ctx,
          event_type: "stripe.webhook.refund_received",
          severity: "high",
          stripe_event_id: event.id,
          stripe_customer_id_hash: hashIdentifier(refs.customerId),
          safe_message: "Refund event received from Stripe.",
        });
        break;
      }

      case "charge.dispute.created":
      case "charge.dispute.updated":
      case "charge.dispute.closed": {
        securityEvent({
          ...ctx,
          event_type: "stripe.webhook.dispute_received",
          severity: "high",
          stripe_event_id: event.id,
          stripe_customer_id_hash: hashIdentifier(refs.customerId),
          safe_message: "Dispute event received from Stripe.",
          metadata: { stripe_event_type: event.type },
        });
        break;
      }

      default:
        // No-op for unhandled event types — Stripe will retry only on non-2xx.
        break;
    }
    await finalizeProcessedEventRow(admin, event.id, "processed", null);
  } catch (err) {
    securityEvent({
      ...ctx,
      event_type: "stripe.webhook.processing_failed",
      severity: "critical",
      status_code: 500,
      safe_message: "Stripe webhook handler failed.",
    });
    return publicErrorResponse(err, "Webhook processing failed", 500);
  }

  return NextResponse.json({ received: true });
}

function readInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  // The `subscription` field moved between API versions. Probe both shapes
  // safely so this handler works regardless of the account's pinned version.
  const top = (invoice as unknown as { subscription?: string | { id: string } | null }).subscription;
  if (typeof top === "string") return top;
  if (top && typeof top === "object" && "id" in top) return top.id;
  const parent = invoice.parent?.subscription_details?.subscription;
  if (typeof parent === "string") return parent;
  if (parent && typeof parent === "object" && "id" in parent) return parent.id;
  return null;
}

async function startProcessedEventRow(
  admin: ReturnType<typeof createAdminClient>,
  event: Stripe.Event,
  refs: { customerId: string | null; subscriptionId: string | null },
): Promise<"started" | "duplicate"> {
  const { error } = await admin.from("stripe_processed_events").insert({
    event_id: event.id,
    event_type: event.type,
    event_created: event.created,
    decision: "processing",
    received_at: new Date().toISOString(),
    stripe_customer_id_hash: hashIdentifier(refs.customerId) ?? null,
    stripe_subscription_id_hash: hashIdentifier(refs.subscriptionId) ?? null,
    updated_at: new Date().toISOString(),
  });
  if (!error) return "started";
  if (error.code === "23505") return "duplicate";
  throw new Error(`stripe_processed_events insert failed: ${error.message}`);
}

async function finalizeProcessedEventRow(
  admin: ReturnType<typeof createAdminClient>,
  eventId: string,
  decision: "processed" | "stale_ignored" | "failed",
  reason: string | null,
): Promise<void> {
  const { error } = await admin
    .from("stripe_processed_events")
    .update({
      decision,
      reason,
      processed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("event_id", eventId);
  if (error) {
    throw new Error(`stripe_processed_events update failed: ${error.message}`);
  }
}

async function markDuplicateDecision(
  admin: ReturnType<typeof createAdminClient>,
  eventId: string,
): Promise<void> {
  const { error } = await admin
    .from("stripe_processed_events")
    .update({
      decision: "duplicate_ignored",
      reason: "event_id already exists",
      processed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("event_id", eventId);
  if (error) {
    throw new Error(`stripe_processed_events duplicate update failed: ${error.message}`);
  }
}

async function isOutOfOrderEvent(
  admin: ReturnType<typeof createAdminClient>,
  event: Stripe.Event,
  refs: { customerId: string | null; subscriptionId: string | null },
): Promise<boolean> {
  const subscriptionHash = hashIdentifier(refs.subscriptionId);
  const customerHash = hashIdentifier(refs.customerId);
  if (!subscriptionHash && !customerHash) return false;
  let query = admin
    .from("stripe_processed_events")
    .select("event_created")
    .neq("event_id", event.id)
    .order("event_created", { ascending: false })
    .limit(1);
  if (subscriptionHash) {
    query = query.eq("stripe_subscription_id_hash", subscriptionHash);
  } else if (customerHash) {
    query = query.eq("stripe_customer_id_hash", customerHash);
  }
  const { data, error } = await query.maybeSingle();
  if (error) return false;
  const row = data as { event_created?: number } | null;
  if (typeof row?.event_created !== "number") return false;
  return row.event_created > event.created;
}

async function hasMetadataMismatch(
  admin: ReturnType<typeof createAdminClient>,
  customerId: string,
  metadataUserId: string | null,
): Promise<boolean> {
  if (!metadataUserId) return false;
  const { data, error } = await admin
    .from("user_billing_state")
    .select("user_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (error || !data?.user_id) return false;
  return data.user_id !== metadataUserId;
}

function extractStripeRefs(event: Stripe.Event): {
  customerId: string | null;
  subscriptionId: string | null;
} {
  const obj = event.data.object as unknown as Record<string, unknown>;
  const customerRaw = obj.customer as unknown;
  const subscriptionRaw = obj.subscription as unknown;
  const customerId =
    typeof customerRaw === "string"
      ? customerRaw
      : (customerRaw as { id?: string } | null)?.id ?? null;
  const subscriptionId =
    typeof subscriptionRaw === "string"
      ? subscriptionRaw
      : (subscriptionRaw as { id?: string } | null)?.id ?? null;
  return { customerId, subscriptionId };
}
