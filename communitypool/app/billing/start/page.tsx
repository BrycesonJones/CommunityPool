"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SiteHeader } from "@/components/site-header";

export default function BillingStartPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/stripe/create-checkout-session", { method: "POST" });
        if (cancelled) return;
        if (res.status === 401) {
          router.replace("/login?next=/billing/start");
          return;
        }
        const text = await res.text();
        let body: { url?: string; error?: string } = {};
        try {
          body = text ? (JSON.parse(text) as { url?: string; error?: string }) : {};
        } catch {
          throw new Error(`Server returned ${res.status} with non-JSON body: ${text.slice(0, 200)}`);
        }
        if (!res.ok || !body.url) {
          throw new Error(body.error ?? `Checkout failed (${res.status}).`);
        }
        window.location.href = body.url;
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Unexpected error.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="min-h-screen bg-black font-sans flex flex-col">
      <div
        className="fixed inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(16,185,129,0.12),transparent)] pointer-events-none"
        aria-hidden
      />
      <SiteHeader brandHref="/" />
      <main className="relative flex-1 max-w-2xl w-full mx-auto px-4 pt-24 pb-24 text-center">
        {error ? (
          <div className="rounded-3xl p-[2px] bg-gradient-to-br from-blue-400 via-blue-500 to-blue-700 shadow-[0_0_40px_rgba(59,130,246,0.2)]">
            <div className="rounded-[calc(1.5rem-2px)] bg-zinc-950 p-10">
              <h1 className="text-2xl font-semibold text-white mb-3">
                Couldn&apos;t start checkout
              </h1>
              <p className="text-zinc-400 mb-6">{error}</p>
              <Link
                href="/pricing"
                className="inline-flex items-center justify-center rounded-full border border-zinc-700 px-6 py-3 text-base font-medium text-zinc-200 hover:bg-zinc-900 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-black"
              >
                Back to pricing
              </Link>
            </div>
          </div>
        ) : (
          <div className="text-zinc-400 pt-16">
            <p className="text-lg">Redirecting you to secure checkout…</p>
          </div>
        )}
      </main>
    </div>
  );
}
