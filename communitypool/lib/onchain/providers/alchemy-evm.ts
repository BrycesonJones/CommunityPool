import type { LookupInput, LookupError, NormalizedTokenBalance } from "../types";
import type { NormalizedNativeBalance, NormalizedTransaction } from "../types";
import type { ResolvedTxMeta } from "../types";
import type { ProviderAdapter } from "./provider-adapter";
import { fail, ok } from "./provider-adapter";
import {
  alchemyTokenRowToErc20,
  alchemyTokenRowToNative,
  assetTransferToNormalized,
  isNativeTokenAddress,
  type AssetTransferLike,
} from "../normalize";

const DATA_BASE = "https://api.g.alchemy.com/data/v1";

type JsonRpcResponse<T> = {
  jsonrpc: string;
  id: number;
  result?: T;
  error?: { code: number; message: string };
};

type AlchemyTokenRow = {
  address?: string;
  network?: string;
  tokenAddress?: string | null;
  tokenBalance?: string;
  tokenMetadata?: {
    decimals?: number;
    name?: string;
    symbol?: string;
    logo?: string | null;
  } | null;
  tokenPrices?: { currency: string; value: string }[];
  error?: string | null;
};

type AlchemyTokensResponse = {
  data?: {
    tokens?: AlchemyTokenRow[];
    pageKey?: string;
  };
  error?: { message?: string };
};

type AssetTransfersResult = {
  transfers?: AssetTransferLike[];
  pageKey?: string;
};

const PREVIEW_TX_LIMIT = 40;

function parseAssetTransferMaxPages(): number {
  const raw = process.env.ALCHEMY_ASSET_TRANSFER_MAX_PAGES?.trim();
  if (!raw) return 8;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return 8;
  return Math.min(8, Math.max(1, n));
}

type EthTxJson = {
  from?: string;
  to?: string | null;
  blockNumber?: string;
  hash?: string;
};

export type NetworkBucket = {
  native: NormalizedNativeBalance | null;
  tokens: NormalizedTokenBalance[];
  errors: LookupError[];
};

async function jsonRpc<T>(
  rpcUrl: string,
  method: string,
  params: unknown[],
): Promise<T> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
    cache: "no-store",
  });
  const json = (await res.json()) as JsonRpcResponse<T>;
  if (json.error) {
    throw new Error(json.error.message || "RPC error");
  }
  return json.result as T;
}

function emptyBuckets(
  networkIds: string[],
  message: string,
): Map<string, NetworkBucket> {
  const m = new Map<string, NetworkBucket>();
  for (const id of networkIds) {
    m.set(id, {
      native: null,
      tokens: [],
      errors: [{ code: "rpc_unavailable", message, networkId: id }],
    });
  }
  return m;
}

async function fetchTokenPortfolio(
  apiKey: string,
  evmAddress: string,
  networkIds: string[],
): Promise<Map<string, NetworkBucket>> {
  const addr = evmAddress.toLowerCase();
  const out = new Map<string, NetworkBucket>();
  for (const id of networkIds) {
    out.set(id, { native: null, tokens: [], errors: [] });
  }

  if (!apiKey) {
    return emptyBuckets(
      networkIds,
      "Missing ALCHEMY_API_KEY for Portfolio API.",
    );
  }

  const url = `${DATA_BASE}/${apiKey}/assets/tokens/by-address`;
  const collected: AlchemyTokenRow[] = [];
  let pageKey: string | undefined;

  try {
    do {
      const body: Record<string, unknown> = {
        addresses: [
          {
            address: addr,
            networks: [...networkIds],
          },
        ],
        withMetadata: true,
        withPrices: true,
        includeNativeTokens: true,
        includeErc20Tokens: true,
      };
      if (pageKey) body.pageKey = pageKey;

      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });

      const json = (await res.json()) as AlchemyTokensResponse;
      if (!res.ok || json.error?.message) {
        const msg =
          json.error?.message || `Alchemy tokens API HTTP ${res.status}`;
        for (const id of networkIds) {
          out.set(id, {
            native: null,
            tokens: [],
            errors: [{ code: "provider_error", message: msg, networkId: id }],
          });
        }
        return out;
      }

      collected.push(...(json.data?.tokens ?? []));
      pageKey = json.data?.pageKey;
    } while (pageKey);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Token fetch failed";
    for (const id of networkIds) {
      out.set(id, {
        native: null,
        tokens: [],
        errors: [{ code: "provider_error", message: msg, networkId: id }],
      });
    }
    return out;
  }

  for (const row of collected) {
    const net = row.network ?? "";
    const bucket = out.get(net);
    if (!bucket || row.error) continue;

    if (isNativeTokenAddress(row.tokenAddress)) {
      const native = alchemyTokenRowToNative(net, row);
      if (native) bucket.native = native;
    } else {
      const t = alchemyTokenRowToErc20(net, row);
      if (t) bucket.tokens.push(t);
    }
  }

  for (const id of networkIds) {
    const b = out.get(id);
    if (!b || b.errors.length > 0) continue;
    const anyRowForNet = collected.some((r) => (r.network ?? "") === id);
    if (!b.native && b.tokens.length === 0 && !anyRowForNet) {
      b.errors.push({
        code: "no_balance_data",
        message:
          "No token rows returned for this network (empty wallet or network not returned by provider).",
        networkId: id,
      });
    }
  }

  return out;
}

export function createAlchemyEvmAdapter(config: {
  apiKey: string;
  rpcUrlForNetwork: (networkId: string) => string | undefined;
}): ProviderAdapter {
  const { apiKey, rpcUrlForNetwork } = config;

  let portfolioState: {
    address: string;
    loaded: Set<string>;
    map: Map<string, NetworkBucket>;
  } | null = null;

  async function ensurePortfolio(address: string, networkIds: string[]) {
    const addr = address.toLowerCase();
    if (!portfolioState || portfolioState.address !== addr) {
      portfolioState = { address: addr, loaded: new Set(), map: new Map() };
    }
    const state = portfolioState;
    const missing = networkIds.filter((n) => !state.loaded.has(n));
    if (missing.length === 0) return;
    const batch = await fetchTokenPortfolio(apiKey, addr, missing);
    for (const id of missing) {
      const b = batch.get(id);
      if (b) state.map.set(id, b);
      state.loaded.add(id);
    }
  }

  return {
    id: "alchemy",

    supports(input: LookupInput) {
      return (
        input.chainFamily === "evm" &&
        input.kind !== "invalid" &&
        input.kind !== "ambiguous"
      );
    },

    preloadAddressContext(address, networkIds) {
      return ensurePortfolio(address, networkIds);
    },

    async getNativeBalance({ network, address }) {
      await ensurePortfolio(address, [network]);
      const b = portfolioState?.map.get(network);
      if (!b) {
        return fail({
          code: "internal",
          message: "Portfolio cache miss.",
          networkId: network,
        });
      }
      if (b.errors.length > 0) {
        return fail(b.errors[0]!);
      }
      return ok(b.native);
    },

    async getTokenBalances({ network, address }) {
      await ensurePortfolio(address, [network]);
      const b = portfolioState?.map.get(network);
      if (!b) {
        return fail({
          code: "internal",
          message: "Portfolio cache miss.",
          networkId: network,
        });
      }
      if (b.errors.length > 0) {
        return fail(b.errors[0]!);
      }
      return ok(b.tokens);
    },

    async getTransactions({ network, address }) {
      const errors: LookupError[] = [];
      const rpcUrl = rpcUrlForNetwork(network);
      if (!rpcUrl) {
        return fail({
          code: "unsupported_network",
          message: `No RPC URL configured for ${network}.`,
          networkId: network,
        });
      }

      const addrLower = address.toLowerCase();
      const maxPages = parseAssetTransferMaxPages();

      const pull = async (param: { fromAddress?: string; toAddress?: string }) => {
        const localTxs: NormalizedTransaction[] = [];
        const localSeen = new Set<string>();
        let pageKey: string | undefined;
        let pages = 0;
        let lastPageKey: string | undefined;
        let paginationIncomplete = false;
        const localErrors: LookupError[] = [];
        do {
          const params: Record<string, unknown> = {
            fromBlock: "0x0",
            toBlock: "latest",
            ...param,
            category: ["external", "internal", "erc20", "erc721"],
            excludeZeroValue: false,
            maxCount: "0x32",
          };
          if (pageKey) params.pageKey = pageKey;

          let result: AssetTransfersResult;
          try {
            result = await jsonRpc<AssetTransfersResult>(
              rpcUrl,
              "alchemy_getAssetTransfers",
              [params],
            );
          } catch (e) {
            const msg =
              e instanceof Error ? e.message : "alchemy_getAssetTransfers failed";
            localErrors.push({
              code: "transfer_fetch_error",
              message: msg,
              networkId: network,
            });
            paginationIncomplete = true;
            return { txs: localTxs, paginationIncomplete, errors: localErrors };
          }

          for (const t of result.transfers ?? []) {
            const norm = assetTransferToNormalized(network, t, addrLower);
            if (!norm) continue;
            const h = norm.hash.toLowerCase();
            if (localSeen.has(h)) continue;
            localSeen.add(h);
            localTxs.push({ ...norm, hash: h });
          }

          lastPageKey = result.pageKey;
          pageKey = result.pageKey;
          pages += 1;
        } while (pageKey && pages < maxPages);
        if (lastPageKey) paginationIncomplete = true;
        return { txs: localTxs, paginationIncomplete, errors: localErrors };
      };

      const [fromSide, toSide] = await Promise.all([
        pull({ fromAddress: address }),
        pull({ toAddress: address }),
      ]);

      errors.push(...fromSide.errors, ...toSide.errors);

      const blockNum = (t: NormalizedTransaction) =>
        parseInt(t.blockNumber ?? "0", 16);

      const mergedByHash = new Map<string, NormalizedTransaction>();
      for (const t of [...fromSide.txs, ...toSide.txs]) {
        const h = t.hash.toLowerCase();
        const prev = mergedByHash.get(h);
        if (!prev || blockNum(t) > blockNum(prev)) {
          mergedByHash.set(h, t);
        }
      }

      const txs = [...mergedByHash.values()].sort(
        (a, b) => blockNum(b) - blockNum(a),
      );

      const paginationIncomplete =
        fromSide.paginationIncomplete || toSide.paginationIncomplete;
      const transactionCountComplete =
        !paginationIncomplete && errors.length === 0;

      return ok({
        transactions: txs.slice(0, PREVIEW_TX_LIMIT),
        errors,
        uniqueTransactionCount: mergedByHash.size,
        transactionCountComplete,
      });
    },

    async resolveTransaction({ hash }) {
      const h = hash.startsWith("0x") ? hash : `0x${hash}`;
      const nets = ["eth-mainnet", "eth-sepolia"] as const;
      const metas = await Promise.all(
        nets.map(async (net) => {
          const rpcUrl = rpcUrlForNetwork(net);
          if (!rpcUrl) return null;
          try {
            const tx = await jsonRpc<EthTxJson | null>(
              rpcUrl,
              "eth_getTransactionByHash",
              [h],
            );
            if (tx && (tx.from || tx.to)) {
              return {
                hash,
                networkId: net,
                from: tx.from ?? null,
                to: tx.to ?? null,
              } satisfies ResolvedTxMeta;
            }
          } catch {
            /* ignore */
          }
          return null;
        }),
      );
      const main = metas.find((m) => m?.networkId === "eth-mainnet");
      const any = metas.find((m) => m != null);
      return ok(main ?? any ?? null);
    },
  };
}
