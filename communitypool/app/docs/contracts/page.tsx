import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock, Callout, DocsPage } from "@/components/docs-page";

export const metadata: Metadata = {
  title: "CommunityPool.sol",
  description:
    "Function-by-function reference for CommunityPool.sol — constructor, funding, withdraws, release, and custom errors.",
};

export default function ContractsReferencePage() {
  return (
    <DocsPage
      eyebrow="Smart Contracts"
      title="CommunityPool.sol"
      lead="Reference for every external function, event, and custom error on CommunityPool.sol. Source lives in src/CommunityPool.sol."
    >
      <Callout tone="info" title="Versioning">
        <p>
          Deployed addresses will be tracked here per network once mainnet
          ships. For now, all deployments are on Sepolia. The runtime ABI
          is the <code>abi</code> field of{" "}
          <code>lib/onchain/community-pool-artifact.json</code>, which CI
          verifies byte-for-byte against <code>forge-out/</code> on every
          push. Older pools deployed before the partial-withdraw functions
          existed are auto-detected at runtime via{" "}
          <code>poolSupportsPartialWithdraw</code> — see the{" "}
          <Link href="/docs/concepts/pool-lifecycle">lifecycle page</Link>{" "}
          for details.
        </p>
      </Callout>

      <h2>Constructor</h2>
      <CodeBlock lang="solidity">{`constructor(
    string memory name_,
    string memory description_,
    uint256 minimumUsd_,
    address[] memory coOwners,
    uint64 expiresAt_,
    address ethUsdFeed,
    TokenConfig[] memory tokenConfigs
)`}</CodeBlock>
      <p>
        Deploys a pool. The caller becomes the immutable <code>deployer</code>
        {" "}and is automatically added to the owner set. <code>minimumUsd_</code>{" "}
        is denominated in 18-decimal USD wei.{" "}
        <code>TokenConfig</code> is{" "}
        <code>{`{ address token; address usdFeed; uint8 decimals }`}</code>.
      </p>
      <p>
        Reverts: <code>CommunityPool__ZeroAddress</code>,{" "}
        <code>CommunityPool__DuplicateOwner</code>,{" "}
        <code>CommunityPool__DuplicateToken</code>.
      </p>

      <h2>Funding</h2>

      <h3><code>fund()</code> — payable</h3>
      <p>
        Contribute ETH. The contract converts <code>msg.value</code> to USD
        via the ETH/USD feed and reverts if below <code>minimumUsd</code>.
        Emits <code>Funded</code>. Also triggered by the{" "}
        <code>receive()</code> and <code>fallback()</code> handlers, so
        plain ETH transfers to the contract fund the pool.
      </p>
      <p>
        Reverts: <code>CommunityPool__PoolExpired</code>,{" "}
        <code>CommunityPool__BelowMinimumUsd</code>.
      </p>

      <h3><code>fundERC20(IERC20 token, uint256 amount)</code></h3>
      <p>
        Contribute a whitelisted ERC-20. Requires prior{" "}
        <code>approve()</code>. Uses the token&apos;s configured decimals
        and USD feed to enforce the minimum. Emits{" "}
        <code>FundedERC20</code>.
      </p>
      <p>
        Reverts: <code>CommunityPool__PoolExpired</code>,{" "}
        <code>CommunityPool__TokenNotWhitelisted</code>,{" "}
        <code>CommunityPool__BelowMinimumUsd</code>.
      </p>

      <h2>Owner withdraws (before expiry)</h2>

      <h3><code>withdraw(uint256 amount)</code></h3>
      <p>
        Partial ETH withdraw. Reverts if <code>amount == 0</code> or if it
        exceeds the contract&apos;s ETH balance. Emits <code>Withdrawn</code>.
      </p>

      <h3><code>cheaperWithdraw()</code></h3>
      <p>
        Full ETH withdraw. Sweeps the contract&apos;s entire ETH balance to
        <code>msg.sender</code>. Emits <code>Withdrawn</code>.
      </p>

      <h3><code>withdrawTokenAmount(IERC20 token, uint256 amount)</code></h3>
      <p>
        Partial ERC-20 withdraw of a whitelisted token. Reverts if{" "}
        <code>amount == 0</code> or exceeds the contract&apos;s balance of
        that token. Emits <code>WithdrawnToken</code>.
      </p>

      <h3><code>withdrawToken(IERC20 token)</code></h3>
      <p>
        Full ERC-20 withdraw. Sweeps the contract&apos;s entire balance of
        the given token. Emits <code>WithdrawnToken</code> when the balance
        is non-zero.
      </p>

      <p>
        All four owner withdraws revert with{" "}
        <code>CommunityPool__NotOwner</code> for non-owners and{" "}
        <code>CommunityPool__WithdrawDisabledAfterExpiry</code> after the
        expiry timestamp.
      </p>

      <h2>Release (after expiry)</h2>

      <h3><code>releaseExpiredFundsToDeployer()</code></h3>
      <p>
        Callable by anyone once <code>block.timestamp &gt; expiresAt</code>.
        Sweeps all ETH and every whitelisted ERC-20 balance to the original
        deployer. Emits <code>Withdrawn</code> and <code>WithdrawnToken</code>
        {" "}for each asset with a non-zero balance.
      </p>
      <p>
        Reverts: <code>CommunityPool__NotYetExpiredForRelease</code>.
      </p>

      <h2>View functions</h2>
      <p>
        Pool name, description, and per-funder accounting are not stored
        on-chain. Read them off-chain from the <code>PoolCreated</code>,{" "}
        <code>Funded</code>, and <code>FundedERC20</code> event logs.
      </p>
      <ul>
        <li>
          <code>minimumUsd</code>, <code>expiresAt</code>,{" "}
          <code>deployer</code> — public immutables.
        </li>
        <li>
          <code>isOwner(address)</code> → <code>bool</code>
        </li>
        <li>
          <code>getOwner()</code> → <code>address</code> — returns the
          deployer (kept for legacy UI callers).
        </li>
        <li>
          <code>getWhitelistedTokens()</code> → <code>address[]</code>
        </li>
        <li>
          <code>getVersion()</code> → <code>uint256</code> — returns the
          ETH/USD aggregator&apos;s version.
        </li>
      </ul>

      <h2>Events</h2>
      <CodeBlock lang="solidity">{`event PoolCreated(
    address indexed deployer,
    string name,
    string description,
    uint256 minimumUsd,
    uint64 expiresAt,
    address[] coOwners,
    address[] whitelistedTokens
);

event Funded(address indexed funder, uint256 amount);
event FundedERC20(address indexed token, address indexed funder, uint256 amount);
event Withdrawn(address indexed owner, uint256 amount);
event WithdrawnToken(address indexed token, address indexed owner, uint256 amount);`}</CodeBlock>

      <h2>Custom errors</h2>
      <ul>
        <li><code>CommunityPool__NotOwner</code></li>
        <li><code>CommunityPool__PoolExpired</code></li>
        <li><code>CommunityPool__TokenNotWhitelisted</code></li>
        <li><code>CommunityPool__ZeroAddress</code></li>
        <li><code>CommunityPool__BelowMinimumUsd</code></li>
        <li><code>CommunityPool__DuplicateOwner</code></li>
        <li><code>CommunityPool__DuplicateToken</code></li>
        <li><code>CommunityPool__NotYetExpiredForRelease</code></li>
        <li><code>CommunityPool__WithdrawDisabledAfterExpiry</code></li>
        <li><code>CommunityPool__InvalidWithdrawAmount</code></li>
        <li><code>CommunityPool__InsufficientBalance</code></li>
        <li><code>CommunityPool__EthTransferFailed</code></li>
      </ul>

      <h2>Deployed addresses</h2>
      <p>
        Sepolia deployment artifacts live in{" "}
        <code>communitypool/broadcast/</code>. Mainnet addresses will be
        published here when we ship.
      </p>
    </DocsPage>
  );
}
