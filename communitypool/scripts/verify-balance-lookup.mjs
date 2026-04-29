/**
 * Smoke-check data sources used by /api/onchain/lookup.
 * Run from repo root: `cd communitypool && npm run verify:balance`
 * When ALCHEMY_API_KEY is set: checks Alchemy Portfolio + eth_getTransactionByHash (and optional Etherscan v2).
 * Always (non-fatal when Alchemy ran): checks mempool.space address API for BTC (override with MEMPOOL_API_BASE).
 * With no ALCHEMY_API_KEY, only the mempool BTC check runs (exit 1 if it fails).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

loadEnvFiles();

const VITALIK = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
/** Example mainnet tx (contract creation); must exist on chain. */
const SAMPLE_MAINNET_TX =
  "0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060";

function rpcMainnet(apiKey) {
  return (
    process.env.ALCHEMY_API_URL_ETH_MAINNET ??
    (apiKey ? `https://eth-mainnet.g.alchemy.com/v2/${apiKey}` : undefined)
  );
}

/** Genesis coinbase payout address — stable on mainnet for a minimal Esplora smoke test. */
const SAMPLE_BTC_ADDRESS = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";

async function verifyMempoolBtcAddressApi() {
  const base = (process.env.MEMPOOL_API_BASE ?? "https://mempool.space").replace(
    /\/+$/,
    "",
  );
  const url = `${base}/api/address/${encodeURIComponent(SAMPLE_BTC_ADDRESS)}`;
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  if (!res.ok) {
    console.error("Mempool address API:", res.status, text.slice(0, 200));
    return false;
  }
  try {
    const j = JSON.parse(text);
    if (!j || typeof j !== "object" || !("chain_stats" in j)) {
      console.error("Mempool address API: unexpected JSON shape");
      return false;
    }
  } catch {
    console.error("Mempool address API: invalid JSON");
    return false;
  }
  console.log("OK: Mempool /api/address (BTC) reachable at", base);
  return true;
}

async function jsonRpc(rpcUrl, method, params) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || "RPC error");
  return json.result;
}

async function main() {
  const apiKey = process.env.ALCHEMY_API_KEY?.trim();

  if (apiKey) {
    const dataUrl = `https://api.g.alchemy.com/data/v1/${apiKey}/assets/tokens/by-address`;
    const portfolioRes = await fetch(dataUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        addresses: [{ address: VITALIK, networks: ["eth-mainnet"] }],
        withMetadata: true,
        withPrices: true,
        includeNativeTokens: true,
        includeErc20Tokens: true,
      }),
    });
    const portfolioJson = await portfolioRes.json();
    if (!portfolioRes.ok) {
      console.error(
        "Portfolio API error:",
        portfolioRes.status,
        JSON.stringify(portfolioJson).slice(0, 500),
      );
      process.exit(1);
    }
    const tokens = portfolioJson?.data?.tokens;
    if (!Array.isArray(tokens) || tokens.length === 0) {
      console.error("Portfolio API returned no tokens for sample address.");
      process.exit(1);
    }

    const rpcUrl = rpcMainnet(apiKey);
    if (!rpcUrl) {
      console.error("Could not resolve mainnet RPC URL.");
      process.exit(1);
    }
    const tx = await jsonRpc(rpcUrl, "eth_getTransactionByHash", [
      SAMPLE_MAINNET_TX,
    ]);
    if (!tx || typeof tx !== "object" || !tx.hash) {
      console.error("eth_getTransactionByHash did not return a transaction.");
      process.exit(1);
    }

    console.log(
      "OK: Alchemy Portfolio returned",
      tokens.length,
      "token row(s); eth_getTransactionByHash returned block",
      tx.blockNumber ?? "?",
    );

    const etherscanKey = process.env.ETHERSCAN_API_KEY?.trim();
    if (etherscanKey) {
      const esUrl = new URL("https://api.etherscan.io/v2/api");
      esUrl.searchParams.set("chainid", "1");
      esUrl.searchParams.set("module", "account");
      esUrl.searchParams.set("action", "balance");
      esUrl.searchParams.set("address", VITALIK);
      esUrl.searchParams.set("tag", "latest");
      esUrl.searchParams.set("apikey", etherscanKey);
      const esRes = await fetch(esUrl.toString(), { cache: "no-store" });
      const esJson = await esRes.json();
      if (!esRes.ok || esJson.status !== "1" || typeof esJson.result !== "string") {
        console.error(
          "Etherscan v2 balance check failed:",
          esRes.status,
          JSON.stringify(esJson).slice(0, 400),
        );
        process.exit(1);
      }
      console.log(
        "OK: Etherscan v2 native balance (wei string length)",
        esJson.result.length,
      );

      const TX_PAGE_SIZE = 100;
      const MAX_TX_PAGES = 8;
      const actions = ["txlist", "txlistinternal", "tokentx", "tokennfttx"];
      const unique = new Set();
      let allComplete = true;

      function resultRows(json) {
        const r = json.result;
        if (Array.isArray(r)) return r;
        if (typeof r === "string") {
          const low = r.toLowerCase();
          if (
            low.includes("no transactions") ||
            low.includes("no records found") ||
            low === "[]"
          ) {
            return [];
          }
          try {
            const p = JSON.parse(r);
            return Array.isArray(p) ? p : [];
          } catch {
            return null;
          }
        }
        return null;
      }

      for (const action of actions) {
        let categoryComplete = false;
        for (let page = 1; page <= MAX_TX_PAGES; page += 1) {
          await new Promise((r) => setTimeout(r, 350));
          const u = new URL("https://api.etherscan.io/v2/api");
          u.searchParams.set("chainid", "1");
          u.searchParams.set("module", "account");
          u.searchParams.set("action", action);
          u.searchParams.set("address", VITALIK);
          u.searchParams.set("startblock", "0");
          u.searchParams.set("endblock", "9999999999");
          u.searchParams.set("page", String(page));
          u.searchParams.set("offset", String(TX_PAGE_SIZE));
          u.searchParams.set("sort", "desc");
          u.searchParams.set("apikey", etherscanKey);
          const txRes = await fetch(u.toString(), { cache: "no-store" });
          const txJson = await txRes.json();
          if (!txRes.ok) {
            allComplete = false;
            categoryComplete = false;
            break;
          }
          const rows = resultRows(txJson);
          if (rows === null) {
            allComplete = false;
            categoryComplete = false;
            break;
          }
          for (const row of rows) {
            const h =
              row && typeof row === "object" && typeof row.hash === "string"
                ? row.hash.toLowerCase()
                : null;
            if (h) unique.add(h);
          }
          if (rows.length < TX_PAGE_SIZE) {
            categoryComplete = true;
            break;
          }
          if (page === MAX_TX_PAGES) {
            categoryComplete = false;
            break;
          }
        }
        allComplete = allComplete && categoryComplete;
      }

      console.log(
        "OK: Etherscan unique tx hash count (mainnet, Vitalik sample, 4 actions × up to",
        MAX_TX_PAGES,
        "pages):",
        unique.size,
        "| paginationComplete(all categories):",
        allComplete,
        "(compare to etherscan.io UI if needed)",
      );
    }
  } else {
    console.warn(
      "Skipping Alchemy checks (no ALCHEMY_API_KEY). Set it to run EVM smoke tests.",
    );
  }

  const mempoolOk = await verifyMempoolBtcAddressApi();
  if (!mempoolOk) {
    if (apiKey) {
      console.warn(
        "Mempool BTC smoke check failed (non-fatal for verify:balance when Alchemy passed).",
      );
    } else {
      process.exit(1);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
