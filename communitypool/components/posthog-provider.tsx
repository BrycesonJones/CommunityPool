"use client";

import { Suspense, useEffect, useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { PostHogProvider as PostHogReactProvider } from "posthog-js/react";
import { createClient, getUserSerialized } from "@/lib/supabase/client";

const posthogToken = process.env.NEXT_PUBLIC_POSTHOG_TOKEN;
const posthogDisabled = process.env.NEXT_PUBLIC_POSTHOG_DISABLED === "true";
const posthogEnabled = Boolean(posthogToken) && !posthogDisabled;

function PostHogPageviewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();

  useEffect(() => {
    if (!posthogEnabled || !pathname) return;
    posthog.capture("$pageview", {
      $current_url: window.location.href,
    });
  }, [pathname, queryString]);

  return null;
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    if (!posthogEnabled) return;

    let cancelled = false;
    void getUserSerialized(supabase).then((user) => {
      if (cancelled || !user?.id) return;
      posthog.identify(user.id, { email: user.email });
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user;
      if (user?.id) {
        posthog.identify(user.id, { email: user.email });
        return;
      }
      posthog.reset();
    });

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  return (
    <PostHogReactProvider client={posthog}>
      <Suspense fallback={null}>
        <PostHogPageviewTracker />
      </Suspense>
      {children}
    </PostHogReactProvider>
  );
}
