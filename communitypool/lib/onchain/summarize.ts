import type { NormalizedLookupResult } from "./types";

export function summarizeLookupUsd(
  result: NormalizedLookupResult,
): number | null {
  let total = 0;
  let any = false;
  for (const n of result.networks) {
    const nb = n.nativeBalance;
    if (nb?.usdValue != null) {
      total += nb.usdValue;
      any = true;
    }
    for (const t of n.tokens) {
      if (t.usdValue != null) {
        total += t.usdValue;
        any = true;
      }
    }
  }
  return any ? total : null;
}
