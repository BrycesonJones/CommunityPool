import type {
  Eip1193Provider,
  Eip6963ProviderInfo,
  WalletId,
} from "./types";

export type WalletConnector = {
  id: WalletId;
  /** Human-readable name shown in the wallet picker. */
  name: string;
  /** Short marketing blurb / tagline shown in the picker. */
  tagline: string;
  /** EIP-6963 reverse-DNS id the wallet announces with. */
  rdns: readonly string[];
  /** URL to install the wallet extension if not detected. */
  installUrl: string;
  /**
   * Predicate that decides if an injected EIP-1193 provider is this wallet.
   * The EIP-6963 info is passed when available so we can match by `rdns`.
   */
  matches: (
    provider: Eip1193Provider,
    info?: Eip6963ProviderInfo,
  ) => boolean;
  /**
   * Well-known wallet-specific global(s). Used when EIP-6963 discovery
   * is unavailable (older extensions, Binance in-app browser, etc).
   */
  windowGlobals: (win: Window) => Eip1193Provider[];
};

function notOtherWallets(p: Eip1193Provider): boolean {
  return (
    !p.isCoinbaseWallet &&
    !p.isCoinbaseBrowser &&
    !p.isBinance &&
    !p.isBraveWallet &&
    !p.isTrust &&
    !p.isTrustWallet &&
    !p.isPhantom &&
    !p.isRabby
  );
}

export const WALLET_CONNECTORS: readonly WalletConnector[] = [
  {
    id: "metamask",
    name: "MetaMask",
    tagline: "Browser extension wallet",
    rdns: ["io.metamask", "io.metamask.mobile"],
    installUrl: "https://metamask.io/download/",
    matches: (p, info) => {
      if (info?.rdns === "io.metamask" || info?.rdns === "io.metamask.mobile") {
        return true;
      }
      return p.isMetaMask === true && notOtherWallets(p);
    },
    windowGlobals: (win) => {
      const found: Eip1193Provider[] = [];
      const root = win.ethereum;
      if (!root) return found;
      const list = root.providers?.length ? root.providers : [root];
      for (const p of list) {
        if (p.isMetaMask === true && notOtherWallets(p)) found.push(p);
      }
      return found;
    },
  },
  {
    id: "coinbase",
    name: "Coinbase Wallet",
    tagline: "Self-custody wallet from Coinbase",
    rdns: ["com.coinbase.wallet"],
    installUrl: "https://www.coinbase.com/wallet/downloads",
    matches: (p, info) => {
      if (info?.rdns === "com.coinbase.wallet") return true;
      return p.isCoinbaseWallet === true || p.isCoinbaseBrowser === true;
    },
    windowGlobals: (win) => {
      const found: Eip1193Provider[] = [];
      if (win.coinbaseWalletExtension) found.push(win.coinbaseWalletExtension);
      const root = win.ethereum;
      if (root) {
        const list = root.providers?.length ? root.providers : [root];
        for (const p of list) {
          if (p.isCoinbaseWallet === true || p.isCoinbaseBrowser === true) {
            found.push(p);
          }
        }
      }
      return found;
    },
  },
  {
    id: "binance",
    name: "Binance Wallet",
    tagline: "Binance Web3 Wallet",
    // Binance Web3 Wallet announces under `com.binance.wallet` via EIP-6963,
    // but also exposes `window.binancew3w.ethereum` per the dev docs.
    rdns: ["com.binance.wallet", "com.binance.web3wallet"],
    installUrl: "https://www.binance.com/en/web3wallet",
    matches: (p, info) => {
      if (info?.rdns && info.rdns.startsWith("com.binance")) return true;
      return p.isBinance === true;
    },
    windowGlobals: (win) => {
      const found: Eip1193Provider[] = [];
      const binance = win.binancew3w?.ethereum;
      if (binance) found.push(binance);
      const root = win.ethereum;
      if (root?.isBinance === true) found.push(root);
      const list = root?.providers ?? [];
      for (const p of list) {
        if (p.isBinance === true) found.push(p);
      }
      return found;
    },
  },
] as const;

export function getConnector(id: WalletId): WalletConnector {
  const c = WALLET_CONNECTORS.find((w) => w.id === id);
  if (!c) throw new Error(`Unknown wallet connector: ${id}`);
  return c;
}
