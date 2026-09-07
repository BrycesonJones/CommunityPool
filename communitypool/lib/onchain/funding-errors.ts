/**
 * Safe, user-facing classification of funding failures.
 *
 * Wallet and provider exceptions carry calldata, nested provider objects and stack traces. The
 * Phase 2.8 production smoke test rendered one verbatim into the funding modal — several hundred
 * characters of `execution reverted (unknown custom error) … data="0x13be252b" … transaction={…}`.
 * That tells a user nothing and leaks internals into the UI.
 *
 * Known reverts are matched on their 4-byte selector, which is stable, rather than on message
 * text. Anything unrecognised falls back to a generic sentence; the raw detail belongs in the
 * security-event pipeline, which already redacts.
 */

/** Selectors seen from the tokens and contracts this app touches. */
const REVERT_SELECTORS = {
  /** PAX Gold's own error; raised when `transferFrom` exceeds the spender's allowance. */
  paxgInsufficientAllowance: "0x13be252b",
  /** OpenZeppelin v5 ERC20. */
  erc20InsufficientAllowance: "0xfb8f41b2",
  erc20InsufficientBalance: "0xe450d38c",
  /** SafeERC20 wrapper failure. */
  safeErc20FailedOperation: "0x5274afe7",
  communityPoolBelowMinimumUsd: "0x4a72670c",
  communityPoolTokenNotWhitelisted: "0x2f9a5459",
  communityPoolPoolExpired: "0x1668c223",
  communityPoolUnsupportedTokenBehavior: "0x3d9ef63e",
  communityPoolProtocolFeeTransferFailed: "0xf88289bb",
  priceConverterStalePrice: "0x633227f5",
  priceConverterInvalidPrice: "0x2bcaf7fb",
} as const;

export type FundingErrorKind =
  | "user_rejected"
  | "insufficient_allowance"
  | "insufficient_balance"
  | "below_minimum"
  | "token_not_accepted"
  | "pool_expired"
  | "price_unavailable"
  | "fee_unavailable"
  | "token_unsupported"
  | "failed";

export type ClassifiedFundingError = {
  kind: FundingErrorKind;
  /** Shown to the user. Contains no calldata, addresses or provider internals. */
  message: string;
};

/** Pull a revert selector out of the many shapes ethers/wallets use. */
function revertSelector(e: unknown): string | null {
  const seen = new Set<unknown>();
  const walk = (node: unknown, depth: number): string | null => {
    if (node === null || node === undefined || depth > 6 || seen.has(node)) return null;
    if (typeof node === "string") {
      const m = node.match(/0x[0-9a-fA-F]{8,}/);
      return m ? m[0].slice(0, 10).toLowerCase() : null;
    }
    if (typeof node !== "object") return null;
    seen.add(node);
    const rec = node as Record<string, unknown>;
    for (const key of ["data", "error", "info", "cause", "revert"]) {
      const found = walk(rec[key], depth + 1);
      if (found) return found;
    }
    return null;
  };
  return walk(e, 0);
}

function isUserRejection(e: unknown): boolean {
  const rec = e as { code?: unknown; message?: unknown; info?: { error?: { code?: unknown } } };
  if (rec?.code === "ACTION_REJECTED" || rec?.code === 4001) return true;
  if (rec?.info?.error?.code === 4001) return true;
  const msg = typeof rec?.message === "string" ? rec.message.toLowerCase() : "";
  return msg.includes("user rejected") || msg.includes("user denied");
}

/**
 * @param stage Which wallet step failed, so a rejection names the right one.
 * @param assetLabel Token symbol, when the failure is asset-specific.
 */
export function classifyFundingError(
  e: unknown,
  stage: "approval" | "funding",
  assetLabel?: string,
): ClassifiedFundingError {
  const asset = assetLabel ?? "this token";
  if (isUserRejection(e)) {
    return {
      kind: "user_rejected",
      message:
        stage === "approval"
          ? "You cancelled the approval in your wallet. Nothing was sent."
          : "You cancelled the funding transaction in your wallet. Nothing was sent.",
    };
  }
  const selector = revertSelector(e);
  switch (selector) {
    case REVERT_SELECTORS.paxgInsufficientAllowance:
    case REVERT_SELECTORS.erc20InsufficientAllowance:
      return {
        kind: "insufficient_allowance",
        message: `The spending cap you approved for ${asset} is smaller than the amount being funded. Approve at least the funding amount, then try again.`,
      };
    case REVERT_SELECTORS.erc20InsufficientBalance:
      return {
        kind: "insufficient_balance",
        message: `Your wallet does not hold enough ${asset} for this contribution.`,
      };
    case REVERT_SELECTORS.communityPoolBelowMinimumUsd:
      return {
        kind: "below_minimum",
        message:
          "The price moved and this contribution is now below the pool's minimum. Go back and review a fresh amount.",
      };
    case REVERT_SELECTORS.communityPoolTokenNotWhitelisted:
      return {
        kind: "token_not_accepted",
        message: `This pool does not accept ${asset}.`,
      };
    case REVERT_SELECTORS.communityPoolPoolExpired:
      return { kind: "pool_expired", message: "This pool has expired and can no longer be funded." };
    case REVERT_SELECTORS.priceConverterStalePrice:
    case REVERT_SELECTORS.priceConverterInvalidPrice:
      return {
        kind: "price_unavailable",
        message:
          "The price feed this pool uses is not currently reporting a fresh price, so the contribution was refused. Try again shortly.",
      };
    case REVERT_SELECTORS.communityPoolProtocolFeeTransferFailed:
      return {
        kind: "fee_unavailable",
        message: "The protocol fee could not be delivered, so the contribution was refused.",
      };
    case REVERT_SELECTORS.communityPoolUnsupportedTokenBehavior:
    case REVERT_SELECTORS.safeErc20FailedOperation:
      return {
        kind: "token_unsupported",
        message: `${asset} did not transfer exactly the amount requested, so the contribution was refused and nothing moved.`,
      };
    default:
      return {
        kind: "failed",
        message:
          stage === "approval"
            ? "The approval transaction failed. Nothing was sent."
            : "The funding transaction failed. Nothing was sent.",
      };
  }
}

/** Raised before any transaction when an approved cap is smaller than the confirmed amount. */
export class AllowanceBelowAmountError extends Error {
  readonly allowance: bigint;
  readonly required: bigint;
  constructor(allowance: bigint, required: bigint) {
    super("Approved spending cap is below the funding amount.");
    this.name = "AllowanceBelowAmountError";
    this.allowance = allowance;
    this.required = required;
  }
}
