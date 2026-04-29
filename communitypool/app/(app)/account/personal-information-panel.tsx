"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import {
  EMPTY_KYC_PROFILE,
  fetchKycStatus,
  isKycProfileComplete,
  upsertKycProfile,
  type KycProfile,
} from "@/lib/profile/kyc";

function pickEmail(user: User | null): string {
  return user?.email ?? "";
}

function formatAddressLines(profile: KycProfile): string[] {
  const lines: string[] = [];
  if (profile.fullName) lines.push(profile.fullName);
  if (profile.addressLine1) lines.push(profile.addressLine1);
  if (profile.addressLine2) lines.push(profile.addressLine2);
  const cityStateZip = [profile.city, profile.state, profile.postalCode]
    .filter(Boolean)
    .join(", ")
    .trim();
  const tail = [cityStateZip, profile.country].filter(Boolean).join(", ");
  if (tail) lines.push(tail);
  return lines;
}

type PersonalInformationPanelProps = {
  open: boolean;
  onClose: () => void;
};

export function PersonalInformationPanel({
  open,
  onClose,
}: PersonalInformationPanelProps) {
  const titleId = useId();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<KycProfile>(EMPTY_KYC_PROFILE);
  const [hydrated, setHydrated] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<"phone" | "name-address" | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const reloadProfile = useCallback(async (current: User | null) => {
    if (!current) {
      setProfile(EMPTY_KYC_PROFILE);
      setHydrated(true);
      return;
    }
    const supabase = createClient();
    try {
      const status = await fetchKycStatus(supabase, current);
      setProfile(status.profile);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load profile");
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const {
        data: { user: current },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      setUser(current);
      await reloadProfile(current);
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const next = session?.user ?? null;
      setUser(next);
      void reloadProfile(next);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [reloadProfile]);

  useEffect(() => {
    if (!open) {
      setEditing(null);
      return;
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    const focusTimer = window.setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 0);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  const email = useMemo(() => pickEmail(user), [user]);
  const phone = profile.phoneNumber;
  const fullName = profile.fullName;

  const handlePhoneSave = useCallback(
    async (next: string) => {
      if (!user) throw new Error("Not signed in.");
      const supabase = createClient();
      const updated: KycProfile = { ...profile, phoneNumber: next };
      await upsertKycProfile(supabase, user, updated);
      setProfile(updated);
    },
    [user, profile],
  );

  const handleNameAddressSave = useCallback(
    async (next: KycProfile) => {
      if (!user) throw new Error("Not signed in.");
      const supabase = createClient();
      // phoneNumber is owned by the phone editor; keep current value.
      const updated: KycProfile = { ...next, phoneNumber: profile.phoneNumber };
      await upsertKycProfile(supabase, user, updated);
      setProfile(updated);
    },
    [user, profile],
  );

  if (!open) return null;

  const addressLines = formatAddressLines(profile);
  const complete = isKycProfileComplete(profile);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <button
        type="button"
        aria-label="Close personal information"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm"
      />
      <div className="relative flex h-full w-full max-w-md flex-col bg-black text-white shadow-2xl">
        <header className="relative flex items-center justify-center px-6 pt-5 pb-6">
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute left-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-md text-zinc-300 transition-colors hover:bg-white/5 hover:text-white focus:outline-none focus:ring-2 focus:ring-brand-400"
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
              <path d="M6 6l12 12" />
              <path d="M18 6L6 18" />
            </svg>
          </button>
          <h2
            id={titleId}
            className="text-base font-semibold tracking-tight text-white"
          >
            Personal information
          </h2>
        </header>

        <div className="flex-1 overflow-y-auto px-4 pb-8">
          {hydrated && !complete && (
            <div className="mb-4 rounded-2xl border border-amber-700/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
              Complete your name, address, and phone number to deploy a CommunityPool.
            </div>
          )}
          {loadError && (
            <div
              role="alert"
              className="mb-4 rounded-2xl border border-red-700/50 bg-red-950/30 px-4 py-3 text-sm text-red-200"
            >
              {loadError}
            </div>
          )}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5 divide-y divide-zinc-800/80">
            <EmailRow value={hydrated ? email : "…"} />

            {editing === "phone" ? (
              <PhoneEditor
                initial={phone}
                onSave={handlePhoneSave}
                onClose={() => setEditing(null)}
              />
            ) : (
              <FieldRow
                label="Phone number"
                value={hydrated ? phone || "—" : "…"}
                onEdit={() => setEditing("phone")}
                editLabel="Edit phone number"
              />
            )}

            {editing === "name-address" ? (
              <NameAddressEditor
                initial={profile}
                onSave={handleNameAddressSave}
                onClose={() => setEditing(null)}
              />
            ) : (
              <FieldRow
                label="Name & address"
                value={
                  hydrated
                    ? addressLines.length > 0
                      ? addressLines.join("\n")
                      : "—"
                    : "…"
                }
                multiline
                onEdit={() => setEditing("name-address")}
                editLabel="Edit name and address"
              />
            )}

            <div className="pt-5">
              <button
                type="button"
                className="inline-flex rounded-full bg-zinc-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-black"
                onClick={() => {
                  window.alert(
                    "Account closure is not yet available. Contact support to close your account.",
                  );
                }}
              >
                Close your account
              </button>
            </div>
          </div>
          {hydrated && !fullName && !phone && (
            <p className="mt-3 px-1 text-xs text-zinc-500">
              Your information stays on CommunityPool and is only visible to you.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function EmailRow({ value }: { value: string }) {
  return (
    <div className="pb-5">
      <p className="text-sm font-semibold text-white">Email</p>
      <p className="mt-1 truncate text-sm text-zinc-400">{value}</p>
    </div>
  );
}

type FieldRowProps = {
  label: string;
  value: string;
  multiline?: boolean;
  onEdit: () => void;
  editLabel: string;
};

function FieldRow({
  label,
  value,
  multiline,
  onEdit,
  editLabel,
}: FieldRowProps) {
  return (
    <div className="flex items-start justify-between gap-4 py-5">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-white">{label}</p>
        {multiline ? (
          <p className="mt-1 whitespace-pre-line text-sm text-zinc-400">
            {value}
          </p>
        ) : (
          <p className="mt-1 truncate text-sm text-zinc-400">{value}</p>
        )}
      </div>
      <button
        type="button"
        aria-label={editLabel}
        onClick={onEdit}
        className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-md border border-zinc-800 bg-zinc-900/80 text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-black"
      >
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
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
        </svg>
      </button>
    </div>
  );
}

type PhoneEditorProps = {
  initial: string;
  onSave: (next: string) => Promise<void>;
  onClose: () => void;
};

function PhoneEditor({ initial, onSave, onClose }: PhoneEditorProps) {
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = draft.trim();
  const canSave = !saving && trimmed !== initial.trim();

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await onSave(trimmed);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="py-5 space-y-3">
      <label className="block text-sm font-semibold text-white">
        Phone number
      </label>
      <input
        type="tel"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={saving}
        placeholder="+1 (555) 555-5555"
        className="w-full rounded-2xl border border-zinc-700 bg-zinc-900/60 px-5 py-3 text-base text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-brand-400 disabled:opacity-60"
      />
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
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
  );
}

type NameAddressEditorProps = {
  initial: KycProfile;
  onSave: (next: KycProfile) => Promise<void>;
  onClose: () => void;
};

function NameAddressEditor({
  initial,
  onSave,
  onClose,
}: NameAddressEditorProps) {
  const [draft, setDraft] = useState<KycProfile>({ ...initial });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    draft.fullName.trim() !== initial.fullName.trim() ||
    draft.addressLine1.trim() !== initial.addressLine1.trim() ||
    draft.addressLine2.trim() !== initial.addressLine2.trim() ||
    draft.city.trim() !== initial.city.trim() ||
    draft.state.trim() !== initial.state.trim() ||
    draft.postalCode.trim() !== initial.postalCode.trim() ||
    draft.country.trim() !== initial.country.trim();

  const canSave = !saving && dirty && draft.fullName.trim().length > 0;

  function update<K extends keyof KycProfile>(key: K, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await onSave({
        ...draft,
        fullName: draft.fullName.trim(),
        addressLine1: draft.addressLine1.trim(),
        addressLine2: draft.addressLine2.trim(),
        city: draft.city.trim(),
        state: draft.state.trim(),
        postalCode: draft.postalCode.trim(),
        country: draft.country.trim(),
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="py-5 space-y-3">
      <label className="block text-sm font-semibold text-white">
        Name & address
      </label>
      <input
        type="text"
        value={draft.fullName}
        onChange={(e) => update("fullName", e.target.value)}
        disabled={saving}
        placeholder="Full name"
        aria-label="Full name"
        className="w-full rounded-2xl border border-zinc-700 bg-zinc-900/60 px-5 py-3 text-base text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-brand-400 disabled:opacity-60"
      />
      <input
        type="text"
        value={draft.addressLine1}
        onChange={(e) => update("addressLine1", e.target.value)}
        disabled={saving}
        placeholder="Street address"
        aria-label="Street address"
        className="w-full rounded-2xl border border-zinc-700 bg-zinc-900/60 px-5 py-3 text-base text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-brand-400 disabled:opacity-60"
      />
      <input
        type="text"
        value={draft.addressLine2}
        onChange={(e) => update("addressLine2", e.target.value)}
        disabled={saving}
        placeholder="Apt, suite, unit (optional)"
        aria-label="Address line 2"
        className="w-full rounded-2xl border border-zinc-700 bg-zinc-900/60 px-5 py-3 text-base text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-brand-400 disabled:opacity-60"
      />
      <div className="grid grid-cols-2 gap-3">
        <input
          type="text"
          value={draft.city}
          onChange={(e) => update("city", e.target.value)}
          disabled={saving}
          placeholder="City"
          aria-label="City"
          className="w-full rounded-2xl border border-zinc-700 bg-zinc-900/60 px-5 py-3 text-base text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-brand-400 disabled:opacity-60"
        />
        <input
          type="text"
          value={draft.state}
          onChange={(e) => update("state", e.target.value)}
          disabled={saving}
          placeholder="State"
          aria-label="State or region"
          className="w-full rounded-2xl border border-zinc-700 bg-zinc-900/60 px-5 py-3 text-base text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-brand-400 disabled:opacity-60"
        />
        <input
          type="text"
          value={draft.postalCode}
          onChange={(e) => update("postalCode", e.target.value)}
          disabled={saving}
          placeholder="ZIP / Postal code"
          aria-label="Postal code"
          className="w-full rounded-2xl border border-zinc-700 bg-zinc-900/60 px-5 py-3 text-base text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-brand-400 disabled:opacity-60"
        />
        <input
          type="text"
          value={draft.country}
          onChange={(e) => update("country", e.target.value)}
          disabled={saving}
          placeholder="Country"
          aria-label="Country"
          className="w-full rounded-2xl border border-zinc-700 bg-zinc-900/60 px-5 py-3 text-base text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-brand-400 disabled:opacity-60"
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
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
  );
}

export default PersonalInformationPanel;
