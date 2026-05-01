"use client";

import { useEffect, useMemo } from "react";
import { createClient, getUserSerialized } from "@/lib/supabase/client";

const USERJOT_PROJECT_ID = "cmolm6kyq004h0it9rtp9k4vt";
const SDK_SRC = "https://cdn.userjot.com/sdk/v2/uj.js";

type UjFn = (...args: unknown[]) => void;
type UjProxy = Record<string, UjFn>;

declare global {
  interface Window {
    $ujq?: unknown[];
    uj?: UjProxy;
  }
}

export function UserJotWidget() {
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (!window.uj) {
      const queue: unknown[] = (window.$ujq = window.$ujq ?? []);
      window.uj = new Proxy({} as UjProxy, {
        get:
          (_, prop: string) =>
          (...args: unknown[]) => {
            queue.push([prop, ...args]);
          },
      });

      if (!document.querySelector(`script[src="${SDK_SRC}"]`)) {
        const sdk = document.createElement("script");
        sdk.src = SDK_SRC;
        sdk.type = "module";
        sdk.async = true;
        document.head.appendChild(sdk);
      }

      window.uj.init(USERJOT_PROJECT_ID, {
        widget: true,
        position: "right",
        theme: "auto",
      });
    }

    let cancelled = false;
    void getUserSerialized(supabase).then((user) => {
      if (cancelled || !user?.id || !window.uj) return;
      const meta = (user.user_metadata ?? {}) as {
        full_name?: string;
        name?: string;
        given_name?: string;
        family_name?: string;
        avatar_url?: string;
      };
      const fullName = meta.full_name ?? meta.name ?? "";
      const [firstFromFull, ...restFromFull] = fullName.split(" ");
      window.uj.identify({
        id: user.id,
        email: user.email,
        firstName: meta.given_name ?? firstFromFull ?? "",
        lastName: meta.family_name ?? restFromFull.join(" "),
        avatar: meta.avatar_url ?? "",
      });
    });

    return () => {
      cancelled = true;
    };
  }, [supabase]);

  return null;
}
