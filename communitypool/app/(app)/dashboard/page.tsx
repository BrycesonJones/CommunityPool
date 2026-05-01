import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { UserJotWidget } from "@/components/userjot-widget";
import AddressBalanceSection from "./address-balance-section";
import DashboardOpenPools from "./dashboard-open-pools";

export const metadata: Metadata = {
  title: "Dashboard | CommunityPool",
  description: "Track address balances and manage community pools.",
};

export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-black font-sans flex flex-col">
      <div
        className="fixed inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(16,185,129,0.08),transparent)] pointer-events-none"
        aria-hidden
      />
      <SiteHeader>
        <nav className="flex items-center gap-4 mr-44">
          <Link
            href="/dashboard"
            className="text-sm font-medium text-brand-300 hover:text-brand-200 transition-colors"
          >
            Dashboard
          </Link>
          <Link
            href="/pools"
            className="text-sm font-medium text-zinc-400 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-black rounded-full px-3 py-2"
          >
            Pools
          </Link>
        </nav>
      </SiteHeader>
      <main className="relative flex-1 max-w-6xl mx-auto w-full px-4 py-8 space-y-8">
        <AddressBalanceSection />
        <DashboardOpenPools />
      </main>
      <UserJotWidget />
    </div>
  );
}
