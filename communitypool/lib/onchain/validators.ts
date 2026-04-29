import type { InputType, LookupInput } from "./types";
import { normalizeBitcoinAddressInput } from "./bitcoin-address";

const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const EVM_TX = /^0x[a-fA-F0-9]{64}$/;
const HEX64 = /^[a-fA-F0-9]{64}$/;

export type ValidateOptions = {
  assumedFamily?: "evm" | "bitcoin";
};

/**
 * Server-side classification: EVM address, EVM tx (0x + 64 hex), BTC address, or ambiguous 64-char hex.
 */
export function classifyInput(raw: string, options?: ValidateOptions): LookupInput {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { kind: "invalid", raw, chainFamily: "unknown" };
  }

  if (EVM_ADDRESS.test(trimmed)) {
    return {
      kind: "evm_address",
      raw: trimmed,
      normalized: trimmed.toLowerCase(),
      chainFamily: "evm",
    };
  }

  if (EVM_TX.test(trimmed)) {
    return {
      kind: "evm_tx_hash",
      raw: trimmed,
      normalized: trimmed.toLowerCase(),
      chainFamily: "evm",
    };
  }

  const btcAddress = normalizeBitcoinAddressInput(trimmed);
  if (btcAddress) {
    return {
      kind: "btc_address",
      raw: trimmed,
      normalized: btcAddress,
      chainFamily: "bitcoin",
    };
  }

  if (HEX64.test(trimmed)) {
    if (options?.assumedFamily === "evm") {
      return {
        kind: "evm_tx_hash",
        raw: trimmed,
        normalized: `0x${trimmed.toLowerCase()}`,
        chainFamily: "evm",
      };
    }
    return {
      kind: "ambiguous",
      raw: trimmed,
      chainFamily: "unknown",
    };
  }

  return { kind: "invalid", raw: trimmed, chainFamily: "unknown" };
}

/** Stable DB / cache key for a classified input. */
export function canonicalKey(input: LookupInput): string | null {
  if (input.kind === "invalid" || input.kind === "ambiguous") return null;
  if (!input.normalized) return null;

  if (input.chainFamily === "evm") {
    if (input.kind === "evm_address") return `evm:addr:${input.normalized}`;
    if (input.kind === "evm_tx_hash") return `evm:tx:${input.normalized}`;
  }

  if (input.chainFamily === "bitcoin" && input.kind === "btc_address") {
    return `btc:addr:${input.normalized}`;
  }

  return null;
}

/** Maps fine-grained kind → DB `input_type` / `input_kind` (legacy column). */
export function inputTypeForDb(input: LookupInput): InputType | null {
  if (input.kind === "evm_tx_hash") return "tx_hash";
  if (input.kind === "evm_address" || input.kind === "btc_address") {
    return "address";
  }
  return null;
}

/** @deprecated Use inputTypeForDb */
export const inputKindForDb = inputTypeForDb;
