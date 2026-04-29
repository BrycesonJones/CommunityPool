import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SiteHeader } from "@/components/site-header";
import LoginForm from "./login-form";

export const metadata: Metadata = {
  title: "Log in | CommunityPool",
  description:
    "Log in to your CommunityPool account to track portfolios and manage community pools.",
};

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-black font-sans flex flex-col">
      <div
        className="fixed inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(16,185,129,0.08),transparent)] pointer-events-none"
        aria-hidden
      />
      <SiteHeader brandHref="/">
        <Link
          href="/signup"
          className="text-sm font-medium text-zinc-400 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-black rounded px-3 py-2"
        >
          Sign up
        </Link>
      </SiteHeader>
      <main className="relative flex-1 flex items-center justify-center px-4 py-12">
        <Suspense
          fallback={
            <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950/90 px-8 py-10 text-center text-sm text-zinc-400">
              Loading…
            </div>
          }
        >
          <LoginForm />
        </Suspense>
      </main>
    </div>
  );
}
