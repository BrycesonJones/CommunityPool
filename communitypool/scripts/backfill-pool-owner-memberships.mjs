/**
 * Backfill legacy pool owner rows into `pool_owner_memberships` from historical
 * CommunityPool deploy transactions recorded in `user_pool_activity`.
 *
 * Usage:
 *   cd communitypool && npm run backfill:pool-owners
 *   cd communitypool && npm run backfill:pool-owners -- --dry-run
 *
 * Required env:
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *
 * RPC env used by chain:
 *   - chain 1:        ALCHEMY_API_URL_ETH_MAINNET or ALCHEMY_API_KEY
 *   - chain 11155111: ALCHEMY_API_URL_ETH_SEPOLIA or ALCHEMY_API_KEY
 *   - chain 31337:    LOCAL_ANVIL_RPC_URL (default http://127.0.0.1:8545)
 *   - optional override for any chain: BACKFILL_RPC_URL_<chainId>
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { Interface, JsonRpcProvider, getAddress } from "ethers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function loadEnvFiles() {
  for (const name of [".env.local", ".env"]) {
    const p = path.join(root, name);
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, "utf8");
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq <= 0) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (process.env[k] === undefined) process.env[k] = v;
    }
  }
}

function providerUrlForChain(chainId) {
  const byChain = process.env[`BACKFILL_RPC_URL_${chainId}`]?.trim();
  if (byChain) return byChain;
  if (chainId === 1) {
    const explicit = process.env.ALCHEMY_API_URL_ETH_MAINNET?.trim();
    if (explicit) return explicit;
    const key = process.env.ALCHEMY_API_KEY?.trim();
    return key ? `https://eth-mainnet.g.alchemy.com/v2/${key}` : null;
  }
  if (chainId === 11155111) {
    const explicit = process.env.ALCHEMY_API_URL_ETH_SEPOLIA?.trim();
    if (explicit) return explicit;
    const key = process.env.ALCHEMY_API_KEY?.trim();
    return key ? `https://eth-sepolia.g.alchemy.com/v2/${key}` : null;
  }
  if (chainId === 31337) {
    return process.env.LOCAL_ANVIL_RPC_URL?.trim() || "http://127.0.0.1:8545";
  }
  return null;
}

function uniqueOwnerRows(chainId, poolAddress, deployer, coOwners, createdByUserId) {
  const owners = [{ address: deployer, isDeployer: true }];
  for (const a of coOwners) owners.push({ address: a, isDeployer: false });
  const seen = new Set();
  const out = [];
  for (const o of owners) {
    const addr = getAddress(o.address);
    if (seen.has(addr)) continue;
    seen.add(addr);
    out.push({
      chain_id: chainId,
      pool_address: getAddress(poolAddress),
      owner_address: addr,
      is_deployer: o.isDeployer,
      created_by_user_id: createdByUserId,
      updated_at: new Date().toISOString(),
    });
  }
  return out;
}

async function fetchDeployRows(supabase) {
  const pageSize = 1000;
  let from = 0;
  const all = [];
  for (;;) {
    const { data, error } = await supabase
      .from("user_pool_activity")
      .select("chain_id,pool_address,deploy_tx_hash,user_id,created_at")
      .not("deploy_tx_hash", "is", null)
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  // Keep earliest seen deploy row per pool key.
  const byPool = new Map();
  for (const row of all) {
    const key = `${row.chain_id}-${String(row.pool_address).toLowerCase()}`;
    if (!byPool.has(key)) byPool.set(key, row);
  }
  return [...byPool.values()];
}

async function main() {
  loadEnvFiles();
  const dryRun = process.argv.includes("--dry-run");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceRole) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local/.env",
    );
    process.exit(1);
  }

  const artifactPath = path.join(root, "lib", "onchain", "community-pool-artifact.json");
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const iface = new Interface(artifact.abi);

  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const deployRows = await fetchDeployRows(supabase);
  const providers = new Map();

  let scanned = 0;
  let upserted = 0;
  let skippedNoRpc = 0;
  let skippedNoReceipt = 0;
  let skippedNoEvent = 0;
  const failures = [];

  for (const row of deployRows) {
    scanned += 1;
    const chainId = Number(row.chain_id);
    const txHash = String(row.deploy_tx_hash || "").trim();
    if (!txHash) {
      skippedNoEvent += 1;
      continue;
    }

    const rpcUrl = providerUrlForChain(chainId);
    if (!rpcUrl) {
      skippedNoRpc += 1;
      continue;
    }
    let provider = providers.get(chainId);
    if (!provider) {
      provider = new JsonRpcProvider(rpcUrl);
      providers.set(chainId, provider);
    }

    try {
      const receipt = await provider.getTransactionReceipt(txHash);
      if (!receipt) {
        skippedNoReceipt += 1;
        continue;
      }

      let event = null;
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed && parsed.name === "PoolCreated") {
            event = parsed;
            break;
          }
        } catch {
          // not a CommunityPool log
        }
      }
      if (!event) {
        skippedNoEvent += 1;
        continue;
      }

      const deployer = getAddress(event.args.deployer);
      const coOwners = Array.isArray(event.args.coOwners) ? event.args.coOwners : [];
      const rows = uniqueOwnerRows(
        chainId,
        String(row.pool_address),
        deployer,
        coOwners,
        String(row.user_id),
      );

      if (!dryRun) {
        const { error } = await supabase
          .from("pool_owner_memberships")
          .upsert(rows, { onConflict: "chain_id,pool_address,owner_address" });
        if (error) throw new Error(error.message);
      }
      upserted += rows.length;
    } catch (e) {
      failures.push({
        chainId,
        poolAddress: row.pool_address,
        deployTxHash: txHash,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        scannedDeployRows: scanned,
        upsertedOwnerRows: upserted,
        skippedNoRpc,
        skippedNoReceipt,
        skippedNoEvent,
        failures: failures.length,
      },
      null,
      2,
    ),
  );

  if (failures.length > 0) {
    console.log("Sample failures:");
    for (const f of failures.slice(0, 10)) {
      console.log(
        `- chain ${f.chainId} pool ${f.poolAddress} tx ${f.deployTxHash}: ${f.error}`,
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
