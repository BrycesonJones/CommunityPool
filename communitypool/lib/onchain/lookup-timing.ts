/**
 * Opt-in server timing for `runOnchainLookup` (set `ONCHAIN_LOOKUP_TIMING=1`).
 */
export function isOnchainLookupTimingEnabled(): boolean {
  return process.env.ONCHAIN_LOOKUP_TIMING === "1";
}

export function createLookupTimer() {
  const t0 = performance.now();
  const marks: Record<string, number> = {};
  return {
    mark(name: string) {
      marks[name] = Math.round(performance.now() - t0);
    },
    elapsedMs() {
      return Math.round(performance.now() - t0);
    },
    marks,
  };
}

export function logLookupTiming(payload: Record<string, unknown>) {
  if (!isOnchainLookupTimingEnabled()) return;
  console.info(JSON.stringify({ event: "onchain_lookup_timing", ...payload }));
}
