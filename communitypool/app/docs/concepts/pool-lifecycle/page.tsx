import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocsPage } from "@/components/docs-page";

export const metadata: Metadata = {
  title: "Pool lifecycle",
  description:
    "How CommunityPool handles funding, withdraws, expiry, and the release path.",
};

export default function PoolLifecyclePage() {
  return (
    <DocsPage
      eyebrow="Concepts"
      title="Pool lifecycle"
      lead="Every pool has three phases: open, expired, and released. Withdraw rules change at each boundary."
      next={{
        label: "CommunityPool.sol",
        href: "/docs/contracts",
      }}
    >
      <h2>Phase 1 — Open (now ≤ expiresAt)</h2>
      <ul>
        <li>
          Funders may call <code>fund()</code> (ETH) or{" "}
          <code>fundERC20(token, amount)</code>. Contributions below the USD
          minimum revert.
        </li>
        <li>
          Any owner may call <code>withdraw(amount)</code> or{" "}
          <code>cheaperWithdraw()</code> (full balance) for ETH, and{" "}
          <code>withdrawTokenAmount(token, amount)</code> or{" "}
          <code>withdrawToken(token)</code> (full balance) for ERC-20s.
        </li>
        <li>Events: <code>Funded</code>, <code>FundedERC20</code>, <code>Withdrawn</code>, <code>WithdrawnToken</code>.</li>
      </ul>

      <h2>Phase 2 — Expired (now &gt; expiresAt, not yet released)</h2>
      <ul>
        <li>
          New funding reverts with <code>CommunityPool__PoolExpired</code>.
        </li>
        <li>
          Owner withdraws revert with{" "}
          <code>CommunityPool__WithdrawDisabledAfterExpiry</code>.
        </li>
        <li>
          Anyone may call <code>releaseExpiredFundsToDeployer()</code>,
          which sweeps all ETH and whitelisted ERC-20 balances to the
          original deployer.
        </li>
      </ul>

      <h2>Phase 3 — Released</h2>
      <p>
        After release, the contract has zero balance in the tracked assets.
        Per-funder totals are not stored on-chain — capture{" "}
        <code>Funded</code> and <code>FundedERC20</code> events off-chain
        if you need historical attribution.
      </p>

      <h2>Partial vs. full withdraws</h2>
      <p>
        The current contract supports both partial (
        <code>withdraw(amount)</code>,{" "}
        <code>withdrawTokenAmount(token, amount)</code>) and full (
        <code>cheaperWithdraw()</code>, <code>withdrawToken(token)</code>)
        withdraws while the pool is open.
      </p>

      <Callout tone="warn" title="Legacy deployments may lack partial withdraws">
        <p>
          Partial-withdraw functions were added mid-build. Pools deployed
          before that change only expose the full-balance variants (
          <code>cheaperWithdraw</code>, <code>withdrawToken</code>). The
          dashboard detects legacy ABIs and hides the partial-amount input
          automatically via <code>poolSupportsPartialWithdraw</code>, which
          probes the deployed bytecode for the partial-withdraw selectors
          at runtime. If you are calling a pool directly, the canonical
          ABI lives in <code>lib/onchain/community-pool-artifact.json</code>
          (the <code>abi</code> field) and CI verifies it against{" "}
          <code>forge-out/</code> on every push.
        </p>
      </Callout>

      <h2>Who can call what</h2>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-left text-zinc-400">
            <th className="py-2 pr-4 font-medium">Function</th>
            <th className="py-2 pr-4 font-medium">Phase</th>
            <th className="py-2 font-medium">Caller</th>
          </tr>
        </thead>
        <tbody className="[&_td]:py-2 [&_td]:pr-4 [&_td]:align-top [&_tr]:border-b [&_tr]:border-zinc-900">
          <tr>
            <td><code>fund / fundERC20</code></td>
            <td>Open</td>
            <td>Anyone</td>
          </tr>
          <tr>
            <td><code>withdraw / cheaperWithdraw</code></td>
            <td>Open</td>
            <td>Any owner</td>
          </tr>
          <tr>
            <td><code>withdrawToken / withdrawTokenAmount</code></td>
            <td>Open</td>
            <td>Any owner</td>
          </tr>
          <tr>
            <td><code>releaseExpiredFundsToDeployer</code></td>
            <td>Expired</td>
            <td>Anyone</td>
          </tr>
        </tbody>
      </table>

      <h2>Related</h2>
      <ul>
        <li>
          <Link href="/docs/contracts">
            Smart-contract reference
          </Link>{" "}
          for function signatures and custom errors.
        </li>
      </ul>
    </DocsPage>
  );
}
