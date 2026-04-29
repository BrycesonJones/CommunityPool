import {
  Contract,
  formatUnits,
  getAddress,
  type BrowserProvider,
  type JsonRpcProvider,
} from "ethers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StoredOpenPool } from "@/lib/pools/open-pools-storage";
import type { Database, Json, Tables, TablesInsert } from "@/lib/supabase/database.types";
import {
  explorerUrlForChainAddress,
  explorerUrlForChainTx,
} from "@/lib/onchain/explorer-urls";
import {
  primaryAssetBalanceFor,
  type PoolOnChainBalances,
} from "@/lib/onchain/pool-balances";

export type PoolActivityKind = "deploy" | "fund" | "withdraw";

/**
 * Normalized row for the Open Pools table (parity with Public Address
 * Information). Core DB primitives (`pool_address`, `chain_id`) are exposed
 * under UI-facing aliases (`contractAddress`) and explorer URLs are derived
 * from `(chain_id, pool_address | deploy_tx_hash | fund_tx_hash)` — never
 * stored.
 *
 * Source of truth for financial fields:
 *   - `fundedAmountHuman` = current on-chain balance of the primary asset
 *     (the `asset_type` chosen at deploy). For ETH pools this is
 *     `provider.getBalance(pool)` formatted to 18 decimals; for ERC20 pools
 *     this is `balanceOf(pool) / 10^decimals`. NOT the deploy-time deposit.
 *   - `balanceUsd` / `totalUsd` = aggregate USD of every whitelisted asset
 *     held by the pool (native ETH + every ERC20), priced via Chainlink.
 *     Matches pool TVL.
 *
 * When rendered without a chain read (logged-out local storage, or a pool on
 * a chain the app cannot currently reach), these fall back to the last
 * persisted cache, which is itself refreshed from chain after every
 * deploy/fund/withdraw.
 */
export type PoolCardView = {
  id: string;
  name: string;
  description: string;
  address: string;
  /** Alias of `address`/`pool_address` for UI-facing code. */
  contractAddress: string;
  chainId: number;
  expiresAtUnix: number;
  totalUsd: number;
  /** Alias of `totalUsd` = pool TVL in USD (sum of all on-chain assets). */
  balanceUsd: number;
  lastActivity: PoolActivityKind;
  minimumUsdDisplay: string;
  segment: "open" | "closed";
  assetType: string;
  /** Current on-chain balance of the primary asset (see type-level doc). */
  fundedAmountHuman: string;
  deployTxHash: string | null;
  fundTxHash: string | null;
  fundingStatus: "funding_pending" | "funded" | "funding_failed" | null;
  explorerAddressUrl: string | null;
  explorerDeployTxUrl: string | null;
  explorerFundTxUrl: string | null;
};

const POOL_READ_ABI = [
  "function expiresAt() view returns (uint64)",
  "function minimumUsd() view returns (uint256)",
] as const;

/**
 * Pool name and description are not stored on-chain — they're only emitted in
 * the `PoolCreated` event at deploy and otherwise live in Supabase / local
 * storage. Callers that need them should fall back to their own form/row state
 * when refreshing this snapshot.
 */
export type OnChainPoolSnapshot = {
  expiresAtUnix: number;
  minimumUsdWei: string;
};

export async function readPoolSnapshotFromChain(
  provider: BrowserProvider | JsonRpcProvider,
  poolAddress: string,
): Promise<OnChainPoolSnapshot> {
  const c = new Contract(getAddress(poolAddress), POOL_READ_ABI, provider);
  const [expiresAt, minimumUsd] = await Promise.all([
    c.expiresAt() as Promise<bigint>,
    c.minimumUsd() as Promise<bigint>,
  ]);
  return {
    expiresAtUnix: Number(expiresAt),
    minimumUsdWei: minimumUsd.toString(),
  };
}

export function formatMinimumUsdWeiForCard(wei: string | null | undefined): string {
  if (wei == null || wei === "") return "—";
  try {
    return formatUnits(BigInt(wei), 18);
  } catch {
    return "—";
  }
}

export function poolCardFromRow(
  row: Tables<"user_pool_activity">,
  nowSec: number,
): PoolCardView {
  const segment: "open" | "closed" =
    row.expires_at_unix > nowSec ? "open" : "closed";
  const last = row.last_activity;
  const lastActivity: PoolActivityKind =
    last === "fund" || last === "withdraw" || last === "deploy"
      ? last
      : "deploy";
  const chainId = Number(row.chain_id);
  const totalUsd =
    row.total_usd_estimate != null ? Number(row.total_usd_estimate) : 0;
  const deployTxHash = row.deploy_tx_hash ?? null;
  const fundTxHash = row.fund_tx_hash ?? null;
  const fundingStatus = readFundingStatus(row.metadata);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    address: row.pool_address,
    contractAddress: row.pool_address,
    chainId,
    expiresAtUnix: row.expires_at_unix,
    totalUsd,
    balanceUsd: totalUsd,
    lastActivity,
    minimumUsdDisplay: formatMinimumUsdWeiForCard(row.minimum_usd_wei),
    segment,
    assetType: row.asset_type ?? "",
    fundedAmountHuman: row.funded_amount_human ?? "",
    deployTxHash,
    fundTxHash,
    fundingStatus,
    explorerAddressUrl: explorerUrlForChainAddress(chainId, row.pool_address),
    explorerDeployTxUrl: explorerUrlForChainTx(chainId, deployTxHash),
    explorerFundTxUrl: explorerUrlForChainTx(chainId, fundTxHash),
  };
}

/**
 * Overlay fresh on-chain balances onto a card. The card's `assetType` pins the
 * primary asset for the "Amount" column; "Balance (USD)" becomes the aggregate
 * across all whitelisted assets. Cached/stored values on `card` are discarded
 * in favor of the chain-derived ones.
 */
export function applyOnChainBalancesToCard(
  card: PoolCardView,
  balances: PoolOnChainBalances,
): PoolCardView {
  const primary = primaryAssetBalanceFor(balances, card.assetType);
  return {
    ...card,
    assetType: card.assetType || primary.symbol,
    fundedAmountHuman: primary.human,
    totalUsd: balances.totalUsd,
    balanceUsd: balances.totalUsd,
  };
}

export function partitionOpenClosed(cards: PoolCardView[]): {
  open: PoolCardView[];
  closed: PoolCardView[];
} {
  const open = cards
    .filter((c) => c.segment === "open")
    .sort((a, b) => b.expiresAtUnix - a.expiresAtUnix);
  const closed = cards
    .filter((c) => c.segment === "closed")
    .sort((a, b) => b.expiresAtUnix - a.expiresAtUnix);
  return { open, closed };
}

export function rowsToCards(
  rows: Tables<"user_pool_activity">[],
  nowSec: number,
): PoolCardView[] {
  return rows.map((r) => poolCardFromRow(r, nowSec));
}

/** Logged-out localStorage rows: unknown expiry keeps the pool in Open. */
export function poolCardsFromLocal(rows: StoredOpenPool[], nowSec: number): PoolCardView[] {
  return rows.map((s) => {
    const exp = s.expiresAtUnix ?? Number.MAX_SAFE_INTEGER;
    const segment: "open" | "closed" = exp > nowSec ? "open" : "closed";
    const last = s.lastActivity ?? "deploy";
    const lastActivity: PoolActivityKind =
      last === "fund" || last === "withdraw" ? last : "deploy";
    const deployTxHash = s.deployTxHash ?? null;
    const fundTxHash = s.fundTxHash ?? null;
    return {
      id: s.id,
      name: s.name,
      description: s.description ?? "",
      address: s.address,
      contractAddress: s.address,
      chainId: s.chainId,
      expiresAtUnix: exp,
      totalUsd: s.totalUsd,
      balanceUsd: s.totalUsd,
      lastActivity,
      minimumUsdDisplay: formatMinimumUsdWeiForCard(s.minimumUsdWei),
      segment,
      assetType: s.assetType ?? "",
      fundedAmountHuman: s.fundedAmountHuman ?? "",
      deployTxHash,
      fundTxHash,
      fundingStatus: s.fundingStatus ?? null,
      explorerAddressUrl: explorerUrlForChainAddress(s.chainId, s.address),
      explorerDeployTxUrl: explorerUrlForChainTx(s.chainId, deployTxHash),
      explorerFundTxUrl: explorerUrlForChainTx(s.chainId, fundTxHash),
    };
  });
}

export async function fetchUserPoolActivities(
  client: SupabaseClient<Database>,
): Promise<{ data: Tables<"user_pool_activity">[]; error: Error | null }> {
  const { data, error } = await client
    .from("user_pool_activity")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) {
    return { data: [], error: new Error(error.message) };
  }
  return { data: (data ?? []) as Tables<"user_pool_activity">[], error: null };
}

function mergeTxHashes(
  existing: string[] | null | undefined,
  incoming: string[],
): string[] {
  const s = new Set<string>();
  for (const x of existing ?? []) {
    if (x) s.add(x);
  }
  for (const x of incoming) {
    if (x) s.add(x);
  }
  return [...s];
}

export type UpsertPoolActivityInput = {
  userId: string;
  chainId: number;
  poolAddress: string;
  lastActivity: PoolActivityKind;
  newTxHashes: string[];
  name: string;
  description: string;
  expiresAtUnix: number;
  minimumUsdWei: string | null;
  /**
   * USD value to persist. When `onChainBalances` is also supplied it is
   * ignored and `total_usd_estimate` is taken from chain aggregate. When
   * `null` the prior value is preserved (e.g. fund/withdraw handlers that
   * could not read chain).
   */
  totalUsdEstimate: number | null;
  metadata?: Json;
  /** Asset type ("ETH", "WBTC", ...). `undefined` = leave existing value. */
  assetType?: string | null;
  /**
   * Human-readable primary-asset balance. `undefined` = leave existing value.
   * Ignored when `onChainBalances` is supplied (chain read wins).
   */
  fundedAmountHuman?: string | null;
  /** Typed deploy tx hash. `undefined` = leave existing value. */
  deployTxHash?: string | null;
  /** Typed fund tx hash. `undefined` = leave existing value. */
  fundTxHash?: string | null;
  fundingStatus?: "funding_pending" | "funded" | "funding_failed" | null;
  /**
   * Fresh on-chain balances. When supplied, `funded_amount_human` =
   * primary-asset current balance and `total_usd_estimate` = aggregate USD.
   * This is the canonical source once we have a provider read.
   */
  onChainBalances?: PoolOnChainBalances;
};

type ExistingSelectRow = Pick<
  Tables<"user_pool_activity">,
  | "last_tx_hashes"
  | "asset_type"
  | "funded_amount_human"
  | "deploy_tx_hash"
  | "fund_tx_hash"
  | "total_usd_estimate"
>;

function readFundingStatus(
  metadata: Json | null | undefined,
): "funding_pending" | "funded" | "funding_failed" | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const v = (metadata as Record<string, unknown>).funding_status;
  if (v === "funding_pending" || v === "funded" || v === "funding_failed") {
    return v;
  }
  return null;
}

export async function upsertPoolActivity(
  client: SupabaseClient<Database>,
  input: UpsertPoolActivityInput,
): Promise<{ error: Error | null }> {
  const pool_address = getAddress(input.poolAddress);
  const { data: existing, error: selErr } = await client
    .from("user_pool_activity")
    .select(
      "last_tx_hashes, asset_type, funded_amount_human, deploy_tx_hash, fund_tx_hash, total_usd_estimate",
    )
    .eq("user_id", input.userId)
    .eq("chain_id", input.chainId)
    .eq("pool_address", pool_address)
    .maybeSingle();
  if (selErr) {
    return { error: new Error(selErr.message) };
  }
  const prev = (existing ?? null) as ExistingSelectRow | null;
  const last_tx_hashes = mergeTxHashes(
    prev?.last_tx_hashes as string[] | undefined,
    input.newTxHashes,
  );

  // Resolve asset_type + funded_amount_human + total_usd_estimate.
  //
  // Precedence:
  //   1. onChainBalances (chain truth): overrides funded_amount_human and
  //      total_usd_estimate; asset_type preserved from caller/prior or falls
  //      back to primary asset symbol from balances.
  //   2. Explicit caller input fields.
  //   3. Prior persisted value.
  //
  // This prevents fund handlers from overwriting with stale user-typed USD
  // and prevents withdraw handlers from zeroing the balance.
  let assetType: string | null =
    input.assetType !== undefined ? input.assetType : (prev?.asset_type ?? null);
  let fundedAmountHuman: string | null =
    input.fundedAmountHuman !== undefined
      ? input.fundedAmountHuman
      : (prev?.funded_amount_human ?? null);
  let totalUsdEstimate: number | null =
    input.totalUsdEstimate !== null
      ? input.totalUsdEstimate
      : (prev?.total_usd_estimate ?? null);

  if (input.onChainBalances) {
    const resolvedAssetType = assetType || input.onChainBalances.nativeEth.symbol;
    const primary = primaryAssetBalanceFor(
      input.onChainBalances,
      resolvedAssetType,
    );
    assetType = resolvedAssetType;
    fundedAmountHuman = primary.human;
    totalUsdEstimate = input.onChainBalances.totalUsd;
  }

  const row: TablesInsert<"user_pool_activity"> = {
    user_id: input.userId,
    chain_id: input.chainId,
    pool_address,
    last_activity: input.lastActivity,
    last_tx_hashes,
    expires_at_unix: input.expiresAtUnix,
    name: input.name,
    description: input.description,
    minimum_usd_wei: input.minimumUsdWei,
    total_usd_estimate: totalUsdEstimate,
    metadata: ({
      ...(input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
        ? (input.metadata as Record<string, unknown>)
        : {}),
      ...(input.fundingStatus ? { funding_status: input.fundingStatus } : {}),
    } satisfies Record<string, unknown>) as Json,
    asset_type: assetType,
    funded_amount_human: fundedAmountHuman,
    deploy_tx_hash:
      input.deployTxHash !== undefined
        ? input.deployTxHash
        : (prev?.deploy_tx_hash ?? null),
    fund_tx_hash:
      input.fundTxHash !== undefined
        ? input.fundTxHash
        : (prev?.fund_tx_hash ?? null),
    updated_at: new Date().toISOString(),
  };
  const { error } = await client.from("user_pool_activity").upsert(row, {
    onConflict: "user_id,chain_id,pool_address",
  });
  return { error: error ? new Error(error.message) : null };
}
