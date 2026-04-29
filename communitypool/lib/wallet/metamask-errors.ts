/**
 * Wallet-agnostic JSON-RPC / EIP-1193 error helpers.
 *
 * Kept under the `metamask-errors` filename for backwards compatibility with
 * existing imports. The helpers apply equally to MetaMask, Coinbase Wallet,
 * Binance Web3 Wallet, and any other EIP-1193 provider.
 */

export function getProviderErrorCode(error: unknown): number | undefined {
  if (error && typeof error === "object") {
    const o = error as Record<string, unknown>;
    const direct = o.code;
    if (typeof direct === "number") return direct;
    if (typeof direct === "string" && /^-?\d+$/.test(direct)) {
      return Number(direct);
    }

    const info = o.info;
    if (info && typeof info === "object") {
      const nested = (info as Record<string, unknown>).error;
      if (nested && typeof nested === "object") {
        const c = (nested as Record<string, unknown>).code;
        if (typeof c === "number") return c;
        if (typeof c === "string" && /^-?\d+$/.test(c)) return Number(c);
      }
    }
  }
  return undefined;
}

/**
 * User-facing copy for known EIP-1193 / JSON-RPC error codes.
 * `walletLabel` personalises the message (defaults to "wallet") so the
 * same helper can serve MetaMask, Coinbase, Binance, and future wallets.
 */
export function messageForProviderError(
  error: unknown,
  walletLabel = "wallet",
): string {
  const code = getProviderErrorCode(error);
  switch (code) {
    case 4001:
      return `Request was rejected in ${walletLabel}.`;
    case -32002:
      return `A ${walletLabel} request is already open. Finish or close it, then try again.`;
    case -32603:
      return `${capitalize(walletLabel)} reported an internal error. Try again or restart the extension.`;
    default:
      if (error instanceof Error && error.message) return error.message;
      return `Something went wrong connecting to ${walletLabel}.`;
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
