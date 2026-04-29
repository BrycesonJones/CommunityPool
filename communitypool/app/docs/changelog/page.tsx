import type { Metadata } from "next";
import { DocsPage } from "@/components/docs-page";

export const metadata: Metadata = {
  title: "Changelog",
  description:
    "Release notes for CommunityPool — contract changes, dApp releases, and API updates.",
};

type Entry = {
  date: string;
  area: "Contract" | "dApp" | "API" | "Docs";
  title: string;
  body: string;
};

const ENTRIES: Entry[] = [
  {
    date: "2026-04-23",
    area: "Docs",
    title: "Docs site launched",
    body: "Initial docs covering concepts, smart-contract reference, and the Pro API surface. Status page also online.",
  },
  {
    date: "2026-04-21",
    area: "Contract",
    title: "Partial withdraws added",
    body: "CommunityPool.sol gained withdraw(amount) and withdrawTokenAmount(token, amount). Pools deployed before this date expose only the full-balance variants. The dashboard auto-detects this via poolSupportsPartialWithdraw against the deployed bytecode; the canonical ABI is in lib/onchain/community-pool-artifact.json (verified byte-for-byte against forge-out in CI).",
  },
];

export default function ChangelogPage() {
  return (
    <DocsPage
      eyebrow="Resources"
      title="Changelog"
      lead="Dated release notes for the contract, dApp, and API. Pre-mainnet: expect breaking changes; we will call them out here."
    >
      <ul className="not-prose space-y-6">
        {ENTRIES.map((entry) => (
          <li
            key={entry.date + entry.title}
            className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-5"
          >
            <div className="mb-2 flex flex-wrap items-center gap-3 text-xs">
              <time className="font-mono text-zinc-500">{entry.date}</time>
              <span className="rounded-full border border-zinc-800 px-2 py-0.5 text-zinc-400">
                {entry.area}
              </span>
            </div>
            <h3 className="mb-1 text-base font-semibold text-white">
              {entry.title}
            </h3>
            <p className="text-sm text-zinc-400 leading-relaxed">
              {entry.body}
            </p>
          </li>
        ))}
      </ul>
    </DocsPage>
  );
}
