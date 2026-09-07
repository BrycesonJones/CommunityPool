import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Fees | CommunityPool",
  description:
    "CommunityPool is free to sign up for and use. There are no monthly subscription fees. Launch protocol fee: 1%, deducted from contributions when a CommunityPool is funded. The current rate is shown before funding and may be changed on-chain, subject to the immutable 3% maximum.",
};

/**
 * Public, informational Fees page. Intentionally static: no plan lookup, no billing state, no
 * calculator, no chain reads. The protocol fee went live for new (V2) pools in Phase 2.8, so this
 * page states the launch rate, the direction of the deduction, the on-chain ceiling, and the
 * limits of protocol-admin authority. The live rate a funder actually pays is read from the
 * contract in the funding flow — this page is the plain-language explanation, not the source of
 * truth. If the administrator changes the rate on-chain, update the copy here to match.
 */
export default function FeesPage() {
  return (
    <div className="min-h-screen bg-black font-sans flex flex-col">
      <div
        className="fixed inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(16,185,129,0.12),transparent)] pointer-events-none"
        aria-hidden
      />
      <SiteHeader brandHref="/">
        <nav className="flex items-center gap-4">
          <Link
            href="/fees"
            className="text-sm font-medium text-white transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-black rounded px-3 py-2"
          >
            Fees
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
      <main className="relative flex-1 max-w-3xl w-full mx-auto px-4 pt-16 pb-24 sm:pt-24">
        <section aria-labelledby="fees-heading">
          <div className="text-center mb-12 max-w-2xl mx-auto">
            <h1
              id="fees-heading"
              className="text-4xl sm:text-5xl font-semibold tracking-tight text-white leading-tight mb-4"
            >
              Fees
            </h1>
            <p className="text-lg text-zinc-400">
              CommunityPool is free to sign up for and use.
            </p>
          </div>

          {/* Quick-scan summary: the numbers first, prose second. */}
          <div className="rounded-3xl p-[2px] bg-gradient-to-br from-blue-400 via-blue-500 to-blue-700 shadow-[0_0_40px_rgba(59,130,246,0.2)]">
            <div className="rounded-[calc(1.5rem-2px)] bg-zinc-950 p-6 sm:p-8">
              <ul className="grid gap-3 sm:grid-cols-2">
                {[
                  "Free to create an account",
                  "Free to deploy CommunityPools",
                  "Unlimited CommunityPool deployments",
                  "No monthly subscription fee",
                  "Launch protocol fee: 1%",
                  "Protocol fee is deducted from the amount funded",
                  "Current fee is shown before confirmation",
                  "Immutable maximum protocol fee: 3%",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <CheckIcon />
                    <span className="text-sm text-zinc-300">{item}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-6 h-px bg-zinc-800" />
              <p className="mt-6 text-sm text-zinc-400">
                The fee comes <strong className="text-white">out of</strong> the amount you fund —
                it is never added on top. Fund 1.00 PAXG and your wallet is debited 1.00 PAXG:
                0.01 PAXG goes to the treasury and 0.99 PAXG goes into the pool. The rate lives in
                a contract on Ethereum, not on this website, so the current rate is always shown
                before you confirm.
              </p>
            </div>
          </div>
        </section>

        <section aria-labelledby="admin-authority-heading" className="mt-16">
          <h2
            id="admin-authority-heading"
            className="text-2xl font-semibold tracking-tight text-white"
          >
            Admin Authority
          </h2>
          <p className="mt-2 text-sm text-zinc-400">
            The CommunityPool admin controls limited protocol configuration.
          </p>

          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-emerald-400">
                Admin can
              </h3>
              <ul className="mt-3 space-y-2.5">
                {[
                  "Change the protocol fee within the hardcoded 0%–3% range",
                  "Change the protocol treasury address",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <AllowedIcon />
                    <span className="text-sm text-zinc-300">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-rose-400">
                Admin cannot
              </h3>
              <ul className="mt-3 space-y-2.5">
                {[
                  "Withdraw assets from CommunityPools",
                  "Move or transfer user pool assets",
                  "Change CommunityPool ownership",
                  "Access users’ wallets",
                  "Override CommunityPool withdrawal rules",
                  "Use administrative authority to arbitrarily take assets deposited into a pool",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <ProhibitedIcon />
                    <span className="text-sm text-zinc-300">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section aria-labelledby="wallet-roles-heading" className="mt-16">
          <h2 id="wallet-roles-heading" className="text-2xl font-semibold tracking-tight text-white">
            Wallet Roles
          </h2>

          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-5">
              <h3 className="text-sm font-semibold text-white">Normal user wallet</h3>
              <p className="mt-1 text-xs text-zinc-500">A normal user wallet can:</p>
              <ul className="mt-3 space-y-2 text-sm text-zinc-300">
                <li className="flex gap-2">
                  <Bullet />
                  Deploy CommunityPools
                </li>
                <li className="flex gap-2">
                  <Bullet />
                  Fund CommunityPools
                </li>
                <li className="flex gap-2">
                  <Bullet />
                  Withdraw assets according to the rules of the individual pool
                </li>
              </ul>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-5">
              <h3 className="text-sm font-semibold text-white">Admin wallet</h3>
              <p className="mt-1 text-xs text-zinc-500">The admin wallet can:</p>
              <ul className="mt-3 space-y-2 text-sm text-zinc-300">
                <li className="flex gap-2">
                  <Bullet />
                  Configure the protocol fee
                </li>
                <li className="flex gap-2">
                  <Bullet />
                  Configure the treasury address
                </li>
              </ul>
              <p className="mt-4 text-sm text-zinc-400">
                The admin wallet does <strong className="text-white">not</strong> have privileged
                access to assets held by CommunityPools.
              </p>
            </div>
          </div>
        </section>

        <section aria-labelledby="protocol-structure-heading" className="mt-16">
          <h2
            id="protocol-structure-heading"
            className="text-2xl font-semibold tracking-tight text-white"
          >
            Protocol Structure
          </h2>

          {/* Horizontally scrollable so the fixed-width diagram never breaks a narrow screen. */}
          <div className="mt-6 overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950/60 p-5">
            <pre
              className="font-mono text-xs leading-relaxed text-zinc-300 sm:text-sm"
              aria-label="Diagram: the admin wallet sets the fee and treasury address; user deposits go to the CommunityPool and the protocol fee goes to the treasury wallet."
            >
{`ADMIN WALLET
Controls protocol configuration
        │
        │  Sets fee between 0% and 3%
        │  Sets treasury address
        ↓
COMMUNITYPOOL PROTOCOL
        │
        ├── User deposit → CommunityPool
        │
        └── Protocol fee → Treasury
                            │
                            ↓
                    TREASURY WALLET
                  Receives protocol revenue`}
            </pre>
          </div>

          <div className="mt-6 rounded-xl border border-blue-500/40 bg-blue-500/5 p-5">
            <p className="text-base font-medium leading-relaxed text-white sm:text-lg">
              The CommunityPool admin can modify protocol pricing, but has no privileged ability to
              access assets deposited into CommunityPools.
            </p>
          </div>
        </section>

        <section aria-labelledby="fee-notes-heading" className="mt-16">
          <h2 id="fee-notes-heading" className="sr-only">
            Additional fee notes
          </h2>
          <ul className="space-y-2 text-sm text-zinc-500">
            <li>
              Pools created before the protocol fee went live run under their original contract and
              are not charged a protocol fee.
            </li>
            <li>
              On-chain transactions still require network gas, which is paid to the network in its
              native asset and is not collected by CommunityPool.
            </li>
          </ul>

          <div className="mt-8">
            <Link
              href="/signup"
              className="inline-flex items-center justify-center rounded-full bg-gradient-to-b from-blue-400 via-blue-500 to-blue-700 px-6 py-3 text-base font-medium text-white shadow-lg shadow-blue-500/30 hover:from-blue-300 hover:via-blue-400 hover:to-blue-600 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-black"
            >
              Get Started
            </Link>
          </div>
        </section>
      </main>
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

/** Green tick: an action protocol administration is allowed to take. */
function AllowedIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5"
      fill="currentColor"
      role="img"
      aria-label="Allowed"
    >
      <path
        fillRule="evenodd"
        d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.5 7.571a1 1 0 0 1-1.42.003l-3.5-3.5a1 1 0 1 1 1.414-1.414l2.79 2.79 6.796-6.858a1 1 0 0 1 1.414-.006Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/** Red cross: an action the contracts prevent, whoever holds the admin key. */
function ProhibitedIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-4 w-4 shrink-0 text-rose-400 mt-0.5"
      fill="currentColor"
      role="img"
      aria-label="Not permitted"
    >
      <path
        fillRule="evenodd"
        d="M5.28 4.22a1 1 0 0 0-1.06 1.06L8.94 10l-4.72 4.72a1 1 0 1 0 1.414 1.414L10.354 11.4l4.72 4.72a1 1 0 0 0 1.414-1.414L11.768 10l4.72-4.72a1 1 0 0 0-1.414-1.414l-4.72 4.72-4.72-4.72Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function Bullet() {
  return <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-blue-400" aria-hidden />;
}
