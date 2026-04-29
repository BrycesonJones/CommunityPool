"use client";

import { useMemo, useState } from "react";
import { useWallet } from "./wallet-provider";
import { WalletPicker } from "./wallet-picker";
import { expectedNetworkName } from "@/lib/wallet/expected-chain";

function truncateAddress(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function WalletConnectButton() {
  const {
    walletAddress,
    isConnected,
    isWalletDiscoveryComplete,
    availability,
    connectors,
    selectedWalletId,
    errorMessage,
    isWrongNetwork,
    connectedNetworkName,
    isConnecting,
    isSwitchingChain,
    disconnectWallet,
    switchToExpectedNetwork,
    clearError,
  } = useWallet();

  const [pickerOpen, setPickerOpen] = useState(false);

  const selectedConnectorName = useMemo(
    () =>
      selectedWalletId
        ? (connectors.find((c) => c.id === selectedWalletId)?.name ?? null)
        : null,
    [connectors, selectedWalletId],
  );

  const anyWalletAvailable = Object.values(availability).some(Boolean);

  if (!isWalletDiscoveryComplete) {
    return (
      <div
        className="h-10 w-[9.5rem] animate-pulse rounded-full bg-zinc-800/80"
        aria-hidden
      />
    );
  }

  return (
    <>
      <div className="flex flex-col items-end gap-2 text-right">
        {errorMessage ? (
          <div
            role="alert"
            className="max-w-[min(100vw-2rem,320px)] rounded-xl border border-red-900/60 bg-red-950/80 px-3 py-2 text-left text-xs text-red-200"
          >
            <p>{errorMessage}</p>
            <button
              type="button"
              onClick={clearError}
              className="mt-1 text-red-400 underline-offset-2 hover:underline"
            >
              Dismiss
            </button>
          </div>
        ) : null}

        {isConnected && isWrongNetwork ? (
          <div
            role="status"
            className="max-w-[min(100vw-2rem,320px)] rounded-xl border border-amber-900/60 bg-amber-950/80 px-3 py-2 text-left text-xs text-amber-100"
          >
            <p className="font-medium text-amber-50">Wrong network</p>
            <p className="mt-1 text-amber-200/90">
              You are on {connectedNetworkName ?? "an unsupported network"}.
              Switch to {expectedNetworkName} to use CommunityPool.
            </p>
            <button
              type="button"
              disabled={isSwitchingChain}
              onClick={() => void switchToExpectedNetwork()}
              className="mt-2 inline-flex w-full items-center justify-center rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-amber-400 disabled:opacity-50"
            >
              {isSwitchingChain
                ? "Switching…"
                : `Switch to ${expectedNetworkName}`}
            </button>
          </div>
        ) : null}

        {isConnected && walletAddress ? (
          <div className="flex flex-col items-end gap-2 rounded-2xl border border-zinc-800 bg-zinc-950/90 px-3 py-2 backdrop-blur">
            <div className="text-right">
              <p className="font-mono text-sm text-white">
                {truncateAddress(walletAddress)}
              </p>
              <p className="text-xs text-zinc-500">
                {selectedConnectorName ?? "Connected wallet"}
                {connectedNetworkName ? ` · ${connectedNetworkName}` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={disconnectWallet}
              className="text-xs font-medium text-zinc-400 hover:text-white focus:outline-none focus:ring-2 focus:ring-brand-400 rounded px-1"
            >
              Disconnect
            </button>
            <p className="max-w-[240px] text-left text-[11px] leading-snug text-zinc-600">
              This clears the app session only. The site may remain connected
              in {selectedConnectorName ?? "your wallet"} until you disconnect
              there.
            </p>
          </div>
        ) : (
          <button
            type="button"
            title="Connect a browser wallet"
            disabled={isConnecting}
            onClick={() => setPickerOpen(true)}
            className="inline-flex items-center justify-center rounded-full border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-100 hover:border-zinc-500 hover:text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-black"
          >
            {isConnecting ? "Connecting…" : "Connect wallet"}
          </button>
        )}

        {!isConnected && !anyWalletAvailable ? (
          <p className="max-w-[240px] text-[11px] leading-snug text-zinc-500">
            No supported wallet detected. Install MetaMask, Coinbase Wallet, or
            Binance Wallet and refresh.
          </p>
        ) : null}
      </div>

      <WalletPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
      />
    </>
  );
}
