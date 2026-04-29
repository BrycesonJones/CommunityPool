"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { PersonalInformationPanel } from "./personal-information-panel";

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
  return "—";
}

function pickUsername(user: User | null): string {
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  if (typeof meta.username === "string" && meta.username.trim()) {
    return meta.username.trim();
  }
  if (
    typeof meta.preferred_username === "string" &&
    meta.preferred_username.trim()
  ) {
    return meta.preferred_username.trim();
  }
  if (user?.email) return user.email;
  return "—";
}

export function AccountProfileCard() {
  const searchParams = useSearchParams();
  const [user, setUser] = useState<User | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [personalInfoOpen, setPersonalInfoOpen] = useState(false);

  useEffect(() => {
    if (searchParams?.get("personal") === "open") {
      // URL-driven modal open — intentional one-shot state sync from the query string.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPersonalInfoOpen(true);
    }
  }, [searchParams]);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const {
        data: { user: current },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      setUser(current);
      setHydrated(true);
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setHydrated(true);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const fullName = useMemo(() => pickFullName(user), [user]);
  const username = useMemo(() => pickUsername(user), [user]);

  return (
    <section
      aria-label="Profile"
      className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-6 shadow-xl"
    >
      <header className="flex items-center gap-3 pb-6">
        <span
          aria-hidden
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/80"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5 text-white"
          >
            <circle cx="12" cy="8" r="3.5" />
            <path d="M4.5 20c1.4-3.6 4.3-5.5 7.5-5.5s6.1 1.9 7.5 5.5" />
          </svg>
        </span>
        <h2 className="text-lg font-semibold text-white">Profile</h2>
      </header>

      <div className="divide-y divide-zinc-800/80">
        <UsernameRow username={username} hydrated={hydrated} />
        <ProfileRow
          label="Personal information"
          value={hydrated ? fullName : "…"}
          onActivate={() => setPersonalInfoOpen(true)}
          trailingIcon={
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
              <path d="M9 6l6 6-6 6" />
            </svg>
          }
          trailingLabel="Open personal information"
        />
      </div>

      <PersonalInformationPanel
        open={personalInfoOpen}
        onClose={() => setPersonalInfoOpen(false)}
      />
    </section>
  );
}

type ProfileRowProps = {
  label: string;
  value: string;
  trailingIcon: React.ReactNode;
  trailingLabel: string;
  onActivate?: () => void;
};

function ProfileRow({
  label,
  value,
  trailingIcon,
  trailingLabel,
  onActivate,
}: ProfileRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 py-5">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-white">{label}</p>
        <p className="mt-1 truncate text-sm text-zinc-500">{value}</p>
      </div>
      <button
        type="button"
        aria-label={trailingLabel}
        onClick={onActivate}
        className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/80 text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-black"
      >
        {trailingIcon}
      </button>
    </div>
  );
}

function UsernameRow({
  username,
  hydrated,
}: {
  username: string;
  hydrated: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState(username);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Reset the draft to the persisted username whenever the editor closes
    // or the upstream username changes — keeps the draft in sync with the
    // source of truth without lifting state out of the dialog.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!isOpen) setDraft(username);
  }, [username, isOpen]);

  const trimmed = draft.trim();
  const canSave =
    !saving && trimmed.length > 0 && trimmed !== username.trim();

  async function handleSave() {
    setSaving(true);
    setError(null);
    // Route through the server so the same `USERNAME_RE` we apply at sign-up
    // also applies to post-login edits. Calling `supabase.auth.updateUser`
    // from the browser would let us write arbitrary UTF-8 into metadata.
    let updateError: Error | null = null;
    try {
      const res = await fetch("/api/auth/profile/username", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: trimmed }),
      });
      if (!res.ok) {
        let message = "Unable to update username";
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) message = body.error;
        } catch {
          /* keep default message */
        }
        updateError = new Error(message);
      } else {
        // Refresh the cached client-side User so the row label updates without
        // a navigation. `getUser()` round-trips to GoTrue and picks up the
        // freshly-merged user_metadata.
        const supabase = createClient();
        await supabase.auth.getUser();
      }
    } catch (e) {
      updateError = e instanceof Error ? e : new Error("Network error");
    }
    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setIsOpen(false);
  }

  function handleCancel() {
    setDraft(username);
    setError(null);
    setIsOpen(false);
  }

  return (
    <div className="py-5">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">Username</p>
          <p className="mt-1 truncate text-sm text-zinc-500">
            {hydrated ? username : "…"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsOpen((v) => !v)}
          aria-label={isOpen ? "Close username editor" : "Edit username"}
          aria-expanded={isOpen}
          className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/80 text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-black"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
            aria-hidden
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </div>
      {isOpen && (
        <div className="mt-4 space-y-3">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={saving}
            aria-label="New username"
            className="w-full rounded-2xl border border-zinc-700 bg-zinc-900/60 px-5 py-4 text-base text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-brand-400 disabled:opacity-60"
          />
          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleCancel}
              disabled={saving}
              className="inline-flex rounded-full bg-zinc-800 px-5 py-2 text-sm font-medium text-white hover:bg-zinc-700 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-black disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave}
              className="inline-flex rounded-full bg-white px-5 py-2 text-sm font-medium text-black hover:bg-zinc-200 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-black disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default AccountProfileCard;
