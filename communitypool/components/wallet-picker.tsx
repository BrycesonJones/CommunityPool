"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useWallet } from "./wallet-provider";
import type { WalletId } from "@/lib/wallet/types";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function WalletPicker({ open, onClose }: Props) {
  const {
    connectors,
    availability,
    isWalletDiscoveryComplete,
    isConnecting,
    connectWallet,
  } = useWallet();

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function onPick(walletId: WalletId) {
    await connectWallet(walletId);
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Choose a wallet"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">
            Connect a wallet
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-zinc-400 hover:text-white focus:outline-none focus:ring-2 focus:ring-brand-400 rounded px-1"
            aria-label="Close wallet picker"
          >
            ✕
          </button>
        </div>

        <ul className="space-y-2">
          {connectors.map((c) => {
            const installed = availability[c.id];
            return (
              <li key={c.id}>
                {installed ? (
                  <button
                    type="button"
                    disabled={isConnecting || !isWalletDiscoveryComplete}
                    onClick={() => void onPick(c.id)}
                    className="flex w-full items-center justify-between rounded-xl px-4 py-3 text-left disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-brand-400"
                  >
                    <div>
                      <p className="text-sm font-medium text-white">
                        {c.name}
                      </p>
                      <p className="text-xs text-zinc-500">{c.tagline}</p>
                    </div>
                    <span className="rounded-full bg-brand-500/15 px-2 py-0.5 text-[10px] font-medium text-brand-200">
                      Detected
                    </span>
                  </button>
                ) : (
                  <div className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-zinc-300">
                        {c.name}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {isWalletDiscoveryComplete
                          ? "Not detected in this browser"
                          : "Detecting…"}
                      </p>
                    </div>
                    <Link
                      href={c.installUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-200 hover:border-brand-400/60 hover:text-white focus:outline-none focus:ring-2 focus:ring-brand-400"
                    >
                      Install
                    </Link>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        <p className="mt-4 text-[11px] leading-snug text-zinc-600">
          CommunityPool connects directly to your browser wallet over EIP-1193.
          We never see or store your keys.
        </p>
      </div>
    </div>
  );
}
