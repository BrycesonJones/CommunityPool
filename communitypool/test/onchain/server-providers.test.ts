import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { getServerReadOnlyProviderForChain } from "@/lib/onchain/server-providers";

describe("getServerReadOnlyProviderForChain", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    delete process.env.ALCHEMY_API_KEY;
    delete process.env.ALCHEMY_API_URL_ETH_MAINNET;
    delete process.env.ALCHEMY_API_URL_ETH_SEPOLIA;
    delete process.env.ALCHEMY_ETHMAINNET_ENDPOINT_URL;
    delete process.env.ALCHEMY_ETHSEPOLIA_ENDPOINT_URL;
    delete process.env.LOCAL_ANVIL_RPC_URL;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  function urlOf(p: unknown): string {
    return (p as { _getConnection: () => { url: string } })._getConnection()
      .url;
  }

  it("prefers ALCHEMY_API_URL_ETH_SEPOLIA for sepolia", () => {
    process.env.ALCHEMY_API_URL_ETH_SEPOLIA = "https://custom.sepolia/rpc";
    process.env.ALCHEMY_API_KEY = "unused-when-explicit-url-set";
    const p = getServerReadOnlyProviderForChain(11155111);
    expect(p).not.toBeNull();
    expect(urlOf(p)).toBe("https://custom.sepolia/rpc");
  });

  it("builds sepolia URL from ALCHEMY_API_KEY when explicit URL missing", () => {
    process.env.ALCHEMY_API_KEY = "abc123";
    const p = getServerReadOnlyProviderForChain(11155111);
    expect(p).not.toBeNull();
    expect(urlOf(p)).toBe("https://eth-sepolia.g.alchemy.com/v2/abc123");
  });

  it("builds mainnet URL from ALCHEMY_API_KEY", () => {
    process.env.ALCHEMY_API_KEY = "abc123";
    const p = getServerReadOnlyProviderForChain(1);
    expect(p).not.toBeNull();
    expect(urlOf(p)).toBe("https://eth-mainnet.g.alchemy.com/v2/abc123");
  });

  it("returns null for supported chain with no credentials", () => {
    expect(getServerReadOnlyProviderForChain(1)).toBeNull();
    expect(getServerReadOnlyProviderForChain(11155111)).toBeNull();
  });

  it("supports local anvil via LOCAL_ANVIL_RPC_URL", () => {
    process.env.LOCAL_ANVIL_RPC_URL = "http://127.0.0.1:8545";
    const p = getServerReadOnlyProviderForChain(31337);
    expect(p).not.toBeNull();
    expect(urlOf(p)).toBe("http://127.0.0.1:8545");
  });

  it("also recognises the ALCHEMY_ETHSEPOLIA_ENDPOINT_URL alias", () => {
    process.env.ALCHEMY_ETHSEPOLIA_ENDPOINT_URL = "https://alias.sepolia/rpc";
    const p = getServerReadOnlyProviderForChain(11155111);
    expect(p).not.toBeNull();
    expect(urlOf(p)).toBe("https://alias.sepolia/rpc");
  });

  it("returns null for unsupported chain ids", () => {
    expect(getServerReadOnlyProviderForChain(9999)).toBeNull();
  });
});
