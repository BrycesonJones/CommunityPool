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
          Two generations of pool are live at once. Pools created from the
          protocol-fee release onwards are <strong>V2</strong>: they hold an
          immutable reference to a shared <code>ProtocolConfig</code> and
          deduct a protocol fee from each contribution. Pools created before
          it are <strong>V1</strong>: identical apart from the constructor and
          the fee, and they charge nothing. V1 pools keep working exactly as
          they always have, and nothing about them changes.
        </p>
        <p>
          V2 keeps every V1 function with the same selectors, so one ABI drives
          fund and withdraw on either generation. The runtime ABI is the{" "}
          <code>abi</code> field of{" "}
          <code>lib/onchain/community-pool-v2-artifact.json</code> (V1&apos;s is
          frozen alongside it), and CI verifies both byte-for-byte against{" "}
          <code>forge-out/</code> on every push. A pool&apos;s generation is
          detected at runtime from its own bytecode — the V2-only{" "}
          <code>protocolConfig()</code> and <code>getProtocolFeeConfig()</code>{" "}
          selectors — the same way older pools without the partial-withdraw
          functions are detected via <code>poolSupportsPartialWithdraw</code>.
          See the{" "}
          <Link href="/docs/concepts/pool-lifecycle">lifecycle page</Link>{" "}
          for details.
        </p>
      </Callout>

      <h2>Constructor (V2)</h2>
      <CodeBlock lang="solidity">{`constructor(
    string memory name_,
    string memory description_,
    uint256 minimumUsd_,
    address[] memory coOwners,
    uint64 expiresAt_,
    address ethUsdFeed,
    uint32 ethUsdMaxPriceAge,
    TokenConfig[] memory tokenConfigs,
    address protocolConfig_
)`}</CodeBlock>
      <p>
        Deploys a pool. The caller becomes the immutable <code>deployer</code>
        {" "}and is automatically added to the owner set. <code>minimumUsd_</code>{" "}
        is denominated in 18-decimal USD wei.{" "}
        <code>TokenConfig</code> is{" "}
        <code>{`{ address token; address usdFeed; uint8 decimals; uint32 maxPriceAge }`}</code>.
      </p>
      <p>
        Every oracle value is fixed here and can never be changed: each feed,
        each feed&apos;s decimals (read from the feed at construction), and each{" "}
        <code>maxPriceAge</code> freshness window. So is{" "}
        <code>protocolConfig_</code>, which must be a contract with code. V1
        took the same arguments without <code>ethUsdMaxPriceAge</code>,{" "}
        <code>maxPriceAge</code> and <code>protocolConfig_</code>.
      </p>
      <p>
        Reverts: <code>CommunityPool__ZeroAddress</code>,{" "}
        <code>CommunityPool__DuplicateOwner</code>,{" "}
        <code>CommunityPool__DuplicateToken</code>,{" "}
        <code>CommunityPool__ProtocolConfigNotContract</code>,{" "}
        <code>PriceConverter__InvalidMaxPriceAge</code>,{" "}
        <code>PriceConverter__UnsupportedFeedDecimals</code>.
      </p>

      <h2>Protocol fee (V2 only)</h2>
      <p>
        Each contribution to a V2 pool pays{" "}
        <code>floor(gross × feeBps / 10_000)</code> to the treasury, taken{" "}
        <strong>out of</strong> the amount funded rather than added on top: the
        funder is debited exactly the amount they chose, and the pool keeps the
        remainder. The rate and the recipient are read from the shared{" "}
        <code>ProtocolConfig</code> on every contribution, so a rate change
        applies to existing pools without redeploying anything. The contract
        re-checks the 300 bps (3%) ceiling itself on every contribution and
        reverts above it, so no configuration can exceed the cap.
      </p>
      <p>
        The protocol administrator&apos;s authority stops at that configuration.
        It confers no ability to withdraw or move pool assets, change pool
        ownership, or bypass a pool&apos;s withdrawal rules.
      </p>
      <p>
        The USD minimum is checked against the <em>gross</em> amount, so a
        contribution that meets <code>minimumUsd</code> is never rejected
        because of the fee.
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

// V2 (fee-bearing). feeRecipient is the zero address when feeAmount is 0.
event Funded(
    address indexed funder,
    address indexed feeRecipient,
    uint256 grossAmount,
    uint256 feeAmount,
    uint256 netAmount
);
event FundedERC20(
    address indexed token,
    address indexed funder,
    address indexed feeRecipient,
    uint256 grossAmount,
    uint256 feeAmount,
    uint256 netAmount
);

// V1 (no fee) emitted the simpler form:
// event Funded(address indexed funder, uint256 amount);
// event FundedERC20(address indexed token, address indexed funder, uint256 amount);
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
        <li><code>CommunityPool__ProtocolConfigNotContract</code> (V2)</li>
        <li><code>CommunityPool__ProtocolFeeExceedsMaximum</code> (V2)</li>
        <li><code>CommunityPool__InvalidFeeRecipient</code> (V2)</li>
        <li><code>CommunityPool__ProtocolFeeTransferFailed</code> (V2)</li>
        <li><code>CommunityPool__UnsupportedTokenBehavior</code> (V2)</li>
        <li><code>PriceConverter__InvalidPrice</code> (V2)</li>
        <li><code>PriceConverter__IncompleteRound</code> (V2)</li>
        <li><code>PriceConverter__FutureTimestamp</code> (V2)</li>
        <li><code>PriceConverter__StalePrice</code> (V2)</li>
        <li><code>PriceConverter__UnsupportedFeedDecimals</code> (V2)</li>
        <li><code>PriceConverter__InvalidMaxPriceAge</code> (V2)</li>
      </ul>

      <h2>Deployed addresses</h2>
      <p>
        Pools are deployed by their creators, so each pool has its own address —
        the one shown after deployment and on the pool&apos;s page. The one
        shared contract is <code>ProtocolConfig</code> on Ethereum mainnet, at{" "}
        <code>0x2eD7F089a6C2971B24eA91121aD65f9242F622c0</code>, which every V2
        pool reads its fee rate and treasury from. Sepolia deployment artifacts
        live in <code>communitypool/broadcast/</code>.
      </p>
    </DocsPage>
  );
}
