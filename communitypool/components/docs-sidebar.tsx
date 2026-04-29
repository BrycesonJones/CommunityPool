"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type DocLink = { label: string; href: string };
type DocSection = { title: string; links: DocLink[] };

const SECTIONS: DocSection[] = [
  {
    title: "Overview",
    links: [
      { label: "Introduction", href: "/docs" },
      { label: "Quickstart", href: "/docs/quickstart" },
    ],
  },
  {
    title: "Concepts",
    links: [
      { label: "How pools work", href: "/docs/concepts/how-pools-work" },
      { label: "USD pricing & Chainlink", href: "/docs/concepts/usd-pricing" },
      { label: "Pool lifecycle", href: "/docs/concepts/pool-lifecycle" },
    ],
  },
  {
    title: "Smart Contracts",
    links: [
      { label: "CommunityPool.sol", href: "/docs/contracts" },
    ],
  },
  {
    title: "API (Pro)",
    links: [
      { label: "Overview", href: "/docs/api" },
      { label: "Authentication", href: "/docs/api/authentication" },
      { label: "Rate limits", href: "/docs/api/rate-limits" },
      { label: "Endpoints", href: "/docs/api/endpoints" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Changelog", href: "/docs/changelog" },
      { label: "Status", href: "/status" },
    ],
  },
];

export function DocsSidebar() {
  const pathname = usePathname();
  return (
    <nav aria-label="Docs navigation" className="text-sm">
      <ul className="space-y-8">
        {SECTIONS.map((section) => (
          <li key={section.title}>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              {section.title}
            </h3>
            <ul className="space-y-1">
              {section.links.map((link) => {
                const active = pathname === link.href;
                return (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className={`block rounded-md px-3 py-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-black ${
                        active
                          ? "bg-zinc-900 text-white"
                          : "text-zinc-400 hover:text-white hover:bg-zinc-900/50"
                      }`}
                      aria-current={active ? "page" : undefined}
                    >
                      {link.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  );
}
