import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock, Callout, DocsPage } from "@/components/docs-page";

export const metadata: Metadata = {
  title: "Quickstart",
  description:
    "Get Sepolia test ETH, deploy a CommunityPool, fund it, and withdraw — end-to-end from the app.",
};

export default function QuickstartPage() {
  return (
    <DocsPage
      eyebrow="Overview"
      title="Quickstart"
      lead="Get a wallet onto Sepolia, deploy a CommunityPool, fund it, and withdraw — all from the dApp."
      next={{
        label: "How pools work",
        href: "/docs/concepts/how-pools-work",
      }}
    >
      <h2>Prerequisites</h2>
      <ul>
        <li>A browser wallet (MetaMask, Rabby, or Coinbase Wallet)</li>
        <li>A CommunityPool account — sign up at <Link href="/signup">/signup</Link></li>
        <li>Sepolia test ETH (next step)</li>
      </ul>

      <Callout tone="info" title="Practice on Sepolia first">
        <p>
          This quickstart uses Sepolia so you can practice without real
          funds. The app also supports mainnet; there, real ETH and
          ERC-20s (WBTC, PAXG, XAU₮) are what you&apos;d send.
        </p>
      </Callout>

      <h2>1. Get Sepolia test ETH</h2>
      <p>
        Sepolia is Ethereum&apos;s primary public test network. You need a
        small amount of Sepolia ETH in your wallet to pay for deploying
        and funding pools. The gas cost for a full deploy-and-fund flow is
        usually well under 0.05 Sepolia ETH.
      </p>

      <h3>Switch your wallet to Sepolia</h3>
      <ol>
        <li>
          Open your wallet&apos;s network picker. In MetaMask this is the
          dropdown at the top of the extension.
        </li>
        <li>
          Enable test networks if they&apos;re hidden (MetaMask:{" "}
          <strong>Settings → Advanced → Show test networks</strong>).
        </li>
        <li>Select <strong>Sepolia</strong>.</li>
        <li>
          Copy your wallet address — you will paste it into a faucet next.
        </li>
      </ol>

      <h3>Request ETH from a faucet</h3>
      <p>
        Faucets dispense a small amount of Sepolia ETH per request, usually
        gated by a GitHub or Google account to prevent abuse. Any of these
        work — try the first, fall back to the next if it&apos;s empty or
        rate-limited:
      </p>
      <ul>
        <li>
          <a
            href="https://cloud.google.com/application/web3/faucet/ethereum/sepolia"
            target="_blank"
            rel="noreferrer"
          >
            Google Cloud Sepolia faucet
          </a>{" "}
          — Google account, typically 0.05 ETH per request.
        </li>
        <li>
          <a
            href="https://faucets.chain.link/sepolia"
            target="_blank"
            rel="noreferrer"
          >
            Chainlink faucet
          </a>{" "}
          — also dispenses test LINK, useful if you plan to experiment with
          oracle-powered features.
        </li>
        <li>
          <a
            href="https://www.alchemy.com/faucets/ethereum-sepolia"
            target="_blank"
            rel="noreferrer"
          >
            Alchemy Sepolia faucet
          </a>{" "}
          — requires an Alchemy account.
        </li>
        <li>
          <a
            href="https://faucet.quicknode.com/ethereum/sepolia"
            target="_blank"
            rel="noreferrer"
          >
            QuickNode Sepolia faucet
          </a>{" "}
          — requires a mainnet ETH balance on the connected wallet as an
          anti-abuse check.
        </li>
      </ul>
      <p>
        Paste the address you copied in step 4, solve the captcha, and wait
        1–2 minutes for the transfer to land. Refresh your wallet — you
        should see a Sepolia ETH balance.
      </p>

      <Callout tone="warn" title="Faucets go down">
        <p>
          Sepolia faucets run dry, throttle, or change auth requirements
          frequently. If none of the above are dispensing, search{" "}
          <code>sepolia faucet</code> for the current working list.
        </p>
      </Callout>

      <h2>2. Sign in and connect a wallet</h2>
      <ol>
        <li>
          Sign in at <Link href="/login">/login</Link>.
        </li>
        <li>
          From the dashboard, click the wallet button in the top bar and
          choose <strong>Connect wallet</strong>. Approve the connection
          request in your wallet extension.
        </li>
        <li>
          Confirm the connected network is Sepolia. The header shows the
          active network; if it&apos;s wrong, switch in your wallet and the
          app will refresh.
        </li>
      </ol>

      <h2>3. Deploy a pool</h2>
      <p>
        Head to <Link href="/pools">/pools</Link> and click{" "}
        <strong>Deploy a CommunityPool</strong>. The modal walks through
        these fields:
      </p>
      <ul>
        <li>
          <strong>Pool name</strong> and <strong>description</strong> —
          shown to funders on the pool page.
        </li>
        <li>
          <strong>Minimum contribution (USD)</strong> — enforced on-chain.
          Any single contribution below this USD value reverts.
        </li>
        <li>
          <strong>Assets this pool will accept</strong> — ETH by default;
          add any whitelisted ERC-20 (e.g. WBTC on Sepolia) if you want
          token contributions too. Each token is paired with its Chainlink
          USD feed at deploy time.
        </li>
        <li>
          <strong>Pool owners</strong> — you are added automatically. Use{" "}
          <strong>Add owner</strong> to include co-owners; any owner can
          withdraw before expiry.
        </li>
        <li>
          <strong>Pool expiration date</strong> — after this timestamp,
          owner withdraws are disabled and anyone can release remaining
          funds to you (the deployer).
        </li>
        <li>
          <strong>Initial fund</strong> — an optional first contribution
          bundled into the deploy transaction so the pool has a non-zero
          balance on creation.
        </li>
      </ul>
      <p>
        Click <strong>Deploy</strong>, approve the transaction in your
        wallet, and wait for the confirmation. The success panel shows the
        contract address, the deploy transaction hash, and (if you
        bundled an initial fund) the fund transaction hash.
      </p>

      <Callout tone="info" title="USD inputs, everywhere">
        <p>
          Minimum contribution, initial fund, and later{" "}
          <em>withdraw</em> amounts are all entered in USD. The app
          converts to ETH or token units at the current Chainlink rate
          before signing. See{" "}
          <Link href="/docs/concepts/usd-pricing">USD pricing</Link> for
          how that conversion works.
        </p>
      </Callout>

      <h2>4. Fund the pool</h2>
      <p>
        From any pool row on <Link href="/pools">/pools</Link>, click{" "}
        <strong>Fund</strong>. The fund modal lets a funder:
      </p>
      <ol>
        <li>
          Pick the <strong>asset</strong> — ETH or any whitelisted ERC-20
          the pool accepts.
        </li>
        <li>
          Enter a <strong>USD amount</strong>. The app shows the
          equivalent asset amount at the current Chainlink rate.
        </li>
        <li>
          For ERC-20s, approve the token if this is the first time the
          pool is spending from your wallet, then sign the fund
          transaction.
        </li>
      </ol>
      <p>
        The transaction reverts if the USD amount is below the pool&apos;s
        minimum, or if the pool has expired.
      </p>

      <h2>5. Withdraw</h2>
      <p>
        Any pool owner can withdraw before expiry. Click{" "}
        <strong>Withdraw from Pool</strong> on a pool you own. The modal
        supports three withdrawal modes:
      </p>
      <ul>
        <li>
          <strong>ETH only</strong> — sweep some or all of the
          pool&apos;s ETH balance to your wallet.
        </li>
        <li>
          <strong>ERC-20 only</strong> — sweep some or all of a
          whitelisted token balance.
        </li>
        <li>
          <strong>Both</strong> — combine an ETH withdraw and a token
          withdraw in a single flow (two signed transactions).
        </li>
      </ul>
      <p>
        Amounts are entered in USD. Pools that support partial withdraws
        show an amount input; legacy pools (deployed before partial
        withdraws shipped) only support full-balance sweeps — the UI
        detects this and hides the amount input automatically. See the{" "}
        <Link href="/docs/concepts/pool-lifecycle">lifecycle page</Link>{" "}
        for the full rules.
      </p>

      <h2>6. After expiry</h2>
      <p>
        Once the pool&apos;s expiration timestamp passes:
      </p>
      <ul>
        <li>New contributions revert.</li>
        <li>Owner withdraws revert.</li>
        <li>
          Anyone (including you) can call{" "}
          <code>releaseExpiredFundsToDeployer()</code> on the pool contract
          to sweep all ETH and whitelisted ERC-20 balances to the original
          deployer.
        </li>
      </ul>
      <CodeBlock lang="solidity">{`// Callable by anyone after expiresAt
pool.releaseExpiredFundsToDeployer();`}</CodeBlock>

      <h2>What to read next</h2>
      <ul>
        <li>
          <Link href="/docs/concepts/how-pools-work">
            How pools work
          </Link>{" "}
          — the mental model (deployer vs. owners, per-pool state,
          immutables).
        </li>
        <li>
          <Link href="/docs/concepts/usd-pricing">
            USD pricing & Chainlink
          </Link>{" "}
          — how dollar minimums are enforced on-chain.
        </li>
        <li>
          <Link href="/docs/contracts">
            CommunityPool.sol reference
          </Link>{" "}
          — every function, event, and custom error.
        </li>
        <li>
          <Link href="/docs/api">Pro API</Link> — read-only HTTP endpoints
          for indexing pools, funders, and events.
        </li>
      </ul>
    </DocsPage>
  );
}
