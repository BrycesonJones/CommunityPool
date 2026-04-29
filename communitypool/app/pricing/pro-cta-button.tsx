"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ProState = "anonymous" | "free" | "pro";
type Interval = "monthly" | "yearly";

const BUTTON_CLASS =
  "inline-flex items-center justify-center rounded-full bg-gradient-to-b from-blue-400 via-blue-500 to-blue-700 px-6 py-3 text-base font-medium text-white shadow-lg shadow-blue-500/30 hover:from-blue-300 hover:via-blue-400 hover:to-blue-600 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-black mb-6 disabled:opacity-60 disabled:cursor-not-allowed";

export function ProCtaButton({
  state,
  interval = "monthly",
}: {
  state: ProState;
  interval?: Interval;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubscribe() {
    if (state === "anonymous") {
      router.push(`/signup?intent=subscribe-pro&interval=${interval}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interval }),
      });
      if (res.status === 401) {
        router.push("/login?next=/pricing");
        return;
      }
      const body = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !body.url) {
        throw new Error(body.error ?? "Failed to start checkout.");
      }
      window.location.href = body.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error.");
      setBusy(false);
    }
  }

  async function handleManage() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/create-billing-portal-session", { method: "POST" });
      const body = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !body.url) {
        throw new Error(body.error ?? "Failed to open billing portal.");
      }
      window.location.href = body.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error.");
      setBusy(false);
    }
  }

  if (state === "pro") {
    return (
      <>
        <button
          type="button"
          onClick={handleManage}
          disabled={busy}
          className={BUTTON_CLASS}
        >
          {busy ? "Opening…" : "Manage Subscription"}
        </button>
        {error ? <p className="text-sm text-red-400 mb-4 -mt-4">{error}</p> : null}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={handleSubscribe}
        disabled={busy}
        className={BUTTON_CLASS}
      >
        {busy ? "Redirecting…" : "Subscribe"}
      </button>
      {error ? <p className="text-sm text-red-400 mb-4 -mt-4">{error}</p> : null}
    </>
  );
}
