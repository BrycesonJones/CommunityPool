import type { WalletId } from "./types";

const STORAGE_KEY = "communitypool_wallet_v1";

export type PersistedWalletState = {
  connected: boolean;
  walletId?: WalletId;
  walletAddress?: string;
  chainId?: string;
};

const KNOWN_WALLET_IDS: readonly WalletId[] = [
  "metamask",
  "coinbase",
  "binance",
];

function isWalletId(value: unknown): value is WalletId {
  return (
    typeof value === "string" &&
    (KNOWN_WALLET_IDS as readonly string[]).includes(value)
  );
}

export function loadPersistedWallet(): PersistedWalletState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedWalletState;
    if (typeof parsed.connected !== "boolean") return null;
    return {
      connected: parsed.connected,
      walletId: isWalletId(parsed.walletId) ? parsed.walletId : undefined,
      walletAddress:
        typeof parsed.walletAddress === "string"
          ? parsed.walletAddress
          : undefined,
      chainId:
        typeof parsed.chainId === "string" ? parsed.chainId : undefined,
    };
  } catch {
    return null;
  }
}

export function savePersistedWallet(state: PersistedWalletState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota / private mode */
  }
}

export function clearPersistedWallet(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
