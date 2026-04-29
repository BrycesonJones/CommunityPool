import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  canonicalKey,
  classifyInput,
  inputTypeForDb,
  type ValidateOptions,
} from "./validators";
import { createBitcoinAdapter } from "./providers/bitcoin";
import { createEvmLookupAdapter } from "./evm-adapter-factory";
import type { NetworkBundle, NormalizedLookupResult } from "./types";
import type { ProviderAdapter } from "./providers/provider-adapter";
import { DEFAULT_EVM_NETWORKS, ONCHAIN_CACHE_TTL_SECONDS } from "./constants";
import { readCacheByCanonicalKey, updateRowSnapshot } from "./cache";
import { summarizeLookupUsd } from "./summarize";
import {
  createLookupTimer,
  isOnchainLookupTimingEnabled,
  logLookupTiming,
} from "./lookup-timing";

// Re-export ValidateOptions as ClassifyOptions for API route compatibility
export type { ValidateOptions as ClassifyOptions } from "./validators";

const BTC_MAINNET = "bitcoin-mainnet";

function pickAdapter(
  input: NormalizedLookupResult["input"],
  evm: ProviderAdapter,
  btc: ProviderAdapter,
): ProviderAdapter {
  if (input.chainFamily === "bitcoin") return btc;
  return evm;
}

export type LookupServiceOptions = {
  raw: string;
  userId: string;
  supabase: SupabaseClient<Database>;
  forceRefresh?: boolean;
  networks?: string[];
  assumedFamily?: ValidateOptions["assumedFamily"];
  rowId?: string;
};

async function persistSnapshot(
  supabase: SupabaseClient<Database>,
  args: {
    userId: string;
    rowId: string;
    key: string;
    input: NormalizedLookupResult["input"];
    result: NormalizedLookupResult;
  },
) {
  const kind = inputTypeForDb(args.input);
  if (!kind) return;
  const expires = new Date(Date.now() + ONCHAIN_CACHE_TTL_SECONDS * 1000);
  const summary = summarizeLookupUsd(args.result);
  const txHash =
    args.input.kind === "evm_tx_hash" && args.input.normalized
      ? args.input.normalized
      : null;
  await updateRowSnapshot(supabase, {
    userId: args.userId,
    rowId: args.rowId,
    canonicalKey: args.key,
    inputType: kind,
    inputKind: kind,
    result: args.result,
    expiresAt: expires,
    addressBalanceSummary: summary,
    transactionHashId: txHash,
  });
}

export async function runOnchainLookup(
  opts: LookupServiceOptions,
): Promise<NormalizedLookupResult> {
  const {
    raw,
    userId,
    supabase,
    forceRefresh,
    networks: networksOverride,
    assumedFamily,
    rowId,
  } = opts;

  const input = classifyInput(raw, { assumedFamily });
  const key = canonicalKey(input);
  const evmNetworkIds = networksOverride?.length
    ? networksOverride
    : [...DEFAULT_EVM_NETWORKS];

  const topErrors: NormalizedLookupResult["errors"] = [];

  if (input.kind === "invalid") {
    return {
      input,
      fetchedAt: new Date().toISOString(),
      fromCache: false,
      networks: [],
      errors: [
        {
          code: "invalid_input",
          message:
            "Unrecognized input. Paste an EVM address, 0x-prefixed EVM tx hash, or BTC address.",
        },
      ],
    };
  }

  if (input.kind === "ambiguous") {
    return {
      input,
      fetchedAt: new Date().toISOString(),
      fromCache: false,
      networks: [],
      errors: [
        {
          code: "ambiguous_hex",
          message:
            "64-character hex without 0x is ambiguous. Use 0x for EVM txs or pass assumedFamily: evm in the request body.",
        },
      ],
    };
  }

  const timer = isOnchainLookupTimingEnabled() ? createLookupTimer() : null;
  if (timer) timer.mark("start");

  if (key && !forceRefresh) {
    const cached = await readCacheByCanonicalKey(supabase, userId, key);
    if (timer) timer.mark("cacheRead");
    if (cached) {
      if (timer) {
        logLookupTiming({
          ...timer.marks,
          totalMs: timer.elapsedMs(),
          path: "cache_hit",
          canonicalKey: key,
        });
      }
      return { ...cached, fromCache: true };
    }
  }

  const alchemyKey = process.env.ALCHEMY_API_KEY ?? "";
  const etherscanKey = process.env.ETHERSCAN_API_KEY?.trim() ?? "";
  const evmAdapter = createEvmLookupAdapter({ alchemyKey, etherscanKey });
  if (timer) timer.mark("adapterInit");
  const mempoolBase =
    process.env.MEMPOOL_API_BASE?.trim() || "https://mempool.space";
  const btcAdapter = createBitcoinAdapter({ baseUrl: mempoolBase });
  const adapter = pickAdapter(input, evmAdapter, btcAdapter);

  const fetchedAt = new Date().toISOString();

  if (!adapter.supports(input)) {
    return {
      input,
      fetchedAt,
      fromCache: false,
      networks: [],
      errors: [
        ...topErrors,
        { code: "unsupported_family", message: "Unsupported chain family." },
      ],
    };
  }

  if (input.chainFamily === "bitcoin" && input.normalized) {
    const networks = await buildBundlesForBitcoin(adapter, input.normalized);
    if (timer) timer.mark("btcBundles");
    const result: NormalizedLookupResult = {
      input,
      fetchedAt,
      fromCache: false,
      networks,
      errors: topErrors,
    };
    if (key && rowId) {
      await persistSnapshot(supabase, { userId, rowId, key, input, result });
    }
    if (timer) {
      timer.mark("persist");
      logLookupTiming({
        ...timer.marks,
        totalMs: timer.elapsedMs(),
        path: "bitcoin",
        adapterId: adapter.id,
      });
    }
    return result;
  }

  if (input.chainFamily !== "evm" || !input.normalized) {
    return {
      input,
      fetchedAt,
      fromCache: false,
      networks: [],
      errors: [
        ...topErrors,
        { code: "unsupported_family", message: "Unsupported chain family." },
      ],
    };
  }

  let resolvedTx: NormalizedLookupResult["resolvedTx"];
  let lookupAddress: string | undefined;

  if (input.kind === "evm_address") {
    lookupAddress = input.normalized;
  } else if (input.kind === "evm_tx_hash") {
    const res = await evmAdapter.resolveTransaction({ hash: input.normalized });
    if (timer) timer.mark("resolveTx");
    if (!res.ok) {
      return {
        input,
        fetchedAt,
        fromCache: false,
        networks: [],
        errors: [res.error],
      };
    }
    if (!res.data) {
      return {
        input,
        fetchedAt,
        fromCache: false,
        networks: [],
        errors: [
          {
            code: "tx_not_found",
            message:
              "Transaction not found on Ethereum mainnet or Sepolia via configured RPC.",
          },
        ],
      };
    }
    resolvedTx = {
      hash: input.normalized,
      networkId: res.data.networkId,
      from: res.data.from,
      to: res.data.to,
    };
    lookupAddress = res.data.to ?? res.data.from ?? undefined;
    if (!lookupAddress) {
      return {
        input,
        fetchedAt,
        fromCache: false,
        networks: [],
        errors: [
          {
            code: "tx_unresolvable_address",
            message: "Could not derive an address from this transaction.",
          },
        ],
        resolvedTx,
      };
    }
  }

  if (!lookupAddress) {
    return {
      input,
      fetchedAt,
      fromCache: false,
      networks: [],
      errors: [{ code: "internal", message: "Missing lookup address." }],
    };
  }

  const evmLookupAddress = lookupAddress;

  await evmAdapter.preloadAddressContext?.(evmLookupAddress, evmNetworkIds);
  if (timer) timer.mark("preload");

  async function buildEvmNetworkBundle(net: string): Promise<NetworkBundle> {
    const bundle: NetworkBundle = {
      networkId: net,
      nativeBalance: null,
      tokens: [],
      transactions: [],
      errors: [],
      uniqueTransactionCount: 0,
      transactionCountComplete: false,
    };

    const [nativeRes, tokenRes, txRes] = await Promise.all([
      evmAdapter.getNativeBalance({ network: net, address: evmLookupAddress }),
      evmAdapter.getTokenBalances({ network: net, address: evmLookupAddress }),
      evmAdapter.getTransactions({ network: net, address: evmLookupAddress }),
    ]);

    if (!nativeRes.ok) {
      bundle.errors.push(nativeRes.error);
    } else {
      bundle.nativeBalance = nativeRes.data;
    }

    if (!tokenRes.ok) {
      bundle.errors.push(tokenRes.error);
    } else {
      bundle.tokens = tokenRes.data;
    }

    if (!txRes.ok) {
      bundle.errors.push(txRes.error);
    } else {
      bundle.transactions = txRes.data.transactions;
      bundle.uniqueTransactionCount = txRes.data.uniqueTransactionCount;
      bundle.transactionCountComplete = txRes.data.transactionCountComplete;
      bundle.errors.push(...txRes.data.errors);
    }

    return bundle;
  }

  const networks: NetworkBundle[] = await Promise.all(
    evmNetworkIds.map((net) => buildEvmNetworkBundle(net)),
  );
  if (timer) timer.mark("evmNetworks");

  const result: NormalizedLookupResult = {
    input,
    fetchedAt,
    fromCache: false,
    networks,
    errors: topErrors,
    resolvedTx,
  };

  if (key && rowId) {
    await persistSnapshot(supabase, { userId, rowId, key, input, result });
  }
  if (timer) {
    timer.mark("persist");
    logLookupTiming({
      ...timer.marks,
      totalMs: timer.elapsedMs(),
      path: "evm",
      adapterId: evmAdapter.id,
      networks: evmNetworkIds.join(","),
    });
  }

  return result;
}

async function buildBundlesForBitcoin(
  adapter: ProviderAdapter,
  address: string,
): Promise<NetworkBundle[]> {
  const net = BTC_MAINNET;
  const bundle: NetworkBundle = {
    networkId: net,
    nativeBalance: null,
    tokens: [],
    transactions: [],
    errors: [],
    uniqueTransactionCount: 0,
    transactionCountComplete: false,
  };

  await adapter.preloadAddressContext?.(address, [net]);

  const [nativeRes, tokenRes, txRes] = await Promise.all([
    adapter.getNativeBalance({ network: net, address }),
    adapter.getTokenBalances({ network: net, address }),
    adapter.getTransactions({ network: net, address }),
  ]);

  if (!nativeRes.ok) {
    bundle.errors.push(nativeRes.error);
  } else {
    bundle.nativeBalance = nativeRes.data;
  }

  if (!tokenRes.ok) {
    bundle.errors.push(tokenRes.error);
  } else {
    bundle.tokens = tokenRes.data;
  }

  if (!txRes.ok) {
    bundle.errors.push(txRes.error);
  } else {
    bundle.transactions = txRes.data.transactions;
    bundle.uniqueTransactionCount = txRes.data.uniqueTransactionCount;
    bundle.transactionCountComplete = txRes.data.transactionCountComplete;
    bundle.errors.push(...txRes.data.errors);
  }

  return [bundle];
}
