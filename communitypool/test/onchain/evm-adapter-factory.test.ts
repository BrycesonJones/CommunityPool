import { afterEach, describe, expect, it } from "vitest";
import { createEvmLookupAdapter } from "@/lib/onchain/evm-adapter-factory";

describe("createEvmLookupAdapter", () => {
  afterEach(() => {
    delete process.env.EVM_LOOKUP_PROVIDER;
  });

  it("prefers Alchemy when both API keys are present", () => {
    const adapter = createEvmLookupAdapter({
      alchemyKey: "alchemy-key",
      etherscanKey: "etherscan-key",
    });
    expect(adapter.id).toBe("alchemy");
  });

  it("forces Etherscan when EVM_LOOKUP_PROVIDER=etherscan", () => {
    process.env.EVM_LOOKUP_PROVIDER = "etherscan";
    const adapter = createEvmLookupAdapter({
      alchemyKey: "alchemy-key",
      etherscanKey: "etherscan-key",
    });
    expect(adapter.id).toBe("etherscan");
  });

  it("uses Etherscan when only ETHERSCAN key is set", () => {
    const adapter = createEvmLookupAdapter({
      alchemyKey: "",
      etherscanKey: "etherscan-key",
    });
    expect(adapter.id).toBe("etherscan");
  });

  it("uses Alchemy when only Alchemy key is set", () => {
    const adapter = createEvmLookupAdapter({
      alchemyKey: "alchemy-key",
      etherscanKey: "",
    });
    expect(adapter.id).toBe("alchemy");
  });
});
