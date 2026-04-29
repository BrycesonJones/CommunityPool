"use client";

import { AccountProfileHub } from "./account-profile-hub";
import { WalletConnectButton } from "./wallet-connect-button";

/** Fixed wallet + account controls so we do not duplicate headers on every page. */
export function GlobalWalletBar() {
  return (
    <div
      className="pointer-events-none fixed right-4 top-4 z-50 sm:right-6 sm:top-6"
      aria-label="Account and wallet"
    >
      <div className="pointer-events-auto flex items-start gap-2">
        <WalletConnectButton />
        <AccountProfileHub />
      </div>
    </div>
  );
}
