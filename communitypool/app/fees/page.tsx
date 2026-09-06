import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Fees | CommunityPool",
  description:
    "CommunityPool is free to sign up for and use. There are no monthly subscription fees. A 1% protocol fee is deducted from contributions when a CommunityPool is funded.",
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

          <div className="rounded-3xl p-[2px] bg-gradient-to-br from-blue-400 via-blue-500 to-blue-700 shadow-[0_0_40px_rgba(59,130,246,0.2)]">
            <div className="rounded-[calc(1.5rem-2px)] bg-zinc-950 p-8 sm:p-10 space-y-6 text-zinc-300">
              <p>
                You can create and manage CommunityPools without a subscription
                or monthly fee. There is no limit on how many pools you can
                deploy.
              </p>
              <p>
                CommunityPool charges a protocol fee when a CommunityPool is
                funded. The fee at launch is <strong className="text-white">1%</strong> of
                the amount being contributed.
              </p>
              <p>
                The fee is taken <strong className="text-white">out of</strong> the
                amount you fund — it is never added on top. Fund 1.00 PAXG and
                your wallet is debited 1.00 PAXG: 0.01 PAXG goes to the protocol
                treasury and 0.99 PAXG goes into the pool. The exact split is
                shown before you confirm a funding transaction.
              </p>
              <p>
                The fee lives in a contract on Ethereum, not in this website.
                The protocol administrator can change it, and any change is an
                on-chain transaction that takes effect for later contributions —
                but the contract enforces a hard maximum of{" "}
                <strong className="text-white">3%</strong> that no administrator
                can exceed.
              </p>
              <p>
                Being protocol administrator confers no power over your pool.
                The administrator cannot withdraw or move assets held by a
                CommunityPool, cannot change who owns a pool, and cannot bypass
                a pool&rsquo;s withdrawal permissions. Those rights belong to the
                pool&rsquo;s owner and co-owners alone.
              </p>
              <p>
                Pools created before the protocol fee went live continue to run
                under their original contract and are not charged a protocol
                fee.
              </p>
              <p>
                On-chain transactions still require network gas, which is paid
                to the network in its native asset and is not collected by
                CommunityPool.
              </p>
              <div className="h-px bg-zinc-800" />
              <ul className="space-y-3">
                <li className="flex items-start gap-3">
                  <CheckIcon />
                  <span className="text-sm">Free to create an account</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckIcon />
                  <span className="text-sm">Free to deploy CommunityPools</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckIcon />
                  <span className="text-sm">Unlimited CommunityPool deployments</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckIcon />
                  <span className="text-sm">No monthly subscription fees</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckIcon />
                  <span className="text-sm">
                    1% protocol fee on funding, deducted from the contribution
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckIcon />
                  <span className="text-sm">
                    Hard-capped at 3% in the contract; shown before you confirm
                  </span>
                </li>
              </ul>
              <div className="pt-2">
                <Link
                  href="/signup"
                  className="inline-flex items-center justify-center rounded-full bg-gradient-to-b from-blue-400 via-blue-500 to-blue-700 px-6 py-3 text-base font-medium text-white shadow-lg shadow-blue-500/30 hover:from-blue-300 hover:via-blue-400 hover:to-blue-600 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-black"
                >
                  Get Started
                </Link>
              </div>
            </div>
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
