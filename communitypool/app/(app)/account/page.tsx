import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { AccountProfileCard } from "./account-profile-card";
import { AccountSecurityCard } from "./account-security-card";
import { AccountSubscriptionCard } from "./account-subscription-card";

export const metadata: Metadata = {
  title: "Account | CommunityPool",
  description: "Manage your CommunityPool account settings.",
};

export const dynamic = "force-dynamic";

export default function AccountPage() {
  return (
    <div className="min-h-screen bg-black font-sans">
      <div
        className="fixed inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(16,185,129,0.08),transparent)] pointer-events-none"
        aria-hidden
      />
      <SiteHeader>
        <nav className="flex items-center gap-4 mr-44">
          <Link
            href="/dashboard"
            className="text-sm font-medium text-zinc-400 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-black rounded-full px-3 py-2"
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
      <main className="relative mx-auto w-full max-w-3xl px-4 py-8 space-y-8">
        <h1 className="sr-only">Account</h1>
        <AccountProfileCard />
        <AccountSecurityCard />
        <AccountSubscriptionCard />
      </main>
    </div>
  );
}
