/** EIP-6963 announce payload (https://eips.ethereum.org/EIPS/eip-6963) */
export type Eip6963ProviderInfo = {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
};

export type Eip6963AnnounceDetail = {
  info: Eip6963ProviderInfo;
  provider: Eip1193Provider;
};

/**
 * Minimal EIP-1193 surface used by the app's browser wallets and
 * ethers' `BrowserProvider`. All currently supported wallets
 * (MetaMask, Coinbase Wallet, Binance Web3 Wallet) expose this API.
 */
export type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on(event: string, handler: (...args: unknown[]) => void): void;
  removeListener(event: string, handler: (...args: unknown[]) => void): void;
  /** Vendor discovery flags (best-effort; never rely on just one). */
  isMetaMask?: boolean;
  isCoinbaseWallet?: boolean;
  isCoinbaseBrowser?: boolean;
  isBinance?: boolean;
  isBraveWallet?: boolean;
  isTrust?: boolean;
  isTrustWallet?: boolean;
  isRabby?: boolean;
  isPhantom?: boolean;
  /** Injected multi-wallet setups (e.g. MetaMask + Coinbase both hooking `window.ethereum`). */
  providers?: Eip1193Provider[];
};

/** Supported browser wallet ids. Add new entries to the connector registry, not to this type alone. */
export type WalletId = "metamask" | "coinbase" | "binance";

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
    /** Coinbase Wallet browser extension namespace (legacy fallback). */
    coinbaseWalletExtension?: Eip1193Provider;
    /** Binance Web3 Wallet namespace, per Binance dev docs. */
    binancew3w?: {
      ethereum?: Eip1193Provider;
    };
  }
}
