import Link from "next/link";

export function SiteHeader({
  children,
  brandHref,
}: {
  children?: React.ReactNode;
  brandHref?: string;
}) {
  const brand = "CommunityPool";
  return (
    <header className="sticky top-0 z-40 w-full border-b border-white/5 bg-black/60 backdrop-blur-md">
      <div className="relative flex items-center justify-between px-4 py-4 max-w-6xl mx-auto w-full">
        {brandHref ? (
          <Link
            href={brandHref}
            className="text-xl font-light text-white focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-black rounded"
          >
            {brand}
          </Link>
        ) : (
          <span className="text-xl font-light text-white">{brand}</span>
        )}
        {children}
      </div>
    </header>
  );
}
