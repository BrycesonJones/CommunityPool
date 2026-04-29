import { createClient } from "@/lib/supabase/server";
import { isProActive } from "@/lib/stripe/subscription";
import { AccountSubscriptionActions } from "./account-subscription-actions";

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export async function AccountSubscriptionCard() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Read billing state from the dedicated table. RLS scopes the result to
  // `auth.uid() = user_id`, so the anon client cannot leak another user's row.
  const { data: billingState } = await supabase
    .from("user_billing_state")
    .select(
      "subscription_plan, subscription_status, subscription_current_period_end, subscription_cancel_at_period_end, subscription_interval",
    )
    .eq("user_id", user.id)
    .maybeSingle();

  const isPro = isProActive(billingState);
  const state = isPro ? "pro" : "free";
  const periodEnd = formatDate(billingState?.subscription_current_period_end ?? null);
  const status = billingState?.subscription_status ?? null;
  const cancelAtPeriodEnd = billingState?.subscription_cancel_at_period_end ?? false;
  const isYearly = billingState?.subscription_interval === "yearly";
  const priceLabel = isYearly ? "$160 / year" : "$20 / month";

  const planLabel = isPro ? "Pro" : "Free";
  const periodLabel = periodEnd
    ? ` · ${cancelAtPeriodEnd ? "Cancels" : "Renews"} ${periodEnd}`
    : "";
  const description = isPro
    ? `${priceLabel} · ${status === "trialing" ? "Trial" : "Active"}${periodLabel}`
    : "Free plan: up to 2 deployed pools. Upgrade to Pro for unlimited pools, analytics, API access, and priority support.";

  return (
    <section
      aria-label="Subscription"
      className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-6 shadow-xl"
    >
      <header className="flex items-center gap-3 pb-6">
        <span
          aria-hidden
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/80"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5 text-white"
          >
            <path d="M12 2 4 6v6c0 5 3.4 9.3 8 10 4.6-.7 8-5 8-10V6l-8-4z" />
          </svg>
        </span>
        <h2 className="text-lg font-semibold text-white">Subscription</h2>
      </header>

      <div className="flex items-center justify-between gap-4 py-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">
            Current plan: <span className="text-blue-300">{planLabel}</span>
          </p>
          <p className="mt-1 text-sm text-zinc-500">{description}</p>
        </div>
        <AccountSubscriptionActions state={state} />
      </div>
    </section>
  );
}

export default AccountSubscriptionCard;
