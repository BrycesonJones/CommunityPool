import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./database.types";

/**
 * Path prefixes that require an authenticated Supabase session. A request that
 * matches any prefix exactly, or starts with `<prefix>/`, redirects to
 * `/login?next=<requested-path>` when no user is present. The `(app)` layout
 * also re-checks `getUser()` as defense-in-depth — middleware preserves the
 * `next` param so the layout backstop only needs to send to `/login`.
 *
 * Keep this list in sync with the `(app)` route group. New protected pages
 * inside `(app)` are covered automatically by the layout gate even if this
 * list is stale, but only middleware can preserve `next` cleanly.
 */
const PROTECTED_PREFIXES: readonly string[] = [
  "/dashboard",
  "/account",
  "/pools",
  "/api-keys",
  "/documents",
];

async function hashIdentifier(value: string | null | undefined): Promise<string | undefined> {
  if (!value) return undefined;
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

function isProtectedPath(pathname: string): boolean {
  for (const prefix of PROTECTED_PREFIXES) {
    if (pathname === prefix) return true;
    if (pathname.startsWith(`${prefix}/`)) return true;
  }
  return false;
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    const protectedPath = isProtectedPath(request.nextUrl.pathname);
    if (protectedPath && process.env.NODE_ENV === "production") {
      console.error("[auth][critical] middleware auth unavailable");
      return new NextResponse("Authentication service unavailable.", {
        status: 503,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }
    return supabaseResponse;
  }

  const supabase = createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        supabaseResponse = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && isProtectedPath(request.nextUrl.pathname)) {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const userAgent = request.headers.get("user-agent");
    console.warn(
      JSON.stringify({
        event_type: "access.protected_route_denied",
        severity: "medium",
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV ?? "unknown",
        route: request.nextUrl.pathname,
        method: request.method,
        status_code: 307,
        request_id:
          request.headers.get("x-request-id") ??
          request.headers.get("x-correlation-id") ??
          undefined,
        ip_hash: await hashIdentifier(ip),
        user_agent_hash: await hashIdentifier(userAgent),
      }),
    );
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(redirectUrl);
  }

  return supabaseResponse;
}
