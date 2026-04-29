import { redirect } from "next/navigation";
import { GlobalWalletBar } from "@/components/global-wallet-bar";
import { SiteFooter } from "@/components/site-footer";
import { createClient } from "@/lib/supabase/server";

/**
 * Server-side auth gate for every page under the `(app)` route group
 * (`/dashboard`, `/account`, `/pools`, `/api-keys`, `/documents`, …).
 *
 * Middleware in `lib/supabase/middleware.ts` is the primary line of defense
 * and is the only place that can preserve `?next=<requested-path>` cleanly.
 * This layout exists as a defense-in-depth backstop: if the matcher list is
 * ever edited or a future protected prefix slips out of it, the layout still
 * refuses to render authenticated UI to an anonymous user. We send to plain
 * `/login` here because the request URL is not available to a server layout —
 * preserving `next` would require reading a middleware-set header, which is
 * brittle. Middleware handles the happy path; this is the safety net.
 */
export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  return (
    <>
      <GlobalWalletBar />
      {children}
      <SiteFooter />
    </>
  );
}
