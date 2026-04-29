/**
 * @vitest-environment jsdom
 *
 * OWASP A08 F-03: pool-list localStorage must clear on logout so a shared
 * browser does not show User A's pools to User B during the window before
 * the new user's DB rows replace the cache.
 *
 * The wallet boundary already has its own test in
 * `test/security/logout-clears-wallet.test.tsx`; this file covers the
 * sibling `communitypool.openPools.v1` clear path.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

class MemoryStorage {
  private readonly store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  });
});

afterEach(() => {
  storage.clear();
});

describe("clearOpenPoolsFromStorage", () => {
  it("removes the communitypool.openPools.v1 key when present", async () => {
    const {
      saveOpenPoolsToStorage,
      loadOpenPoolsFromStorage,
      clearOpenPoolsFromStorage,
    } = await import("@/lib/pools/open-pools-storage");

    const pool = {
      id: "11155111-0xabc",
      name: "Pool A",
      address: "0xabc",
      chainId: 11155111,
      status: "Active" as const,
      totalUsd: 100,
      deployedAt: Date.now(),
    };
    saveOpenPoolsToStorage([pool]);
    expect(loadOpenPoolsFromStorage()).toHaveLength(1);

    clearOpenPoolsFromStorage();
    expect(loadOpenPoolsFromStorage()).toHaveLength(0);
    expect(window.localStorage.getItem("communitypool.openPools.v1")).toBeNull();
  });

  it("is a no-op when no entry exists (does not crash)", async () => {
    const { clearOpenPoolsFromStorage, loadOpenPoolsFromStorage } = await import(
      "@/lib/pools/open-pools-storage"
    );
    expect(() => clearOpenPoolsFromStorage()).not.toThrow();
    expect(loadOpenPoolsFromStorage()).toEqual([]);
  });

  it("dispatches the same change event as the append helpers (subscribers re-render)", async () => {
    const { clearOpenPoolsFromStorage, subscribeOpenPoolsFromStorage } =
      await import("@/lib/pools/open-pools-storage");
    let calls = 0;
    const unsub = subscribeOpenPoolsFromStorage(() => {
      calls += 1;
    });
    clearOpenPoolsFromStorage();
    expect(calls).toBeGreaterThan(0);
    unsub();
  });

  it("malformed JSON in localStorage does not crash the load path before or after clear", async () => {
    window.localStorage.setItem(
      "communitypool.openPools.v1",
      "{not-json",
    );
    const { loadOpenPoolsFromStorage, clearOpenPoolsFromStorage } = await import(
      "@/lib/pools/open-pools-storage"
    );
    // safeParse swallows the JSON error and returns an empty list.
    expect(loadOpenPoolsFromStorage()).toEqual([]);
    expect(() => clearOpenPoolsFromStorage()).not.toThrow();
    expect(window.localStorage.getItem("communitypool.openPools.v1")).toBeNull();
  });
});
