import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { createClient } from "@/lib/supabase/server";
import { isProActive, PRO_GATE_COLUMNS } from "@/lib/stripe/subscription";
import { PricingCards } from "./pricing-cards";

export const metadata: Metadata = {
  title: "Pricing | CommunityPool",
  description:
    "Choose the CommunityPool plan that fits your community — Free to get started, Pro for unlimited pools and advanced features.",
};

export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let proState: "anonymous" | "free" | "pro" = "anonymous";
  if (user) {
    const { data: billingState } = await supabase
      .from("user_billing_state")
      .select(PRO_GATE_COLUMNS)
      .eq("user_id", user.id)
      .maybeSingle();
    proState = isProActive(billingState) ? "pro" : "free";
  }

  return (
    <div className="min-h-screen bg-black font-sans flex flex-col">
      <div
        className="fixed inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(16,185,129,0.12),transparent)] pointer-events-none"
        aria-hidden
      />
      <SiteHeader brandHref="/">
        <nav className="flex items-center gap-4">
          <Link
            href="/pricing"
            className="text-sm font-medium text-white transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-black rounded px-3 py-2"
          >
            Pricing
          </Link>
          <Link
            href="/login"
            className="text-sm font-medium text-zinc-400 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-black rounded px-3 py-2"
          >
            Login
          </Link>
          <Link
            href="/signup"
            className="inline-flex items-center justify-center rounded-full bg-gradient-to-b from-blue-400 via-blue-500 to-blue-700 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-blue-500/30 hover:from-blue-300 hover:via-blue-400 hover:to-blue-600 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-black"
          >
            Get Started
          </Link>
        </nav>
      </SiteHeader>
      <main className="relative flex-1 max-w-6xl w-full mx-auto px-4 pt-16 pb-24 sm:pt-24">
        <section aria-labelledby="pricing-heading">
          <div className="text-center mb-16 max-w-2xl mx-auto">
            <h1
              id="pricing-heading"
              className="text-4xl sm:text-5xl font-semibold tracking-tight text-white leading-tight mb-4"
            >
              Simple, transparent pricing
            </h1>
            <p className="text-lg text-zinc-400">
              Start for free. Upgrade when your community grows.
            </p>
          </div>

          <PricingCards proState={proState} />
        </section>
      </main>
    </div>
  );
}
