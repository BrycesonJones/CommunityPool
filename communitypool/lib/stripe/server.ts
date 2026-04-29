import "server-only";
import Stripe from "stripe";

let cachedStripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (cachedStripe) return cachedStripe;
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set. Add it to .env.local before calling Stripe.",
    );
  }
  cachedStripe = new Stripe(secret, { typescript: true });
  return cachedStripe;
}

export function getAppUrl(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_APP_URL is not set.");
  }
  if (
    process.env.NODE_ENV === "production" &&
    url.startsWith("http://localhost")
  ) {
    throw new Error("Invalid production NEXT_PUBLIC_APP_URL");
  }
  return url.replace(/\/$/, "");
}

export type ProInterval = "monthly" | "yearly";

export function getProPriceIdForInterval(interval: ProInterval): string {
  const envName =
    interval === "yearly"
      ? "STRIPE_PRO_YEARLY_PRICE_ID"
      : "STRIPE_PRO_MONTHLY_PRICE_ID";
  const priceId = process.env[envName];
  if (!priceId) {
    throw new Error(`${envName} is not set.`);
  }
  return priceId;
}
