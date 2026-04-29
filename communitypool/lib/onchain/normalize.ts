import type {
  LookupError,
  NormalizedNativeBalance,
  NormalizedTokenBalance,
  NormalizedTransaction,
} from "./types";

export function formatAtomicToDecimal(atomic: string, decimals: number): string {
  const s = atomic.trim();
  let bi: bigint;
  try {
    bi = BigInt(s.startsWith("0x") || s.startsWith("0X") ? s : s);
  } catch {
    return "0";
  }
  if (decimals < 0) return "0";
  const base = BigInt(10) ** BigInt(decimals);
  const whole = bi / base;
  const frac = bi % base;
  if (decimals === 0) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  if (!fracStr) return whole.toString();
  return `${whole.toString()}.${fracStr}`;
}

export function pickUsd(
  prices: { currency: string; value: string }[] | undefined,
): number | null {
  const usd = prices?.find((p) => p.currency?.toLowerCase() === "usd");
  if (!usd) return null;
  const n = Number(usd.value);
  return Number.isFinite(n) ? n : null;
}

export function isNativeTokenAddress(tokenAddress: string | null | undefined): boolean {
  const a = tokenAddress;
  return a == null || a === "";
}

export function alchemyTokenRowToNative(
  net: string,
  row: {
    tokenBalance?: string;
    tokenMetadata?: { decimals?: number; symbol?: string } | null;
    tokenPrices?: { currency: string; value: string }[];
  },
): NormalizedNativeBalance | null {
  const raw = String(row.tokenBalance ?? "0");
  const decimals = row.tokenMetadata?.decimals ?? 18;
  const formatted = formatAtomicToDecimal(raw, decimals);
  const balNum = Number(formatted);
  if (!Number.isFinite(balNum) || balNum <= 0) return null;
  const usdUnit = pickUsd(row.tokenPrices);
  const symbol = row.tokenMetadata?.symbol ?? "ETH";
  return {
    network: net,
    symbol,
    rawBalance: raw,
    formattedBalance: formatted,
    decimals,
    usdValue: usdUnit != null ? usdUnit * balNum : null,
  };
}

export function alchemyTokenRowToErc20(
  net: string,
  row: {
    tokenAddress?: string | null;
    tokenBalance?: string;
    tokenMetadata?: {
      decimals?: number;
      name?: string;
      symbol?: string;
    } | null;
    tokenPrices?: { currency: string; value: string }[];
  },
): NormalizedTokenBalance | null {
  const raw = String(row.tokenBalance ?? "0");
  const decimals = row.tokenMetadata?.decimals ?? 18;
  const formatted = formatAtomicToDecimal(raw, decimals);
  const balNum = Number(formatted);
  if (!Number.isFinite(balNum) || balNum <= 0) return null;
  const usdUnit = pickUsd(row.tokenPrices);
  return {
    networkId: net,
    contractAddress: (row.tokenAddress ?? "").toLowerCase(),
    symbol: row.tokenMetadata?.symbol ?? "TOKEN",
    name: row.tokenMetadata?.name ?? null,
    decimals,
    rawBalance: raw,
    formattedBalance: formatted,
    usdValue: usdUnit != null ? usdUnit * balNum : null,
  };
}

export type AssetTransferLike = {
  blockNum?: string;
  hash?: string;
  from?: string;
  to?: string;
  value?: number | null;
  asset?: string | null;
  category?: string;
  rawContract?: { value?: string | null; decimal?: string | null };
};

export function assetTransferToNormalized(
  networkId: string,
  t: AssetTransferLike,
  watchedAddressLower: string,
): NormalizedTransaction | null {
  const h = t.hash;
  if (!h) return null;
  const from = (t.from ?? "").toLowerCase();
  const to = (t.to ?? "").toLowerCase();
  let direction: NormalizedTransaction["direction"] = "unknown";
  if (from === watchedAddressLower && to === watchedAddressLower) {
    direction = "unknown";
  } else if (from === watchedAddressLower) direction = "out";
  else if (to === watchedAddressLower) direction = "in";

  const valueStr =
    t.value != null && Number.isFinite(t.value)
      ? String(t.value)
      : t.rawContract?.value ?? null;

  return {
    networkId,
    hash: h,
    blockNumber: t.blockNum,
    timestamp: null,
    direction,
    counterparty:
      direction === "out"
        ? t.to ?? null
        : direction === "in"
          ? t.from ?? null
          : null,
    valueNativeDecimal: valueStr,
    symbol: t.asset ?? null,
    rawRef: t.category ?? null,
  };
}

export type AdapterResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: LookupError };
