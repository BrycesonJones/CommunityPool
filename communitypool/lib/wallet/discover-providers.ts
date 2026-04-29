import { WALLET_CONNECTORS, type WalletConnector } from "./connectors";
import type {
  Eip1193Provider,
  Eip6963AnnounceDetail,
  WalletId,
} from "./types";

/** Map of `walletId` -> resolved EIP-1193 provider (only present when detected). */
export type DiscoveredWallets = Partial<Record<WalletId, Eip1193Provider>>;

function dedupeFirstUnique(
  candidates: Iterable<Eip1193Provider>,
): Eip1193Provider | null {
  for (const p of candidates) {
    if (p && typeof p.request === "function") return p;
  }
  return null;
}

function matchFromAnnounces(
  connector: WalletConnector,
  announced: Eip6963AnnounceDetail[],
): Eip1193Provider | null {
  for (const detail of announced) {
    if (connector.matches(detail.provider, detail.info)) {
      return detail.provider;
    }
  }
  return null;
}

function matchFromWindow(
  connector: WalletConnector,
): Eip1193Provider | null {
  if (typeof window === "undefined") return null;
  return dedupeFirstUnique(connector.windowGlobals(window));
}

/**
 * Resolve an EIP-1193 provider for a specific wallet id.
 * EIP-6963 announcements take priority; falls back to wallet-specific window globals.
 *
 * Safe to call in the browser; no-ops during SSR (returns `null`).
 */
export async function discoverProviderById(
  walletId: WalletId,
  announceWaitMs = 320,
): Promise<Eip1193Provider | null> {
  if (typeof window === "undefined") return null;
  const wallets = await discoverAllWallets(announceWaitMs);
  return wallets[walletId] ?? null;
}

/**
 * Discover all supported wallets via EIP-6963, then backfill with window globals.
 * Resolves with a map of `walletId -> provider` for every detected wallet.
 *
 * Safe to call in the browser; returns `{}` during SSR.
 */
export function discoverAllWallets(
  announceWaitMs = 320,
): Promise<DiscoveredWallets> {
  if (typeof window === "undefined") return Promise.resolve({});

  return new Promise((resolve) => {
    const announced: Eip6963AnnounceDetail[] = [];

    const onAnnounce = (event: Event) => {
      const custom = event as CustomEvent<Eip6963AnnounceDetail>;
      const p = custom.detail?.provider;
      if (p && typeof p.request === "function") {
        announced.push(custom.detail);
      }
    };

    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    const finish = () => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);

      const result: DiscoveredWallets = {};
      for (const connector of WALLET_CONNECTORS) {
        const viaAnnounce = matchFromAnnounces(connector, announced);
        const provider = viaAnnounce ?? matchFromWindow(connector);
        if (provider) result[connector.id] = provider;
      }
      resolve(result);
    };

    window.setTimeout(finish, announceWaitMs);
  });
}

/**
 * Back-compat: pre-refactor code called `discoverMetaMaskProvider()` directly.
 * Retained so external callers keep working during the multi-wallet migration.
 *
 * @deprecated Use {@link discoverProviderById} with a specific `walletId`.
 */
export function discoverMetaMaskProvider(
  announceWaitMs = 320,
): Promise<Eip1193Provider | null> {
  return discoverProviderById("metamask", announceWaitMs);
}
