import { NextResponse } from "next/server";
import { getAddress, isAddress } from "ethers";
import { readPoolOnChainBalances } from "@/lib/onchain/pool-balances";
import { getServerReadOnlyProviderForChain } from "@/lib/onchain/server-providers";
import {
  enforceRateLimits,
  getClientIp,
} from "@/lib/security/rate-limit";
import { publicErrorResponse } from "@/lib/security/public-error";

/**
 * `GET /api/pools/balances?chainId=<n>&address=<0x...>`
 *
 * Server-side chain read used by `PoolActivityProvider` when no wallet is
 * connected (or the wallet is on a different chain). Relies on the server's
 * Alchemy RPC credentials (`ALCHEMY_API_KEY` / `ALCHEMY_API_URL_ETH_*`) so
 * the Open Pools table reflects actual on-chain balances even for visitors
 * viewing public pools without a wallet.
 *
 * Response body is the `PoolOnChainBalances` shape with `bigint` fields
 * serialized as decimal strings (`raw`). Callers cast back to `bigint`.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const chainIdRaw = searchParams.get("chainId");
  const address = searchParams.get("address");

  const chainId = chainIdRaw ? Number(chainIdRaw) : Number.NaN;
  if (!Number.isFinite(chainId) || chainId <= 0) {
    return NextResponse.json(
      { error: "chainId query param is required and must be a positive integer" },
      { status: 400 },
    );
  }
  if (!address || !isAddress(address)) {
    return NextResponse.json(
      { error: "address query param is required and must be a valid EVM address" },
      { status: 400 },
    );
  }
  const normalizedAddress = getAddress(address);

  // Public endpoint: limit each IP overall, then add a tighter per-pool cap so
  // one IP can't pin the entire chain-read budget on a single pool.
  const ip = getClientIp(request);
  const limited = await enforceRateLimits([
    { name: "pool_balances_ip", identifier: ip },
    {
      name: "pool_balances_address",
      identifier: `${ip}:${chainId}:${normalizedAddress.toLowerCase()}`,
    },
  ]);
  if (limited) return limited;

  const provider = getServerReadOnlyProviderForChain(chainId);
  if (!provider) {
    return NextResponse.json(
      {
        error: `No server-side RPC configured for chainId ${chainId}. Set ALCHEMY_API_KEY or ALCHEMY_API_URL_ETH_<network>.`,
      },
      { status: 503 },
    );
  }

  try {
    const balances = await readPoolOnChainBalances(provider, chainId, address);
    return NextResponse.json({
      pool: balances.pool,
      chainId: balances.chainId,
      blockNumber: balances.blockNumber,
      nativeEth: {
        ...balances.nativeEth,
        raw: balances.nativeEth.raw.toString(),
      },
      tokens: balances.tokens.map((t) => ({
        ...t,
        raw: t.raw.toString(),
      })),
      totalUsd: balances.totalUsd,
      readAt: balances.readAt,
    });
  } catch (err) {
    return publicErrorResponse(err, "Unable to fetch pool balances", 502);
  }
}
