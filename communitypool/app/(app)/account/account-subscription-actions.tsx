"use client";

import { useState } from "react";
import Link from "next/link";

type Props = { state: "free" | "pro" };

const PRIMARY =
  "inline-flex items-center justify-center rounded-full bg-gradient-to-b from-blue-400 via-blue-500 to-blue-700 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-blue-500/30 hover:from-blue-300 hover:via-blue-400 hover:to-blue-600 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-black disabled:opacity-60 disabled:cursor-not-allowed";

const SECONDARY =
  "inline-flex items-center justify-center rounded-full border border-zinc-700 px-5 py-2.5 text-sm font-medium text-zinc-200 hover:bg-zinc-900 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-black disabled:opacity-60 disabled:cursor-not-allowed";

export function AccountSubscriptionActions({ state }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go(endpoint: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, { method: "POST" });
      const text = await res.text();
      let body: { url?: string; error?: string } = {};
      try {
        body = text ? (JSON.parse(text) as { url?: string; error?: string }) : {};
      } catch {
        throw new Error(`Server returned ${res.status} with non-JSON body: ${text.slice(0, 200)}`);
      }
      if (!res.ok || !body.url) {
        throw new Error(body.error ?? `Request failed (${res.status}).`);
      }
      window.location.href = body.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error.");
      setBusy(false);
    }
  }

  if (state === "pro") {
    return (
      <div className="flex flex-col items-end gap-2">
        <button
          type="button"
          onClick={() => go("/api/stripe/create-billing-portal-session")}
          disabled={busy}
          className={SECONDARY}
        >
          {busy ? "Opening…" : "Manage subscription"}
        </button>
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Link href="/pricing" className={PRIMARY}>
        Subscribe
      </Link>
    </div>
  );
}
