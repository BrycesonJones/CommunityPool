import { getAddress } from "ethers";
import type { LookupInput, LookupError, NormalizedTransaction } from "../types";
import type { NormalizedNativeBalance, NormalizedTokenBalance } from "../types";
import type { ResolvedTxMeta } from "../types";
import type { ProviderAdapter } from "./provider-adapter";
import { fail, ok } from "./provider-adapter";
import { chainlinkUsdPerUnit } from "../chainlink-spot";
import {
  createEtherscanV2Client,
  etherscanIsHardError,
  etherscanResultToArray,
  type EtherscanTxRow,
} from "../etherscan-v2";
import { formatAtomicToDecimal } from "../normalize";
import {
  chainIdBigIntForEvmNetwork,
  etherscanChainIdForNetwork,
} from "../networks";
import { getErc20Presets, getPoolChainConfig } from "../pool-chain-config";
import { isOnchainLookupTimingEnabled } from "../lookup-timing";

function parseMaxTxPages(): number {
  const raw = process.env.ETHERSCAN_TX_MAX_PAGES?.trim();
  if (!raw) return 3;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return 3;
  return Math.min(8, Math.max(1, n));
}

type JsonRpcResponse<T> = {
  jsonrpc: string;
  id: number;
  result?: T;
  error?: { code: number; message: string };
};

type EthTxJson = {
  from?: string;
  to?: string | null;
};

async function jsonRpc<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
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

function blockDecimalToHex(block: string | undefined): string | undefined {
  if (!block) return undefined;
  try {
    return `0x${BigInt(block).toString(16)}`;
  } catch {
    return undefined;
  }
}

function asTxRows(arr: unknown[]): EtherscanTxRow[] {
  return arr.filter((x): x is EtherscanTxRow => typeof x === "object" && x !== null);
}

function normalizeEtherscanTx(
  networkId: string,
  row: EtherscanTxRow,
  watchedLower: string,
  rawRef: string,
): NormalizedTransaction | null {
  const h = row.hash;
  if (!h) return null;
  const from = (row.from ?? "").toLowerCase();
  const to = (row.to ?? "").toLowerCase();
  let direction: NormalizedTransaction["direction"] = "unknown";
  if (from === watchedLower && to === watchedLower) direction = "unknown";
  else if (from === watchedLower) direction = "out";
  else if (to === watchedLower) direction = "in";

  const valueWei = String(row.value ?? "0");
  const valueNativeDecimal = formatAtomicToDecimal(valueWei, 18);

  return {
    networkId,
    hash: h,
    blockNumber: blockDecimalToHex(row.blockNumber),
    timestamp: row.timeStamp ?? null,
    direction,
    counterparty:
      direction === "out" ? row.to ?? null : direction === "in" ? row.from ?? null : null,
    valueNativeDecimal,
    symbol: "ETH",
    rawRef,
  };
}

const TX_PAGE_SIZE = 100;
/** Max normalized txs returned for dashboard preview (not the unique count). */
const PREVIEW_TX_LIMIT = 40;

type EtherscanAccountTxAction =
  | "txlist"
  | "txlistinternal"
  | "tokentx"
  | "tokennfttx";

export function createEtherscanEvmAdapter(config: {
  apiKey: string;
  rpcUrlForNetwork: (networkId: string) => string | undefined;
}): ProviderAdapter {
  const client = createEtherscanV2Client({ apiKey: config.apiKey });
  const { rpcUrlForNetwork } = config;
  const maxTxPages = parseMaxTxPages();

  let txPageFetchCount = 0;

  /**
   * Paginates one Etherscan account action. `paginationComplete` is false when the last page
   * was full and we stopped at maxTxPages (more history may exist off-chain).
   */
  async function fetchTxPages(
    chainId: number,
    action: EtherscanAccountTxAction,
    address: string,
  ): Promise<{
    rows: EtherscanTxRow[];
    error: LookupError | null;
    paginationComplete: boolean;
  }> {
    const collected: EtherscanTxRow[] = [];
    for (let page = 1; page <= maxTxPages; page += 1) {
      const json = await client.get({
        chainid: String(chainId),
        module: "account",
        action,
        address: getAddress(address),
        startblock: "0",
        endblock: "9999999999",
        page: String(page),
        offset: String(TX_PAGE_SIZE),
        sort: "desc",
      });
      const hard = etherscanIsHardError(json);
      if (hard) {
        return {
          rows: collected,
          error: {
            code: "etherscan_error",
            message: hard,
            networkId: undefined,
          },
          paginationComplete: false,
        };
      }
      const arr = etherscanResultToArray(json.result);
      if (arr === null) {
        return {
          rows: collected,
          error: {
            code: "etherscan_parse",
            message: "Unexpected Etherscan response shape.",
          },
          paginationComplete: false,
        };
      }
      const rows = asTxRows(arr);
      collected.push(...rows);
      txPageFetchCount += 1;
      if (rows.length < TX_PAGE_SIZE) {
        return { rows: collected, error: null, paginationComplete: true };
      }
      if (page === maxTxPages) {
        return { rows: collected, error: null, paginationComplete: false };
      }
    }
    return { rows: collected, error: null, paginationComplete: true };
  }

  return {
    id: "etherscan",

    supports(input: LookupInput) {
      return (
        input.chainFamily === "evm" &&
        input.kind !== "invalid" &&
        input.kind !== "ambiguous"
      );
    },

    async preloadAddressContext() {
      /* no batch portfolio; balances are per-call */
    },

    async getNativeBalance({ network, address }) {
      const chainId = etherscanChainIdForNetwork(network);
      if (chainId === undefined) {
        return fail({
          code: "unsupported_network",
          message: `No Etherscan chain id for ${network}.`,
          networkId: network,
        });
      }
      const json = await client.get({
        chainid: String(chainId),
        module: "account",
        action: "balance",
        address: getAddress(address),
        tag: "latest",
      });
      const hard = etherscanIsHardError(json);
      if (hard) {
        return fail({
          code: "etherscan_error",
          message: hard,
          networkId: network,
        });
      }
      if (json.status !== "1" || typeof json.result !== "string") {
        return fail({
          code: "etherscan_error",
          message: json.message || "Etherscan balance request failed.",
          networkId: network,
        });
      }
      const raw = json.result.trim();
      const decimals = 18;
      const formatted = formatAtomicToDecimal(raw, decimals);
      const balNum = Number(formatted);
      if (!Number.isFinite(balNum) || balNum <= 0) {
        return ok(null);
      }
      const rpcUrl = rpcUrlForNetwork(network);
      let usdValue: number | null = null;
      if (rpcUrl) {
        try {
          const poolCfg = getPoolChainConfig(BigInt(chainId));
          const spot = await chainlinkUsdPerUnit(rpcUrl, poolCfg.ethUsdPriceFeed);
          if (spot != null) usdValue = spot * balNum;
        } catch {
          usdValue = null;
        }
      }
      const native: NormalizedNativeBalance = {
        network,
        symbol: "ETH",
        rawBalance: raw,
        formattedBalance: formatted,
        decimals,
        usdValue,
      };
      return ok(native);
    },

    async getTokenBalances({ network, address }) {
      const chainId = etherscanChainIdForNetwork(network);
      if (chainId === undefined) {
        return fail({
          code: "unsupported_network",
          message: `No Etherscan chain id for ${network}.`,
          networkId: network,
        });
      }
      const bigChain = chainIdBigIntForEvmNetwork(network);
      if (bigChain === undefined) {
        return fail({ code: "internal", message: "Missing chain id.", networkId: network });
      }
      const presets = getErc20Presets(bigChain);
      const rpcUrl = rpcUrlForNetwork(network);

      type PresetRow = (typeof presets)[number];
      const balanceRows = await Promise.all(
        presets.map(async (p) => {
          try {
            const json = await client.get({
              chainid: String(chainId),
              module: "account",
              action: "tokenbalance",
              contractaddress: getAddress(p.token),
              address: getAddress(address),
              tag: "latest",
            });
            const hard = etherscanIsHardError(json);
            if (hard) {
              return { ok: false as const, error: hard, p };
            }
            if (json.status !== "1" || typeof json.result !== "string") {
              return { ok: true as const, p, skip: true as const };
            }
            const raw = json.result.trim();
            const formatted = formatAtomicToDecimal(raw, p.decimals);
            const balNum = Number(formatted);
            if (!Number.isFinite(balNum) || balNum <= 0) {
              return { ok: true as const, p, skip: true as const };
            }
            return { ok: true as const, p, skip: false as const, raw, formatted, balNum };
          } catch (e) {
            const msg = e instanceof Error ? e.message : "tokenbalance request failed";
            return { ok: false as const, error: msg, p };
          }
        }),
      );

      const positive: {
        p: PresetRow;
        raw: string;
        formatted: string;
        balNum: number;
      }[] = [];

      for (const row of balanceRows) {
        if (row.ok === false) {
          return fail({
            code: "etherscan_error",
            message: row.error,
            networkId: network,
          });
        }
        if (row.skip) continue;
        positive.push({
          p: row.p,
          raw: row.raw,
          formatted: row.formatted,
          balNum: row.balNum,
        });
      }

      const usdParts = await Promise.all(
        positive.map(async ({ p, balNum, raw, formatted }) => {
          let usdValue: number | null = null;
          if (rpcUrl) {
            try {
              const spot = await chainlinkUsdPerUnit(rpcUrl, p.usdFeed);
              if (spot != null) usdValue = spot * balNum;
            } catch {
              usdValue = null;
            }
          }
          return {
            networkId: network,
            contractAddress: getAddress(p.token).toLowerCase(),
            symbol: p.symbol,
            name: p.label,
            decimals: p.decimals,
            rawBalance: raw,
            formattedBalance: formatted,
            usdValue,
          } satisfies NormalizedTokenBalance;
        }),
      );

      return ok(usdParts);
    },

    async getTransactions({ network, address }) {
      const chainId = etherscanChainIdForNetwork(network);
      if (chainId === undefined) {
        return fail({
          code: "unsupported_network",
          message: `No Etherscan chain id for ${network}.`,
          networkId: network,
        });
      }
      txPageFetchCount = 0;
      const addrLower = address.toLowerCase();
      const errors: LookupError[] = [];

      const [normalRes, internalRes, tokenRes, nftRes] = await Promise.all([
        fetchTxPages(chainId, "txlist", address),
        fetchTxPages(chainId, "txlistinternal", address),
        fetchTxPages(chainId, "tokentx", address),
        fetchTxPages(chainId, "tokennfttx", address),
      ]);

      if (normalRes.error) errors.push({ ...normalRes.error, networkId: network });
      if (internalRes.error) errors.push({ ...internalRes.error, networkId: network });
      if (tokenRes.error) errors.push({ ...tokenRes.error, networkId: network });
      if (nftRes.error) errors.push({ ...nftRes.error, networkId: network });

      const uniqueHashes = new Set<string>();
      for (const row of normalRes.rows) {
        const h = row.hash?.toLowerCase();
        if (h) uniqueHashes.add(h);
      }
      for (const row of internalRes.rows) {
        const h = row.hash?.toLowerCase();
        if (h) uniqueHashes.add(h);
      }
      for (const row of tokenRes.rows) {
        const h = row.hash?.toLowerCase();
        if (h) uniqueHashes.add(h);
      }
      for (const row of nftRes.rows) {
        const h = row.hash?.toLowerCase();
        if (h) uniqueHashes.add(h);
      }

      const listsOk =
        !normalRes.error && !internalRes.error && !tokenRes.error && !nftRes.error;
      const transactionCountComplete =
        listsOk &&
        normalRes.paginationComplete &&
        internalRes.paginationComplete &&
        tokenRes.paginationComplete &&
        nftRes.paginationComplete;

      type Tagged = { kind: "normal" | "internal"; row: EtherscanTxRow };
      const tagged: Tagged[] = [
        ...normalRes.rows.map((row) => ({ kind: "normal" as const, row })),
        ...internalRes.rows.map((row) => ({ kind: "internal" as const, row })),
      ];

      tagged.sort((a, b) => {
        const ba = Number(a.row.blockNumber ?? "0");
        const bb = Number(b.row.blockNumber ?? "0");
        if (bb !== ba) return bb - ba;
        if (a.kind === b.kind) return 0;
        return a.kind === "normal" ? -1 : 1;
      });

      const previewSeen = new Set<string>();
      const txs: NormalizedTransaction[] = [];
      for (const { kind, row } of tagged) {
        const h = row.hash?.toLowerCase();
        if (!h) continue;
        if (previewSeen.has(h)) continue;
        const norm = normalizeEtherscanTx(
          network,
          row,
          addrLower,
          kind === "normal" ? "external" : "internal",
        );
        if (!norm) continue;
        previewSeen.add(h);
        txs.push({ ...norm, hash: h });
        if (txs.length >= PREVIEW_TX_LIMIT) break;
      }

      if (isOnchainLookupTimingEnabled()) {
        console.info(
          JSON.stringify({
            event: "etherscan_tx_pages",
            networkId: network,
            txPageFetchCount,
            maxTxPages,
          }),
        );
      }

      return ok({
        transactions: txs,
        errors,
        uniqueTransactionCount: uniqueHashes.size,
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
            const tx = await jsonRpc<EthTxJson | null>(rpcUrl, "eth_getTransactionByHash", [h]);
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
