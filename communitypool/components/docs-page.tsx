import Link from "next/link";
import type { ReactNode } from "react";

export function DocsPage({
  eyebrow,
  title,
  lead,
  children,
  next,
}: {
  eyebrow?: string;
  title: string;
  lead?: string;
  children: ReactNode;
  next?: { label: string; href: string };
}) {
  return (
    <article className="prose-docs">
      <header className="mb-10">
        {eyebrow ? (
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-blue-400">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-white">
          {title}
        </h1>
        {lead ? (
          <p className="mt-4 text-lg text-zinc-400 leading-relaxed">{lead}</p>
        ) : null}
      </header>
      <div className="space-y-6 text-[15px] leading-relaxed text-zinc-300 [&_h2]:mt-12 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-white [&_h2]:tracking-tight [&_h3]:mt-8 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-white [&_p]:text-zinc-300 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:space-y-2 [&_li]:text-zinc-300 [&_code]:rounded [&_code]:bg-zinc-900 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[0.875em] [&_code]:text-blue-300 [&_a]:text-blue-400 [&_a]:underline-offset-4 hover:[&_a]:underline [&_strong]:text-white [&_strong]:font-semibold">
        {children}
      </div>
      {next ? (
        <div className="mt-16 border-t border-zinc-800 pt-8">
          <Link
            href={next.href}
            className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:border-zinc-700 hover:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-black"
          >
            Next: {next.label}
            <span aria-hidden>→</span>
          </Link>
        </div>
      ) : null}
    </article>
  );
}

export function CodeBlock({
  children,
  lang,
}: {
  children: string;
  lang?: string;
}) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950/80 p-4 text-[13px] leading-relaxed text-zinc-200">
      <code data-lang={lang}>{children}</code>
    </pre>
  );
}

export function Callout({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warn";
  title?: string;
  children: ReactNode;
}) {
  const palette =
    tone === "warn"
      ? "border-amber-500/30 bg-amber-500/5 text-amber-100"
      : "border-blue-500/30 bg-blue-500/5 text-blue-100";
  return (
    <aside
      className={`rounded-lg border px-4 py-3 text-sm ${palette}`}
      role="note"
    >
      {title ? <p className="mb-1 font-semibold">{title}</p> : null}
      <div className="[&_p]:text-inherit [&_code]:bg-black/30">{children}</div>
    </aside>
  );
}
