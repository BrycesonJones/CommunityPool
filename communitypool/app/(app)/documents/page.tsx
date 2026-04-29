import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Documents | CommunityPool",
  description: "View and download account documents.",
};

export default function DocumentsPage() {
  return (
    <div className="min-h-screen bg-black font-sans">
      <div
        className="fixed inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(16,185,129,0.08),transparent)] pointer-events-none"
        aria-hidden
      />
      <SiteHeader brandHref="/" />
      <main className="relative mx-auto w-full max-w-3xl px-4 py-8">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-8 shadow-xl">
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            Documents
          </h1>
          <p className="mt-2 text-sm text-zinc-400">
            Statements, tax forms, and compliance documents will appear here.
          </p>
        </div>
      </main>
    </div>
  );
}
