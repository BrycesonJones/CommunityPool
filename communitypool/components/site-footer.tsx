const LINKS: { label: string; href: string }[] = [
  { label: "Docs", href: "/docs" },
  { label: "Status", href: "/status" },
  { label: "API Terms", href: "#" },
  { label: "Terms of Service", href: "/terms" },
  { label: "Privacy Notice", href: "/privacy" },
];

export function SiteFooter() {
  return (
    <footer className="relative z-10 w-full border-t border-white/5 bg-black/60">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-8 gap-y-2 px-4 py-6">
        <nav
          aria-label="Legal"
          className="flex flex-wrap items-center gap-x-8 gap-y-2"
        >
          {LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="text-sm text-zinc-500 transition-colors hover:text-white focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-black rounded"
            >
              {link.label}
            </a>
          ))}
        </nav>
        <span className="text-sm font-light text-white">CommunityPool</span>
      </div>
    </footer>
  );
}

export default SiteFooter;
