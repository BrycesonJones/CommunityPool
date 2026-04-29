import type { Tables } from "@/lib/supabase/database.types";
import { parseStoredSnapshot } from "@/lib/onchain/cache";
import type { NetworkBundle, NormalizedLookupResult } from "@/lib/onchain/types";
import { normalizeBitcoinAddressInput } from "@/lib/onchain/bitcoin-address";

const EVM_ADDR = /^0x[a-fA-F0-9]{40}$/;
const EVM_TX = /^0x[a-fA-F0-9]{64}$/;

/** Etherscan origin for supported chain IDs; null for chains without a public Etherscan (local / unknown). */
function etherscanOriginForChainId(chainId: number): string | null {
  if (chainId === 1) return "https://etherscan.io";
  if (chainId === 11155111) return "https://sepolia.etherscan.io";
  return null;
}

/** Chain-aware Etherscan address URL. Returns null for unsupported chains (e.g. 31337 local). */
export function explorerUrlForChainAddress(
  chainId: number,
  addr: string,
): string | null {
  const origin = etherscanOriginForChainId(chainId);
  if (!origin) return null;
  const trimmed = addr.trim();
  if (!EVM_ADDR.test(trimmed)) return null;
  return `${origin}/address/${trimmed.toLowerCase()}`;
}

/** Chain-aware Etherscan transaction URL. Returns null for unsupported chains or malformed hashes. */
export function explorerUrlForChainTx(
  chainId: number,
  txHash: string | null | undefined,
): string | null {
  if (!txHash) return null;
  const origin = etherscanOriginForChainId(chainId);
  if (!origin) return null;
  const trimmed = txHash.trim();
  if (!EVM_TX.test(trimmed)) return null;
  return `${origin}/tx/${trimmed.toLowerCase()}`;
}

function networkHasBalances(n: NetworkBundle): boolean {
  if (n.nativeBalance) return true;
  return n.tokens.length > 0;
}

/** Etherscan-style origin; unknown network IDs fall back to mainnet. */
function etherscanOrigin(networkId: string | undefined): string {
  if (networkId === "eth-sepolia") return "https://sepolia.etherscan.io";
  return "https://etherscan.io";
}

function firstNetworkIdWithBalances(parsed: NormalizedLookupResult): string | undefined {
  for (const n of parsed.networks) {
    if (networkHasBalances(n)) return n.networkId;
  }
  return undefined;
}

export function explorerUrlForUserAddressRow(
  row: Pick<Tables<"user_address_balances">, "address_id" | "onchain_snapshot">,
): string | null {
  const id = row.address_id.trim();
  const btcAddress = normalizeBitcoinAddressInput(id);

  if (btcAddress) {
    return `https://mempool.space/address/${encodeURIComponent(btcAddress)}`;
  }

  const parsed = parseStoredSnapshot(row.onchain_snapshot);

  if (EVM_TX.test(id)) {
    const nid = parsed?.resolvedTx?.networkId;
    const origin = etherscanOrigin(nid);
    return `${origin}/tx/${id.toLowerCase()}`;
  }

  if (EVM_ADDR.test(id)) {
    const nid = parsed ? firstNetworkIdWithBalances(parsed) : undefined;
    const origin = etherscanOrigin(nid);
    return `${origin}/address/${id.toLowerCase()}`;
  }

  return null;
}
