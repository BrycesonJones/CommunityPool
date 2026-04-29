import type {
  LookupInput,
  LookupError,
  NormalizedNativeBalance,
  NormalizedTokenBalance,
  ResolvedTxMeta,
  TransactionFetchPayload,
} from "../types";
import type { AdapterResult } from "../normalize";

/**
 * Chain data provider (Alchemy for EVM, future HTTP APIs for BTC).
 * Implementations may batch internally (e.g. one Portfolio call) while exposing granular methods.
 */
export type ProviderAdapter = {
  readonly id: string;

  supports(input: LookupInput): boolean;

  /**
   * Optional: prefetch address-scoped data for many networks in one provider round-trip.
   * Alchemy uses this before getNativeBalance / getTokenBalances per network.
   */
  preloadAddressContext?(
    address: string,
    networkIds: string[],
  ): Promise<void>;

  getNativeBalance(params: {
    network: string;
    address: string;
  }): Promise<AdapterResult<NormalizedNativeBalance | null>>;

  getTokenBalances(params: {
    network: string;
    address: string;
  }): Promise<AdapterResult<NormalizedTokenBalance[]>>;

  /** `errors` may be non-empty even when `ok` (partial provider failures). */
  getTransactions(params: {
    network: string;
    address: string;
  }): Promise<AdapterResult<TransactionFetchPayload>>;

  resolveTransaction(params: {
    hash: string;
  }): Promise<AdapterResult<ResolvedTxMeta | null>>;
};

export function ok<T>(data: T): AdapterResult<T> {
  return { ok: true, data };
}

export function fail(error: LookupError): AdapterResult<never> {
  return { ok: false, error };
}
