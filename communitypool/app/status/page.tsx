import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Status | CommunityPool",
  description:
    "Live operational status for CommunityPool — frontend, database, RPC, price feed, and contract health.",
};

type Status = "operational" | "degraded" | "outage" | "maintenance";

type Component = {
  name: string;
  description: string;
  status: Status;
  link?: { label: string; href: string };
};

const COMPONENTS: Component[] = [
  {
    name: "Web app",
    description: "Dashboard, pool pages, and marketing site.",
    status: "operational",
  },
  {
    name: "Database (Supabase)",
    description: "Account data, saved addresses, pool metadata.",
    status: "operational",
  },
  {
    name: "Ethereum RPC (mainnet)",
    description:
      "Chain 1 provider used for on-chain reads, balance lookups, and transaction submission.",
    status: "operational",
  },
  {
    name: "Ethereum RPC (Sepolia)",
    description:
      "Chain 11155111 provider used for testnet reads, balance lookups, and transaction submission.",
    status: "operational",
  },
  {
    name: "Chainlink price feeds",
    description:
      "ETH/USD and configured ERC-20/USD aggregators used for USD-denominated minimums.",
    status: "operational",
  },
  {
    name: "CommunityPool contract",
    description:
      "Deployed pool contracts on Sepolia — reachable and processing transactions.",
    status: "operational",
    link: {
      label: "Contract reference",
      href: "/docs/contracts",
    },
  },
];

export default function StatusPage() {
  const overall = summarize(COMPONENTS);
  return (
    <div className="min-h-screen bg-black font-sans flex flex-col">
      <div
        className="fixed inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(59,130,246,0.12),transparent)] pointer-events-none"
        aria-hidden
      />
      <SiteHeader brandHref="/">
        <nav className="flex items-center gap-4">
          <Link
            href="/docs"
            className="text-sm font-medium text-zinc-400 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-black rounded px-3 py-2"
          >
            Docs
          </Link>
          <Link
            href="/pricing"
            className="text-sm font-medium text-zinc-400 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-black rounded px-3 py-2"
          >
            Pricing
          </Link>
          <Link
            href="/status"
            className="text-sm font-medium text-white transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-black rounded px-3 py-2"
          >
            Status
          </Link>
        </nav>
      </SiteHeader>

      <main className="relative flex-1 mx-auto w-full max-w-3xl px-4 py-12">
        <header className="mb-10">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            System status
          </p>
          <div className="flex items-center gap-3">
            <StatusDot status={overall.status} />
            <h1 className="text-3xl font-semibold tracking-tight text-white">
              {overall.label}
            </h1>
          </div>
          <p className="mt-2 text-sm text-zinc-500">
            Last updated {new Date().toISOString().slice(0, 10)} — this page is
            currently updated manually. Incident history and email
            subscriptions will move to an external provider (Instatus /
            BetterStack) before mainnet.
          </p>
        </header>

        <section
          aria-labelledby="components-heading"
          className="rounded-2xl border border-zinc-800 bg-zinc-950/80 overflow-hidden"
        >
          <h2
            id="components-heading"
            className="sr-only"
          >
            Components
          </h2>
          <ul>
            {COMPONENTS.map((component, idx) => (
              <li
                key={component.name}
                className={`flex items-start justify-between gap-4 px-5 py-4 ${
                  idx === 0 ? "" : "border-t border-zinc-900"
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <StatusDot status={component.status} />
                    <p className="font-medium text-white">{component.name}</p>
                  </div>
                  <p className="mt-1 text-sm text-zinc-400">
                    {component.description}
                  </p>
                  {component.link ? (
                    <Link
                      href={component.link.href}
                      className="mt-2 inline-block text-xs text-blue-400 hover:underline"
                    >
                      {component.link.label} →
                    </Link>
                  ) : null}
                </div>
                <span className="shrink-0 text-xs font-medium text-zinc-400 uppercase tracking-wider">
                  {statusLabel(component.status)}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section
          aria-labelledby="incidents-heading"
          className="mt-12"
        >
          <h2
            id="incidents-heading"
            className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-4"
          >
            Incident history
          </h2>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-6 text-sm text-zinc-400">
            No incidents reported. Pre-mainnet — incident history will be
            populated once the app is live on mainnet.
          </div>
        </section>

        <section className="mt-12 text-sm text-zinc-500">
          <p>
            Spotted something broken? Email{" "}
            <a
              href="mailto:support@communitypool.xyz"
              className="text-blue-400 hover:underline"
            >
              support@communitypool.xyz
            </a>{" "}
            with the pool address and transaction hash if you have them.
          </p>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

function summarize(components: Component[]): { status: Status; label: string } {
  if (components.some((c) => c.status === "outage")) {
    return { status: "outage", label: "Partial outage" };
  }
  if (components.some((c) => c.status === "degraded")) {
    return { status: "degraded", label: "Degraded performance" };
  }
  if (components.some((c) => c.status === "maintenance")) {
    return { status: "maintenance", label: "Under maintenance" };
  }
  return { status: "operational", label: "All systems operational" };
}

function statusLabel(status: Status): string {
  switch (status) {
    case "operational":
      return "Operational";
    case "degraded":
      return "Degraded";
    case "outage":
      return "Outage";
    case "maintenance":
      return "Maintenance";
  }
}

function StatusDot({ status }: { status: Status }) {
  const palette: Record<Status, string> = {
    operational: "bg-blue-400 shadow-[0_0_12px_rgba(96,165,250,0.6)]",
    degraded: "bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.6)]",
    outage: "bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.6)]",
    maintenance: "bg-blue-400 shadow-[0_0_12px_rgba(96,165,250,0.6)]",
  };
  return (
    <span
      aria-hidden
      className={`inline-block h-2.5 w-2.5 rounded-full ${palette[status]}`}
    />
  );
}
