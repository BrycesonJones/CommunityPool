import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Checkout canceled | CommunityPool",
};

export default function BillingCancelPage() {
  return (
    <div className="min-h-screen bg-black font-sans flex flex-col">
      <div
        className="fixed inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(16,185,129,0.12),transparent)] pointer-events-none"
        aria-hidden
      />
      <SiteHeader brandHref="/" />
      <main className="relative flex-1 max-w-2xl w-full mx-auto px-4 pt-24 pb-24">
        <div className="rounded-3xl p-[2px] bg-gradient-to-br from-blue-400 via-blue-500 to-blue-700 shadow-[0_0_40px_rgba(59,130,246,0.2)]">
          <div className="rounded-[calc(1.5rem-2px)] bg-zinc-950 p-10 text-center">
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-white mb-4">
              Checkout canceled.
            </h1>
            <p className="text-zinc-400 mb-8">
              No charge was made. You can keep using CommunityPool on the Free plan, or try Pro
              again whenever you&apos;re ready.
            </p>
            <Link
              href="/pricing"
              className="inline-flex items-center justify-center rounded-full bg-gradient-to-b from-blue-400 via-blue-500 to-blue-700 px-6 py-3 text-base font-medium text-white shadow-lg shadow-blue-500/30 hover:from-blue-300 hover:via-blue-400 hover:to-blue-600 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-black"
            >
              Back to pricing
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
