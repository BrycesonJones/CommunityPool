"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient, getUserSerialized } from "@/lib/supabase/client";
import { useWallet } from "@/components/wallet-provider";
import { clearOpenPoolsFromStorage } from "@/lib/pools/open-pools-storage";

type ProfileMenuItem = {
  id: string;
  label: string;
  href: string;
};

const MENU_ITEMS: ProfileMenuItem[] = [
  { id: "account", label: "Account", href: "/account" },
  { id: "documents", label: "Documents", href: "/docs" },
  { id: "api-keys", label: "API Keys", href: "/api-keys" },
];

function pickFullName(user: User | null): string {
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const candidates = [
    meta.full_name,
    meta.fullName,
    meta.name,
    meta.display_name,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c.trim();
  }
  const first = typeof meta.first_name === "string" ? meta.first_name : "";
  const last = typeof meta.last_name === "string" ? meta.last_name : "";
  const combined = `${first} ${last}`.trim();
  if (combined) return combined;
  if (typeof meta.username === "string" && meta.username.trim()) {
    return meta.username.trim();
  }
  if (user?.email) return user.email.split("@")[0];
  return "Your account";
}

function pickUsername(user: User | null): string {
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  if (typeof meta.username === "string" && meta.username.trim()) {
    return meta.username.trim();
  }
  if (typeof meta.preferred_username === "string" && meta.preferred_username.trim()) {
    return meta.preferred_username.trim();
  }
  if (user?.email) return user.email;
  return "";
}

export function AccountProfileHub() {
  const router = useRouter();
  const panelId = useId();
  const { disconnectWallet } = useWallet();
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const firstMenuItemRef = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const current = await getUserSerialized(supabase);
      if (cancelled) return;
      setUser(current);
      setHydrated(true);
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      setHydrated(true);
      // OWASP A08 F-03: clear pool-list localStorage on every SIGNED_OUT,
      // not just the explicit logout button below. This catches session
      // expiry, cross-tab sign-outs, and force-logout-from-server flows.
      if (event === "SIGNED_OUT") {
        clearOpenPoolsFromStorage();
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    queueMicrotask(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    }
    function onPointerDown(e: MouseEvent | TouchEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      if (rootRef.current && !rootRef.current.contains(target)) {
        setOpen(false);
      }
    }

    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("touchstart", onPointerDown, { passive: true });

    const focusTimer = window.setTimeout(() => {
      firstMenuItemRef.current?.focus();
    }, 0);

    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("touchstart", onPointerDown);
      window.clearTimeout(focusTimer);
    };
  }, [open, close]);

  const fullName = useMemo(() => pickFullName(user), [user]);
  const username = useMemo(() => pickUsername(user), [user]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const handleCopyUsername = useCallback(() => {
    if (!username) return;
    void (async () => {
      try {
        await navigator.clipboard.writeText(username);
        setCopied(true);
        if (copyTimerRef.current !== null) {
          window.clearTimeout(copyTimerRef.current);
        }
        copyTimerRef.current = window.setTimeout(() => {
          setCopied(false);
          copyTimerRef.current = null;
        }, 1500);
      } catch {
        setCopied(false);
      }
    })();
  }, [username]);

  const handleLogout = useCallback(() => {
    void (async () => {
      if (signingOut) return;
      setSigningOut(true);
      try {
        // Drop wallet state BEFORE signOut so a stale browser-extension event
        // cannot rehydrate the previous user's wallet for the next Supabase
        // session on the same browser. `disconnectWallet` detaches EIP-1193
        // listeners, nulls the active-provider refs, and removes the
        // `communitypool_wallet_v1` localStorage entry.
        disconnectWallet();
        // OWASP A08 F-03: drop the cached pool list synchronously here so
        // there's no flash of User A's pools on a shared browser. The
        // SIGNED_OUT auth-state-change listener also clears as defence-
        // in-depth for non-button logout paths (session expiry, etc.).
        clearOpenPoolsFromStorage();
        const supabase = createClient();
        await supabase.auth.signOut();
      } finally {
        setSigningOut(false);
        setOpen(false);
        router.push("/");
        router.refresh();
      }
    })();
  }, [disconnectWallet, router, signingOut]);

  if (!hydrated || !user) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Open account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-white/5 hover:text-white focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-black"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5"
          aria-hidden
        >
          <circle cx="12" cy="8" r="3.5" />
          <path d="M4.5 20c1.4-3.6 4.3-5.5 7.5-5.5s6.1 1.9 7.5 5.5" />
        </svg>
      </button>

      {open ? (
        <div
          id={panelId}
          role="menu"
          aria-label="Account"
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-64 origin-top-right overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950/95 shadow-2xl backdrop-blur"
        >
          <div className="px-4 pb-3 pt-4">
            <p className="truncate text-sm font-semibold text-white">
              {fullName}
            </p>
            {username ? (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">Username</p>
                  <p className="mt-0.5 truncate font-mono text-xs text-zinc-400">
                    {username}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCopyUsername}
                  aria-label={copied ? "Username copied" : "Copy username"}
                  title={copied ? "Copied" : "Copy username"}
                  className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white/5 hover:text-white focus:outline-none focus:ring-2 focus:ring-brand-400"
                >
                  {copied ? (
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-4 w-4 text-emerald-400"
                      aria-hidden
                    >
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  ) : (
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-4 w-4"
                      aria-hidden
                    >
                      <rect x="9" y="9" width="11" height="11" rx="2" />
                      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
                    </svg>
                  )}
                </button>
              </div>
            ) : null}
          </div>

          <div className="h-px w-full bg-zinc-800/80" />

          <nav className="py-1" aria-label="Account actions">
            {MENU_ITEMS.map((item, index) => (
              <Link
                key={item.id}
                href={item.href}
                ref={index === 0 ? firstMenuItemRef : undefined}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center justify-between px-4 py-2.5 text-sm text-zinc-200 transition-colors hover:bg-white/5 hover:text-white focus:bg-white/5 focus:text-white focus:outline-none"
              >
                <span>{item.label}</span>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4 text-zinc-500"
                  aria-hidden
                >
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </Link>
            ))}
          </nav>

          <div className="h-px w-full bg-zinc-800/80" />

          <button
            type="button"
            role="menuitem"
            onClick={handleLogout}
            disabled={signingOut}
            className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-300 focus:bg-red-500/10 focus:text-red-300 focus:outline-none disabled:opacity-60"
          >
            <span>{signingOut ? "Logging out…" : "Log out"}</span>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
              aria-hidden
            >
              <path d="M15 17l5-5-5-5" />
              <path d="M20 12H9" />
              <path d="M12 19H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h7" />
            </svg>
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default AccountProfileHub;
