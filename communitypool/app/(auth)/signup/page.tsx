import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import SignupForm from "./signup-form";

export const metadata: Metadata = {
  title: "Create account | CommunityPool",
  description:
    "Create your CommunityPool account to track portfolios and deploy community funding pools.",
};

export default function SignupPage() {
  return (
    <div className="min-h-screen bg-black font-sans flex flex-col">
      <div
        className="fixed inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(16,185,129,0.08),transparent)] pointer-events-none"
        aria-hidden
      />
      <SiteHeader brandHref="/">
        <Link
          href="/login"
          className="text-sm font-medium text-zinc-400 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-black rounded px-3 py-2"
        >
          Login
        </Link>
      </SiteHeader>
      <main className="relative flex-1 flex items-center justify-center px-4 py-12">
        <Suspense fallback={null}>
          <SignupForm />
        </Suspense>
      </main>
    </div>
  );
}
