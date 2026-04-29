export const ETHERSCAN_V2_BASE = "https://api.etherscan.io/v2/api";

/** Etherscan account `txlist` / `txlistinternal` row (subset). */
export type EtherscanTxRow = {
  blockNumber?: string;
  timeStamp?: string;
  hash?: string;
  from?: string;
  to?: string;
  value?: string;
  traceId?: string;
};

type EtherscanJson = {
  status?: string;
  message?: string;
  result?: unknown;
};

function isBenignEmptyMessage(result: string): boolean {
  const s = result.toLowerCase();
  return (
    s.includes("no transactions") ||
    s.includes("no records found") ||
    s === "[]"
  );
}

export function etherscanResultToArray(result: unknown): unknown[] | null {
  if (Array.isArray(result)) return result;
  if (typeof result === "string") {
    if (isBenignEmptyMessage(result)) return [];
    try {
      const parsed = JSON.parse(result) as unknown;
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * When `status` is `"0"`, distinguish API errors from empty lists / string messages.
 */
export function etherscanIsHardError(json: EtherscanJson): string | null {
  if (json.status !== "0") return null;
  const arr = etherscanResultToArray(json.result);
  if (arr !== null) return null;
  const r = json.result;
  if (typeof r === "string") {
    if (isBenignEmptyMessage(r)) return null;
    const low = r.toLowerCase();
    if (low.includes("rate limit") || low.includes("max rate")) {
      return r;
    }
    return r || json.message || "Etherscan NOTOK";
  }
  return json.message || "Etherscan NOTOK";
}

export function createEtherscanV2Client(options: {
  apiKey: string;
  /** Minimum spacing between completed HTTP requests (default 350ms ≈ free tier). */
  minIntervalMs?: number;
}) {
  const apiKey = options.apiKey.trim();
  const minIntervalMs = options.minIntervalMs ?? 350;
  let lastEnd = 0;
  let queue: Promise<unknown> = Promise.resolve();

  function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = queue.then(async () => {
      const now = Date.now();
      const wait = Math.max(0, lastEnd + minIntervalMs - now);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      try {
        return await fn();
      } finally {
        lastEnd = Date.now();
      }
    });
    queue = run.catch(() => undefined);
    return run as Promise<T>;
  }

  function get(searchParams: Record<string, string>): Promise<EtherscanJson> {
    return enqueue(async () => {
      const url = new URL(ETHERSCAN_V2_BASE);
      url.searchParams.set("apikey", apiKey);
      for (const [k, v] of Object.entries(searchParams)) {
        url.searchParams.set(k, v);
      }
      const res = await fetch(url.toString(), { cache: "no-store" });
      const json = (await res.json()) as EtherscanJson;
      return json;
    });
  }

  return { get };
}

export type EtherscanV2Client = ReturnType<typeof createEtherscanV2Client>;
