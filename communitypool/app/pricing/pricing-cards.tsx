"use client";

import { useState } from "react";
import Link from "next/link";
import { ProCtaButton } from "./pro-cta-button";

type ProState = "anonymous" | "free" | "pro";
type Interval = "monthly" | "yearly";

export function PricingCards({ proState }: { proState: ProState }) {
  const [interval, setInterval] = useState<Interval>("monthly");
  const isYearly = interval === "yearly";

  return (
    <>
      <BillingToggle interval={interval} onChange={setInterval} />

      <div className="grid grid-cols-1 gap-8 md:grid-cols-2 max-w-4xl mx-auto">
        <FreeCard />
        <ProCard interval={interval} isYearly={isYearly} proState={proState} />
      </div>
    </>
  );
}

function BillingToggle({
  interval,
  onChange,
}: {
  interval: Interval;
  onChange: (next: Interval) => void;
}) {
  return (
    <div className="mb-10 flex justify-center">
      <div
        role="tablist"
        aria-label="Billing period"
        className="inline-flex items-center rounded-full border border-zinc-800 bg-zinc-950/80 p-1"
      >
        <ToggleOption
          active={interval === "monthly"}
          onClick={() => onChange("monthly")}
          label="Monthly"
        />
        <ToggleOption
          active={interval === "yearly"}
          onClick={() => onChange("yearly")}
          label="Yearly"
          badge="Save 33%"
        />
      </div>
    </div>
  );
}

function ToggleOption({
  active,
  onClick,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  badge?: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`relative inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-black ${
        active
          ? "bg-gradient-to-b from-blue-400 via-blue-500 to-blue-700 text-white shadow-lg shadow-blue-500/30"
          : "text-zinc-400 hover:text-white"
      }`}
    >
      <span>{label}</span>
      {badge ? (
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
            active
              ? "bg-white/20 text-white"
              : "bg-blue-500/15 text-blue-300"
          }`}
        >
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function FreeCard() {
  return (
    <div className="relative rounded-3xl p-[2px] bg-gradient-to-br from-blue-400 via-blue-500 to-blue-700 shadow-[0_0_40px_rgba(59,130,246,0.2)]">
      <div className="rounded-[calc(1.5rem-2px)] bg-zinc-950 p-8 h-full flex flex-col">
        <h2 className="text-sm font-medium text-zinc-400 mb-4">Free</h2>
        <div className="mb-6">
          <span className="text-5xl font-bold text-white">Free</span>
        </div>
        <Link
          href="/signup"
          className="inline-flex items-center justify-center rounded-full bg-gradient-to-b from-blue-400 via-blue-500 to-blue-700 px-6 py-3 text-base font-medium text-white shadow-lg shadow-blue-500/30 hover:from-blue-300 hover:via-blue-400 hover:to-blue-600 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-black mb-6"
        >
          Get Started
        </Link>
        <p className="text-sm text-zinc-400 mb-6">All essential features.</p>
        <div className="h-px bg-zinc-800 mb-6" />
        <ul className="space-y-3">
          <li className="flex items-start gap-3">
            <CheckIcon />
            <span className="text-sm text-zinc-300">Portfolio tracking (BTC, ETH, PAXG)</span>
          </li>
          <li className="flex items-start gap-3">
            <CheckIcon />
            <span className="text-sm text-zinc-300">Limited deployed pools</span>
          </li>
          <li className="flex items-start gap-3">
            <CheckIcon />
            <span className="text-sm text-zinc-300">Multi-owner pool support</span>
          </li>
          <li className="flex items-start gap-3">
            <CheckIcon />
            <span className="text-sm text-zinc-300">On-chain history</span>
          </li>
        </ul>
      </div>
    </div>
  );
}

function ProCard({
  interval,
  isYearly,
  proState,
}: {
  interval: Interval;
  isYearly: boolean;
  proState: ProState;
}) {
  const price = isYearly ? "$160" : "$20";
  const cadence = isYearly ? "/ year" : "/ month";

  return (
    <div className="relative rounded-3xl p-[2px] bg-gradient-to-br from-blue-400 via-blue-500 to-blue-700 shadow-[0_0_40px_rgba(59,130,246,0.2)]">
      <div className="rounded-[calc(1.5rem-2px)] bg-zinc-950 p-8 h-full flex flex-col">
        <h2 className="text-sm font-medium text-zinc-400 mb-4">Pro</h2>
        <div className="mb-2 flex items-baseline gap-2">
          <span className="text-5xl font-bold text-white">{price}</span>
          <span className="text-sm text-zinc-500">{cadence}</span>
        </div>
        <p
          className={`mb-6 text-sm font-medium ${
            isYearly ? "text-blue-300" : "text-transparent select-none"
          }`}
          aria-hidden={!isYearly}
        >
          Save $80 · 4 months free
        </p>
        <ProCtaButton state={proState} interval={interval} />
        <p className="text-sm text-zinc-400 mb-6">Everything in Free, plus…</p>
        <div className="h-px bg-zinc-800 mb-6" />
        <ul className="space-y-3">
          <li className="flex items-start gap-3">
            <CheckIcon />
            <span className="text-sm text-zinc-300">Unlimited deployed pools</span>
          </li>
          <li className="flex items-start gap-3">
            <CheckIcon />
            <span className="text-sm text-zinc-300">Pool analytics dashboard</span>
          </li>
          <li className="flex items-start gap-3">
            <CheckIcon />
            <span className="text-sm text-zinc-300">API key access</span>
          </li>
          <li className="flex items-start gap-3">
            <CheckIcon />
            <span className="text-sm text-zinc-300">Priority support</span>
          </li>
        </ul>
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-5 w-5 shrink-0 text-blue-400 mt-0.5"
      fill="currentColor"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.5 7.571a1 1 0 0 1-1.42.003l-3.5-3.5a1 1 0 1 1 1.414-1.414l2.79 2.79 6.796-6.858a1 1 0 0 1 1.414-.006Z"
        clipRule="evenodd"
      />
    </svg>
  );
}
