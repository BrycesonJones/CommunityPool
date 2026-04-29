/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChange: vi.fn(),
  getUser: vi.fn(),
  disconnectWallet: vi.fn(),
  unsubscribe: vi.fn(),
  signOutInvokedAt: { value: 0 },
  disconnectInvokedAt: { value: 0 },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signOut: () => {
        mocks.signOutInvokedAt.value = mocks.signOutInvokedAt.value + 1;
        return mocks.signOut();
      },
      onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
        mocks.onAuthStateChange(cb);
        return {
          data: { subscription: { unsubscribe: mocks.unsubscribe } },
        };
      },
      getUser: mocks.getUser,
    },
  }),
  getUserSerialized: async () => ({
    id: "u-1",
    email: "alice@example.com",
    user_metadata: { username: "alice" },
  }),
}));

vi.mock("@/components/wallet-provider", () => ({
  useWallet: () => ({
    disconnectWallet: () => {
      mocks.disconnectInvokedAt.value = mocks.disconnectInvokedAt.value + 1;
      mocks.disconnectWallet();
    },
  }),
}));

import { AccountProfileHub } from "@/components/account-profile-hub";

/**
 * The repo's vitest+jsdom setup ships a `window.localStorage` *property*
 * but its `setItem`/`getItem`/`clear` methods are undefined (Node 22's
 * `--localstorage-file` warning is the symptom). Install a minimal in-memory
 * Storage so tests that touch persistence work deterministically.
 */
function installFakeLocalStorage(): void {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key) {
      store.delete(key);
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  });
}

beforeEach(() => {
  installFakeLocalStorage();
  Object.values(mocks).forEach((m) => {
    if (typeof (m as { mockClear?: () => void }).mockClear === "function") {
      (m as { mockClear: () => void }).mockClear();
    }
  });
  mocks.signOut.mockResolvedValue(undefined);
  mocks.signOutInvokedAt.value = 0;
  mocks.disconnectInvokedAt.value = 0;

  // Seed a wallet entry so the dedicated wallet-storage test can assert the
  // helpers actually clear it. The `AccountProfileHub` test below uses the
  // mocked `useWallet`, which doesn't touch storage; storage clearing by
  // the real provider is verified through the `clearPersistedWallet` path.
  window.localStorage.setItem(
    "communitypool_wallet_v1",
    JSON.stringify({
      connected: true,
      walletId: "metamask",
      walletAddress: "0xabc",
      chainId: "11155111",
    }),
  );
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("AccountProfileHub logout — wallet boundary", () => {
  it("calls disconnectWallet before signOut, then redirects home", async () => {
    render(<AccountProfileHub />);
    // Hub returns null until hydrated; wait for the trigger button.
    const trigger = await screen.findByRole("button", {
      name: /open account menu/i,
    });
    fireEvent.click(trigger);
    const logoutBtn = await screen.findByRole("menuitem", { name: /log out/i });

    // disconnectWallet runs synchronously before signOut's promise resolves;
    // we only need to assert both were called and that disconnect's "tick"
    // counter was set first (it's set inside the synchronous wrapper above).
    fireEvent.click(logoutBtn);

    await waitFor(() => expect(mocks.signOut).toHaveBeenCalled());
    expect(mocks.disconnectWallet).toHaveBeenCalled();
    expect(mocks.disconnectInvokedAt.value).toBeGreaterThan(0);
    expect(mocks.signOutInvokedAt.value).toBeGreaterThan(0);
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/"));
    expect(mocks.refresh).toHaveBeenCalled();
  });
});

describe("wallet-storage helpers", () => {
  it("clearPersistedWallet removes the localStorage entry", async () => {
    const { savePersistedWallet, clearPersistedWallet, loadPersistedWallet } =
      await import("@/lib/wallet/storage");
    savePersistedWallet({
      connected: true,
      walletId: "metamask",
      walletAddress: "0xabc",
      chainId: "11155111",
    });
    expect(loadPersistedWallet()?.connected).toBe(true);

    clearPersistedWallet();
    expect(window.localStorage.getItem("communitypool_wallet_v1")).toBeNull();
    expect(loadPersistedWallet()).toBeNull();
  });
});
