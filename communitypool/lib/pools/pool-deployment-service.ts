import "server-only";

import { getAddress, type JsonRpcProvider } from "ethers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getServerReadOnlyProviderForChain } from "@/lib/onchain/server-providers";

/**
 * OWASP A08 F-02 — verified deploy recording.
 *
 * `user_pool_activity` is fully writable by the row owner (RLS:
 * `auth.uid() = user_id`), so a Free user could DELETE their own rows to
 * reset the deploy counter and bypass `FREE_POOL_LIMIT`. The fix is a
 * service-role-only ledger (`user_pool_deployments`) that the eligibility
 * helper reads from instead. Rows land here only after this module has
 * verified the deploy transaction on-chain:
 *
 *   1. tx receipt exists on the supplied chain
 *   2. tx succeeded (status === 1)
 *   3. receipt.contractAddress matches the supplied pool address
 *      (ensures the tx is the deploy tx for *this* contract — an attacker
 *      can't claim a pool they didn't deploy by passing an unrelated tx)
 *   4. the pool address has bytecode at the current head (defends against
 *      a replay where the contract self-destructed; CommunityPool itself
 *      has no SELFDESTRUCT, but this is cheap defence-in-depth)
 *
 * Idempotency:
 *   - `(chain_id, pool_address)` is unique. A second call for the same
 *     pool returns the existing row instead of creating a duplicate.
 *   - `(chain_id, deploy_tx_hash)` is unique. Same defence on the tx axis.
 */

const POOL_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const TX_HASH_RE = /^0x[a-fA-F0-9]{64}$/;

export type RecordDeploymentInput = {
  userId: string;
  chainId: number;
  poolAddress: string;
  deployTxHash: string;
};

export type RecordDeploymentResult =
  | { ok: true; status: "recorded" | "already_recorded"; rowId: string | null }
  | {
      ok: false;
      reason:
        | "invalid_pool_address"
        | "invalid_tx_hash"
        | "no_provider"
        | "tx_not_found"
        | "tx_pending"
        | "tx_reverted"
        | "contract_address_mismatch"
        | "no_bytecode_at_pool"
        | "db_error";
      message: string;
    };

/**
 * Verify a deploy tx on chain and idempotently insert into the ledger.
 * The caller MUST authenticate the user and pass `userId` from the session.
 * The provider is resolved from the server's RPC credentials so the client
 * cannot smuggle a fake "tx confirmed on chain" claim past us.
 */
export async function recordVerifiedDeployment(
  admin: SupabaseClient<Database>,
  input: RecordDeploymentInput,
): Promise<RecordDeploymentResult> {
  if (!POOL_ADDRESS_RE.test(input.poolAddress)) {
    return {
      ok: false,
      reason: "invalid_pool_address",
      message: "poolAddress must match ^0x[a-fA-F0-9]{40}$",
    };
  }
  if (!TX_HASH_RE.test(input.deployTxHash)) {
    return {
      ok: false,
      reason: "invalid_tx_hash",
      message: "deployTxHash must match ^0x[a-fA-F0-9]{64}$",
    };
  }
  const provider = getServerReadOnlyProviderForChain(input.chainId);
  if (!provider) {
    return {
      ok: false,
      reason: "no_provider",
      message: `No server-side RPC configured for chainId ${input.chainId}`,
    };
  }

  const verification = await verifyDeploymentReceiptOnChain(provider, {
    chainId: input.chainId,
    poolAddress: input.poolAddress,
    deployTxHash: input.deployTxHash,
  });
  if (!verification.ok) return verification;

  // Insert into the ledger. The unique constraints on (chain_id,
  // pool_address) and (chain_id, deploy_tx_hash) make this idempotent.
  const checksummed = getAddress(input.poolAddress);
  const { data, error } = await admin
    .from("user_pool_deployments")
    .insert({
      user_id: input.userId,
      chain_id: input.chainId,
      pool_address: checksummed,
      deploy_tx_hash: input.deployTxHash.toLowerCase(),
      deployment_status: "deployed",
    })
    .select("id")
    .maybeSingle();

  if (!error && data) {
    return { ok: true, status: "recorded", rowId: data.id };
  }

  // Unique-violation = row already exists (idempotent re-call). Look up the
  // existing row so the caller can confirm it was preserved.
  const code = (error as { code?: string } | null)?.code;
  if (code === "23505") {
    const { data: existing } = await admin
      .from("user_pool_deployments")
      .select("id")
      .eq("chain_id", input.chainId)
      .eq("pool_address", checksummed)
      .maybeSingle();
    return {
      ok: true,
      status: "already_recorded",
      rowId: existing?.id ?? null,
    };
  }

  return {
    ok: false,
    reason: "db_error",
    message: error?.message ?? "user_pool_deployments insert failed",
  };
}

/** On-chain proof that the supplied tx hash deployed the supplied pool address. */
async function verifyDeploymentReceiptOnChain(
  provider: JsonRpcProvider,
  args: { chainId: number; poolAddress: string; deployTxHash: string },
): Promise<RecordDeploymentResult> {
  const receipt = await provider.getTransactionReceipt(args.deployTxHash);
  if (!receipt) {
    // Distinguish "tx not seen yet" (might be still propagating) from
    // "tx never existed" — both look like null at this layer. Treat as
    // pending; the client should retry.
    const tx = await provider.getTransaction(args.deployTxHash);
    if (tx && tx.blockNumber == null) {
      return {
        ok: false,
        reason: "tx_pending",
        message: "tx is in mempool but not yet mined",
      };
    }
    return {
      ok: false,
      reason: "tx_not_found",
      message: "no receipt for deployTxHash on the supplied chain",
    };
  }
  if (receipt.status !== 1) {
    return {
      ok: false,
      reason: "tx_reverted",
      message: "deploy tx reverted",
    };
  }
  // ethers' Receipt exposes `contractAddress` on contract-creation txs.
  const receiptContract = (receipt as unknown as { contractAddress?: string | null })
    .contractAddress;
  if (!receiptContract) {
    return {
      ok: false,
      reason: "contract_address_mismatch",
      message: "tx is not a contract creation",
    };
  }
  if (getAddress(receiptContract) !== getAddress(args.poolAddress)) {
    return {
      ok: false,
      reason: "contract_address_mismatch",
      message: "receipt.contractAddress does not match poolAddress",
    };
  }
  const code = await provider.getCode(getAddress(args.poolAddress));
  if (!code || code === "0x") {
    return {
      ok: false,
      reason: "no_bytecode_at_pool",
      message: "no bytecode at pool address (selfdestructed?)",
    };
  }
  return { ok: true, status: "recorded", rowId: null };
}

/**
 * Count verified deployments for a user on a chain. This is the source of
 * truth for the Free-tier deploy quota — `user_pool_activity` is *not* used
 * because it's user-writable.
 */
export async function countVerifiedDeployments(
  client: SupabaseClient<Database>,
  args: { userId: string; chainId: number },
): Promise<number> {
  const { count, error } = await client
    .from("user_pool_deployments")
    .select("id", { count: "exact", head: true })
    .eq("user_id", args.userId)
    .eq("chain_id", args.chainId);
  if (error) {
    throw new Error(`countVerifiedDeployments failed: ${error.message}`);
  }
  return count ?? 0;
}
