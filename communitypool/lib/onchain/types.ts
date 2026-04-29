export type ChainFamily = "evm" | "bitcoin" | "unknown";

export type LookupInputKind =
  | "evm_address"
  | "evm_tx_hash"
  | "btc_address"
  | "invalid"
  | "ambiguous";

/** Persisted / API: coarse classification of user paste. */
export type InputType = "address" | "tx_hash";

export type LookupInput = {
  kind: LookupInputKind;
  raw: string;
  /** Normalized canonical form (lowercased 0x-prefixed EVM, trimmed BTC). */
  normalized?: string;
  chainFamily: ChainFamily;
};

export type LookupError = {
  code: string;
  message: string;
  networkId?: string;
};

/** App-owned native balance (no provider-specific shape). */
export type NormalizedNativeBalance = {
  network: string;
  symbol: string;
  /** Atomic units as returned by the provider (decimal string, may be hex-less). */
  rawBalance: string;
  /** Human-readable decimal string. */
  formattedBalance: string;
  decimals: number;
  usdValue?: number | null;
};

/** @deprecated Prefer NormalizedNativeBalance; kept for snapshot compatibility. */
export type NormalizedAddressBalance = NormalizedNativeBalance & {
  networkId?: string;
  assetType?: "native";
  balanceDecimal?: string;
};

export type NormalizedTokenBalance = {
  networkId: string;
  contractAddress: string | null;
  symbol: string;
  name?: string | null;
  decimals: number;
  /** Atomic balance string from provider. */
  rawBalance: string;
  formattedBalance: string;
  usdValue?: number | null;
};

export type NormalizedTransaction = {
  networkId: string;
  hash: string;
  blockNumber?: string;
  timestamp?: string | null;
  direction?: "in" | "out" | "unknown";
  counterparty?: string | null;
  valueNativeDecimal?: string | null;
  symbol?: string | null;
  rawRef?: string | null;
};

/** Result of `getTransactions`: preview list + deduped hash count metadata. */
export type TransactionFetchPayload = {
  transactions: NormalizedTransaction[];
  errors: LookupError[];
  /** Distinct transaction hashes (lowercased for EVM) across scanned sources. */
  uniqueTransactionCount: number;
  /**
   * True only when every scanned list ended on a short page (no “maybe more” due to page cap).
   * If false, uniqueTransactionCount is a lower bound, not necessarily the explorer headline total.
   */
  transactionCountComplete: boolean;
};

export type NetworkBundle = {
  networkId: string;
  nativeBalance: NormalizedNativeBalance | null;
  tokens: NormalizedTokenBalance[];
  /** Recent txs for preview; length may be capped separately from uniqueTransactionCount. */
  transactions: NormalizedTransaction[];
  errors: LookupError[];
  /** Distinct tx hashes for this network; mirrors last successful `getTransactions` metadata. */
  uniqueTransactionCount: number;
  transactionCountComplete: boolean;
};

export type ResolvedTxMeta = {
  hash: string;
  networkId: string;
  from: string | null;
  to: string | null;
};

export type NormalizedLookupResult = {
  input: LookupInput;
  fetchedAt: string;
  fromCache: boolean;
  networks: NetworkBundle[];
  errors: LookupError[];
  resolvedTx?: ResolvedTxMeta;
};

export type RowPersistStatus = "success" | "partial" | "error" | "stale";
