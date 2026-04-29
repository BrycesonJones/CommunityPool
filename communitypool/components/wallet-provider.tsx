"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { BrowserProvider, type JsonRpcSigner } from "ethers";
import {
  WALLET_CONNECTORS,
  getConnector,
  type WalletConnector,
} from "@/lib/wallet/connectors";
import {
  discoverAllWallets,
  discoverProviderById,
  type DiscoveredWallets,
} from "@/lib/wallet/discover-providers";
import {
  expectedChainId,
  networkLabelForChainId,
} from "@/lib/wallet/expected-chain";
import { messageForProviderError } from "@/lib/wallet/metamask-errors";
import {
  clearPersistedWallet,
  loadPersistedWallet,
  savePersistedWallet,
} from "@/lib/wallet/storage";
import { switchToExpectedChain } from "@/lib/wallet/switch-chain";
import type { Eip1193Provider, WalletId } from "@/lib/wallet/types";

export type WalletAvailability = Record<WalletId, boolean>;

export type WalletContextValue = {
  walletAddress: string | null;
  isConnected: boolean;
  provider: BrowserProvider | null;
  signer: JsonRpcSigner | null;
  chainId: bigint | null;
  /** Wallet currently connected to the app, or `null` when disconnected. */
  selectedWalletId: WalletId | null;
  /** Available browser wallet connectors the UI can render. */
  connectors: readonly WalletConnector[];
  /** Which wallets were detected by EIP-6963 / window globals. */
  availability: WalletAvailability;
  /** False until the first EIP-6963 / window.ethereum discovery pass finishes. */
  isWalletDiscoveryComplete: boolean;
  errorMessage: string | null;
  isWrongNetwork: boolean;
  connectedNetworkName: string | null;
  isConnecting: boolean;
  isSwitchingChain: boolean;
  /** Connect a specific wallet by id (opens its popup). */
  connectWallet: (walletId: WalletId) => Promise<void>;
  disconnectWallet: () => void;
  switchToExpectedNetwork: () => Promise<void>;
  clearError: () => void;
};

const WalletContext = createContext<WalletContextValue | null>(null);

const EMPTY_AVAILABILITY: WalletAvailability = {
  metamask: false,
  coinbase: false,
  binance: false,
};

type Hydrated = {
  address: string;
  browserProvider: BrowserProvider;
  signer: JsonRpcSigner;
  chainId: bigint;
};

async function hydrateFromEip1193(
  eip1193: Eip1193Provider,
): Promise<Hydrated | null> {
  const accounts = (await eip1193.request({
    method: "eth_accounts",
  })) as string[];
  if (!accounts.length) return null;
  const address = accounts[0];
  const browserProvider = new BrowserProvider(eip1193);
  const network = await browserProvider.getNetwork();
  const signer = await browserProvider.getSigner();
  return {
    address,
    browserProvider,
    signer,
    chainId: network.chainId,
  };
}

function availabilityFromDiscovery(
  discovered: DiscoveredWallets,
): WalletAvailability {
  return {
    metamask: discovered.metamask != null,
    coinbase: discovered.coinbase != null,
    binance: discovered.binance != null,
  };
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [signer, setSigner] = useState<JsonRpcSigner | null>(null);
  const [chainId, setChainId] = useState<bigint | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [selectedWalletId, setSelectedWalletId] = useState<WalletId | null>(
    null,
  );
  const [availability, setAvailability] =
    useState<WalletAvailability>(EMPTY_AVAILABILITY);
  const [isWalletDiscoveryComplete, setIsWalletDiscoveryComplete] =
    useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSwitchingChain, setIsSwitchingChain] = useState(false);

  // The EIP-1193 provider + walletId currently attached for event listening.
  // Kept in a ref so the listener effect doesn't need to re-run on every state change.
  const activeProviderRef = useRef<Eip1193Provider | null>(null);
  const activeWalletIdRef = useRef<WalletId | null>(null);
  const discoveredRef = useRef<DiscoveredWallets>({});

  const applyHydrated = useCallback(
    (walletId: WalletId, h: Hydrated) => {
      setWalletAddress(h.address);
      setProvider(h.browserProvider);
      setSigner(h.signer);
      setChainId(h.chainId);
      setIsConnected(true);
      setSelectedWalletId(walletId);
      savePersistedWallet({
        connected: true,
        walletId,
        walletAddress: h.address,
        chainId: h.chainId.toString(),
      });
    },
    [],
  );

  const clearWalletState = useCallback(() => {
    setWalletAddress(null);
    setProvider(null);
    setSigner(null);
    setChainId(null);
    setIsConnected(false);
    setSelectedWalletId(null);
    clearPersistedWallet();
  }, []);

  const clearError = useCallback(() => setErrorMessage(null), []);

  // Ref-wrapped "latest" versions of the callbacks for use inside listeners
  // registered from the long-lived discovery effect below.
  const handlersRef = useRef({
    applyHydrated,
    clearWalletState,
  });
  handlersRef.current = { applyHydrated, clearWalletState };

  const onAccountsChanged = useCallback((accs: unknown) => {
    const accounts = accs as string[];
    const walletId = activeWalletIdRef.current;
    const active = activeProviderRef.current;
    if (!walletId || !active) return;
    if (!accounts?.length) {
      handlersRef.current.clearWalletState();
      return;
    }
    void (async () => {
      const h = await hydrateFromEip1193(active);
      if (h) handlersRef.current.applyHydrated(walletId, h);
      else handlersRef.current.clearWalletState();
    })();
  }, []);

  // Wallets recommend a full reload on chain change so RPC state stays consistent.
  const onChainChanged = useCallback(() => {
    if (typeof window !== "undefined") window.location.reload();
  }, []);

  const onDisconnect = useCallback(() => {
    handlersRef.current.clearWalletState();
  }, []);

  /**
   * Detach EIP-1193 listeners and null the active-provider refs. Called from
   * `disconnectWallet()` so a stale `accountsChanged`/`chainChanged` event from
   * the previously-attached extension can't re-hydrate state for the next
   * Supabase user on the same browser. The wallet itself remains connected at
   * the extension level (EIP-1193 has no programmatic disconnect), but the app
   * stops listening to it until the user explicitly reconnects.
   */
  const detachActiveProviderListeners = useCallback(() => {
    const active = activeProviderRef.current;
    if (active) {
      try {
        active.removeListener("accountsChanged", onAccountsChanged);
        active.removeListener("chainChanged", onChainChanged);
        active.removeListener("disconnect", onDisconnect);
      } catch {
        /* provider may not support removeListener */
      }
    }
    activeProviderRef.current = null;
    activeWalletIdRef.current = null;
  }, [onAccountsChanged, onChainChanged, onDisconnect]);

  const disconnectWallet = useCallback(() => {
    // EIP-1193 wallets cannot generally be programmatically disconnected;
    // detach listeners + clear app-side state so the next Supabase user on
    // this browser does not inherit the previous user's wallet.
    detachActiveProviderListeners();
    clearWalletState();
    setErrorMessage(null);
  }, [clearWalletState, detachActiveProviderListeners]);

  const attachProviderListeners = useCallback(
    (walletId: WalletId, eip1193: Eip1193Provider) => {
      const prev = activeProviderRef.current;
      const prevId = activeWalletIdRef.current;
      if (prev && prev !== eip1193) {
        try {
          prev.removeListener("accountsChanged", onAccountsChanged);
          prev.removeListener("chainChanged", onChainChanged);
          prev.removeListener("disconnect", onDisconnect);
        } catch {
          /* provider may not support removeListener pre-attach */
        }
      }

      activeProviderRef.current = eip1193;
      activeWalletIdRef.current = walletId;

      if (prev !== eip1193 || prevId !== walletId) {
        eip1193.on("accountsChanged", onAccountsChanged);
        eip1193.on("chainChanged", onChainChanged);
        eip1193.on("disconnect", onDisconnect);
      }
    },
    [onAccountsChanged, onChainChanged, onDisconnect],
  );

  // One-time discovery pass + persisted reconnect.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const discovered = await discoverAllWallets();
      if (cancelled) return;
      discoveredRef.current = discovered;
      setAvailability(availabilityFromDiscovery(discovered));
      setIsWalletDiscoveryComplete(true);

      const persisted = loadPersistedWallet();
      if (!persisted?.connected) return;
      const walletId = persisted.walletId;
      if (!walletId) return;
      const eip1193 = discovered[walletId];
      if (!eip1193) {
        clearPersistedWallet();
        return;
      }
      attachProviderListeners(walletId, eip1193);
      const h = await hydrateFromEip1193(eip1193);
      if (cancelled) return;
      if (h) handlersRef.current.applyHydrated(walletId, h);
      else clearPersistedWallet();
    })();

    return () => {
      cancelled = true;
      const active = activeProviderRef.current;
      if (active) {
        try {
          active.removeListener("accountsChanged", onAccountsChanged);
          active.removeListener("chainChanged", onChainChanged);
          active.removeListener("disconnect", onDisconnect);
        } catch {
          /* ignore */
        }
      }
      activeProviderRef.current = null;
      activeWalletIdRef.current = null;
    };
    // Listeners/handlers are stable; attach is intentionally one-time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connectWallet = useCallback(
    async (walletId: WalletId) => {
      setErrorMessage(null);
      const connector = getConnector(walletId);

      // Prefer a cached (already discovered) provider; otherwise, run a fresh
      // targeted discovery so we don't block the whole EIP-6963 wait window.
      let eip1193 = discoveredRef.current[walletId] ?? null;
      if (!eip1193) {
        eip1193 = await discoverProviderById(walletId, 320);
        if (eip1193) {
          discoveredRef.current = {
            ...discoveredRef.current,
            [walletId]: eip1193,
          };
          setAvailability(availabilityFromDiscovery(discoveredRef.current));
        }
      }

      if (!eip1193) {
        setErrorMessage(
          `${connector.name} was not found. Install it and refresh this page.`,
        );
        return;
      }

      setIsConnecting(true);
      try {
        attachProviderListeners(walletId, eip1193);
        await eip1193.request({ method: "eth_requestAccounts" });
        const h = await hydrateFromEip1193(eip1193);
        if (h) applyHydrated(walletId, h);
        else {
          setErrorMessage("No account returned from the wallet.");
          clearWalletState();
        }
      } catch (e) {
        setErrorMessage(messageForProviderError(e, connector.name));
        clearWalletState();
      } finally {
        setIsConnecting(false);
      }
    },
    [applyHydrated, attachProviderListeners, clearWalletState],
  );

  const switchToExpectedNetwork = useCallback(async () => {
    const active = activeProviderRef.current;
    const walletId = activeWalletIdRef.current;
    if (!active || !walletId) return;
    const connector = getConnector(walletId);
    setErrorMessage(null);
    setIsSwitchingChain(true);
    try {
      await switchToExpectedChain(active);
      const h = await hydrateFromEip1193(active);
      if (h) applyHydrated(walletId, h);
      else clearWalletState();
    } catch (e) {
      setErrorMessage(
        e instanceof Error
          ? e.message
          : messageForProviderError(e, connector.name),
      );
    } finally {
      setIsSwitchingChain(false);
    }
  }, [applyHydrated, clearWalletState]);

  const isWrongNetwork = useMemo(
    () => chainId !== null && chainId !== expectedChainId,
    [chainId],
  );

  const connectedNetworkName = useMemo(
    () => (chainId !== null ? networkLabelForChainId(chainId) : null),
    [chainId],
  );

  const value = useMemo<WalletContextValue>(
    () => ({
      walletAddress,
      isConnected,
      provider,
      signer,
      chainId,
      selectedWalletId,
      connectors: WALLET_CONNECTORS,
      availability,
      isWalletDiscoveryComplete,
      errorMessage,
      isWrongNetwork,
      connectedNetworkName,
      isConnecting,
      isSwitchingChain,
      connectWallet,
      disconnectWallet,
      switchToExpectedNetwork,
      clearError,
    }),
    [
      walletAddress,
      isConnected,
      provider,
      signer,
      chainId,
      selectedWalletId,
      availability,
      isWalletDiscoveryComplete,
      errorMessage,
      isWrongNetwork,
      connectedNetworkName,
      isConnecting,
      isSwitchingChain,
      connectWallet,
      disconnectWallet,
      switchToExpectedNetwork,
      clearError,
    ],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return ctx;
}
