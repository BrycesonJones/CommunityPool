import type {
  LookupInput,
  LookupError,
  NormalizedTransaction,
} from "../types";
import type { ProviderAdapter } from "./provider-adapter";
import { fail, ok } from "./provider-adapter";
import { formatAtomicToDecimal } from "../normalize";

const BTC_NETWORK = "bitcoin-mainnet";
const BTC_DECIMALS = 8;
const MAX_TX_RETURN = 40;

export type BitcoinAdapterConfig = {
  /** Esplora-compatible base origin (e.g. https://mempool.space or .../api). */
  baseUrl: string;
};

type AddrStatsJson = {
  chain_stats?: {
    funded_txo_sum?: unknown;
    spent_txo_sum?: unknown;
    /** Confirmed on-chain tx count for this address (mempool.space / Esplora). */
    tx_count?: unknown;
  };
  mempool_stats?: {
    funded_txo_sum?: unknown;
    spent_txo_sum?: unknown;
  };
};

type MempoolTxStatus = {
  confirmed?: boolean;
  block_height?: number;
  block_time?: number;
};

type MempoolVin = {
  prevout?: {
    scriptpubkey_address?: string;
    value?: number;
  } | null;
};

type MempoolVout = {
  scriptpubkey_address?: string;
  value?: number;
};

type MempoolTxJson = {
  txid?: string;
  status?: MempoolTxStatus;
  firstSeen?: number;
  vin?: MempoolVin[];
  vout?: MempoolVout[];
};

function httpError(
  status: number,
  detail?: string,
): LookupError {
  return {
    code: "provider_http_error",
    message: `Mempool HTTP ${status}${detail ? `: ${detail}` : ""}`,
    networkId: BTC_NETWORK,
  };
}

function toSatBigInt(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return BigInt(v.trim());
  if (typeof v === "number" && Number.isFinite(v)) {
    if (Number.isSafeInteger(v)) return BigInt(v);
    return BigInt(Math.trunc(v));
  }
  return 0n;
}

function balanceSatsFromStats(stats: AddrStatsJson): bigint {
  const chain = stats.chain_stats ?? {};
  const mempool = stats.mempool_stats ?? {};
  const chainNet =
    toSatBigInt(chain.funded_txo_sum) - toSatBigInt(chain.spent_txo_sum);
  const mempoolNet =
    toSatBigInt(mempool.funded_txo_sum) - toSatBigInt(mempool.spent_txo_sum);
  return chainNet + mempoolNet;
}

async function fetchJson<T>(
  url: string,
): Promise<{ ok: true; data: T } | { ok: false; status: number; body: string }> {
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, body: text.slice(0, 200) };
  }
  try {
    return { ok: true, data: JSON.parse(text) as T };
  } catch {
    return { ok: false, status: res.status, body: "invalid JSON" };
  }
}

async function fetchBtcUsd(baseUrl: string): Promise<number | null> {
  const url = `${baseUrl}/v1/prices`;
  const parsed = await fetchJson<{ USD?: number }>(url);
  if (!parsed.ok) return null;
  const n = parsed.data.USD;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  return n;
}

function netSatsForAddress(tx: MempoolTxJson, watched: string): bigint {
  let receives = 0n;
  let sends = 0n;
  for (const o of tx.vout ?? []) {
    if (o.scriptpubkey_address === watched && typeof o.value === "number") {
      receives += toSatBigInt(o.value);
    }
  }
  for (const i of tx.vin ?? []) {
    const prev = i.prevout;
    if (prev?.scriptpubkey_address === watched && typeof prev.value === "number") {
      sends += toSatBigInt(prev.value);
    }
  }
  return receives - sends;
}

function normalizeMempoolTx(
  tx: MempoolTxJson,
  watched: string,
): NormalizedTransaction | null {
  const hash = tx.txid;
  if (!hash) return null;

  const net = netSatsForAddress(tx, watched);
  const absNet = net < 0n ? -net : net;
  const valueNativeDecimal = formatAtomicToDecimal(absNet.toString(), BTC_DECIMALS);

  let direction: NormalizedTransaction["direction"] = "unknown";
  if (net > 0n) direction = "in";
  else if (net < 0n) direction = "out";
  else direction = "unknown";

  const st = tx.status;
  let timestamp: string | null = null;
  if (st?.block_time != null) {
    timestamp = String(st.block_time);
  } else if (tx.firstSeen != null) {
    timestamp = String(tx.firstSeen);
  }

  let blockNumber: string | undefined;
  if (st?.confirmed && st.block_height != null) {
    blockNumber = String(st.block_height);
  }

  let counterparty: string | null = null;
  if (direction === "in") {
    for (const i of tx.vin ?? []) {
      const from = i.prevout?.scriptpubkey_address;
      if (from && from !== watched) {
        counterparty = from;
        break;
      }
    }
  } else if (direction === "out") {
    for (const o of tx.vout ?? []) {
      const to = o.scriptpubkey_address;
      if (to && to !== watched) {
        counterparty = to;
        break;
      }
    }
  }

  return {
    networkId: BTC_NETWORK,
    hash,
    blockNumber,
    timestamp,
    direction,
    counterparty,
    valueNativeDecimal,
    symbol: "BTC",
    rawRef: null,
  };
}

/**
 * Bitcoin chain adapter via mempool.space (or any Esplora-compatible) REST API.
 */
export function createBitcoinAdapter(config: BitcoinAdapterConfig): ProviderAdapter {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const apiBase = baseUrl.endsWith("/api") ? baseUrl : `${baseUrl}/api`;

  type BtcPreloadCtx = {
    address: string;
    statsRes: Awaited<ReturnType<typeof fetchJson<AddrStatsJson>>>;
    usdPerBtc: number | null;
  };

  let preloadCtx: BtcPreloadCtx | null = null;

  return {
    id: "bitcoin",

    supports(input: LookupInput) {
      return input.chainFamily === "bitcoin" && input.kind === "btc_address";
    },

    async preloadAddressContext(address: string) {
      const statsUrl = `${apiBase}/address/${encodeURIComponent(address)}`;
      const [statsRes, usdPerBtc] = await Promise.all([
        fetchJson<AddrStatsJson>(statsUrl),
        fetchBtcUsd(apiBase),
      ]);
      preloadCtx = { address, statsRes, usdPerBtc };
    },

    async getNativeBalance({ network, address }) {
      if (network !== BTC_NETWORK) {
        return fail({
          code: "unsupported_network",
          message: `Bitcoin adapter only supports ${BTC_NETWORK}.`,
          networkId: network,
        });
      }

      const fromPreload =
        preloadCtx?.address === address ? preloadCtx.statsRes : undefined;
      const res =
        fromPreload !== undefined
          ? fromPreload
          : await fetchJson<AddrStatsJson>(
              `${apiBase}/address/${encodeURIComponent(address)}`,
            );
      if (!res.ok) {
        return fail(httpError(res.status, res.body));
      }

      const balanceSats = balanceSatsFromStats(res.data);
      const rawBalance = balanceSats.toString();
      const formattedBalance = formatAtomicToDecimal(rawBalance, BTC_DECIMALS);

      const usdPerBtc =
        preloadCtx?.address === address && preloadCtx.usdPerBtc != null
          ? preloadCtx.usdPerBtc
          : await fetchBtcUsd(apiBase);
      let usdValue: number | null | undefined;
      if (usdPerBtc != null) {
        const btcFloat = Number.parseFloat(formattedBalance);
        if (Number.isFinite(btcFloat)) {
          usdValue = btcFloat * usdPerBtc;
        }
      }

      return ok({
        network: BTC_NETWORK,
        symbol: "BTC",
        rawBalance,
        formattedBalance,
        decimals: BTC_DECIMALS,
        usdValue,
      });
    },

    async getTokenBalances() {
      return ok([]);
    },

    async getTransactions({ network, address }) {
      if (network !== BTC_NETWORK) {
        return fail({
          code: "unsupported_network",
          message: `Bitcoin adapter only supports ${BTC_NETWORK}.`,
          networkId: network,
        });
      }

      const enc = encodeURIComponent(address);
      const statsFromPreload =
        preloadCtx?.address === address ? preloadCtx.statsRes : undefined;
      const statsRes =
        statsFromPreload !== undefined
          ? statsFromPreload
          : await fetchJson<AddrStatsJson>(`${apiBase}/address/${enc}`);
      let chainTxCount: number | undefined;
      if (statsRes.ok) {
        const raw = statsRes.data.chain_stats?.tx_count;
        if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
          chainTxCount = Math.floor(raw);
        }
      }

      const transactions: NormalizedTransaction[] = [];
      const seenTxids = new Set<string>();
      let afterTxid: string | undefined;

      while (transactions.length < MAX_TX_RETURN) {
        const path = `${apiBase}/address/${enc}/txs`;
        const url = afterTxid
          ? `${path}/chain/${encodeURIComponent(afterTxid)}`
          : path;
        const page = await fetchJson<MempoolTxJson[]>(url);
        if (!page.ok) {
          return fail(httpError(page.status, page.body));
        }
        const rows = Array.isArray(page.data) ? page.data : [];
        if (rows.length === 0) break;

        let addedThisPage = 0;
        for (const tx of rows) {
          const tid = tx.txid;
          if (!tid || seenTxids.has(tid)) continue;
          seenTxids.add(tid);
          const norm = normalizeMempoolTx(tx, address);
          if (norm) {
            transactions.push(norm);
            addedThisPage += 1;
          }
          if (transactions.length >= MAX_TX_RETURN) break;
        }

        if (addedThisPage === 0) break;

        const last = rows[rows.length - 1];
        const lastId = last?.txid;
        if (!lastId || lastId === afterTxid) break;
        afterTxid = lastId;
      }

      const transactionCountComplete = chainTxCount !== undefined;
      const uniqueTransactionCount =
        chainTxCount ?? transactions.length;

      return ok({
        transactions,
        errors: [],
        uniqueTransactionCount,
        transactionCountComplete,
      });
    },

    async resolveTransaction() {
      return ok(null);
    },
  };
}
