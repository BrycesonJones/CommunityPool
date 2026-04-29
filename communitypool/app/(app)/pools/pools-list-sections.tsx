"use client";

import type { PoolCardView } from "@/lib/pools/pool-activity-service";

/**
 * Row-action payload emitted by the Open Pools table when the user clicks
 * Fund or Withdraw on a specific pool row. Enough context for the respective
 * modal's `initialPool` to bind to the correct pool.
 */
export type PoolRowAction = {
  name: string;
  address: string;
  chainId: number;
};

export type PoolRowActionHandler = (pool: PoolRowAction) => void;

/** Shared copy for Open Pools on the Pools page and Dashboard. */
export const OPEN_POOLS_DESCRIPTION =
  "Active community pools you've deployed, funded, or withdrawn from (still before on-chain expiry).";

function shortAddress(addr: string) {
  if (addr.length < 14) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function expiresLabel(unix: number) {
  if (unix >= Number.MAX_SAFE_INTEGER - 10) return "—";
  return new Date(unix * 1000).toLocaleDateString(undefined, {
    dateStyle: "medium",
  });
}

function formatAmountCell(amount: string | null | undefined, assetType: string): string {
  if (!amount) return "—";
  const n = Number(amount);
  if (!Number.isFinite(n)) return assetType ? `${amount} ${assetType}` : amount;
  const pretty = n.toLocaleString(undefined, { maximumFractionDigits: 8 });
  return assetType ? `${pretty} ${assetType}` : pretty;
}

function formatUsdCell(balanceUsd: number): string {
  return `$${balanceUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function OpenPoolsTableHeadRow({ showActions }: { showActions: boolean }) {
  return (
    <tr className="border-b border-zinc-800">
      <th className="text-left py-3 px-2 font-medium text-zinc-400">
        Address / hash
      </th>
      <th className="text-left py-3 px-2 font-medium text-zinc-400">Type</th>
      <th
        className="text-left py-3 px-2 font-medium text-zinc-400 min-w-[12rem]"
        title="Current on-chain balance of the pool's primary asset"
      >
        Amount
      </th>
      <th
        className="text-left py-3 px-2 font-medium text-zinc-400"
        title="Total USD value of all on-chain assets currently held by the pool"
      >
        Balance (USD)
      </th>
      {showActions && (
        <th className="text-right py-3 px-2 font-medium text-zinc-400">
          Actions
        </th>
      )}
    </tr>
  );
}

function OpenPoolRow({
  pool,
  onFund,
  onWithdraw,
}: {
  pool: PoolCardView;
  onFund?: PoolRowActionHandler;
  onWithdraw?: PoolRowActionHandler;
}) {
  const amountText = formatAmountCell(pool.fundedAmountHuman, pool.assetType);
  const displayType = pool.assetType || "—";
  const showActions = Boolean(onFund || onWithdraw);
  const rowAction: PoolRowAction = {
    name: pool.name,
    address: pool.contractAddress,
    chainId: pool.chainId,
  };
  return (
    <tr className="border-b border-zinc-800/80 hover:bg-zinc-900/40 align-top">
      <td className="py-3 px-2 text-white font-mono text-xs">
        <div className="flex flex-col gap-0.5 min-w-0">
          {pool.explorerAddressUrl ? (
            <a
              href={pool.explorerAddressUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={pool.contractAddress}
              aria-label={`Address ${pool.contractAddress}`}
              className="text-brand-300/90 hover:text-brand-200 hover:underline focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-zinc-950 rounded-sm break-all"
            >
              {shortAddress(pool.contractAddress)}
            </a>
          ) : (
            <span title={pool.contractAddress} className="break-all">
              {shortAddress(pool.contractAddress)}
            </span>
          )}
          {pool.explorerDeployTxUrl && (
            <a
              href={pool.explorerDeployTxUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Deploy tx"
              title={pool.deployTxHash ?? undefined}
              className="text-[11px] font-sans text-brand-300/80 hover:text-brand-200 hover:underline focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-zinc-950 rounded-sm"
            >
              Deploy tx
            </a>
          )}
          {pool.explorerFundTxUrl && (
            <a
              href={pool.explorerFundTxUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Fund tx"
              title={pool.fundTxHash ?? undefined}
              className="text-[11px] font-sans text-brand-300/80 hover:text-brand-200 hover:underline focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-zinc-950 rounded-sm"
            >
              Fund tx
            </a>
          )}
          <span className="text-[11px] font-sans text-zinc-400 truncate">
            {pool.name}
          </span>
          <span className="text-[11px] font-sans text-zinc-500">
            chain {pool.chainId} · last: {pool.lastActivity} · expires{" "}
            {expiresLabel(pool.expiresAtUnix)}
          </span>
          {pool.fundingStatus === "funding_failed" && (
            <span className="text-[11px] font-sans text-amber-400">
              Funding failed after deploy. Use Fund to retry.
            </span>
          )}
        </div>
      </td>
      <td className="py-3 px-2 text-zinc-300">{displayType}</td>
      <td className="py-3 px-2 text-zinc-300 min-w-[12rem] max-w-[28rem] font-mono tabular-nums text-xs break-all">
        {amountText}
      </td>
      <td className="py-3 px-2 text-zinc-300 tabular-nums">
        {formatUsdCell(pool.balanceUsd)}
      </td>
      {showActions && (
        <td className="py-3 px-2 text-right whitespace-nowrap">
          <div className="inline-flex items-center gap-2">
            {onFund && (
              <button
                type="button"
                onClick={() => onFund(rowAction)}
                className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs font-medium text-zinc-100 hover:border-zinc-500 hover:text-white focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-zinc-950"
                aria-label={`Fund ${pool.name}`}
              >
                Fund
              </button>
            )}
            {onWithdraw && (
              <button
                type="button"
                onClick={() => onWithdraw(rowAction)}
                className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs font-medium text-zinc-100 hover:border-zinc-500 hover:text-white focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-zinc-950"
                aria-label={`Withdraw from ${pool.name}`}
              >
                Withdraw
              </button>
            )}
          </div>
        </td>
      )}
    </tr>
  );
}

export function OpenPoolsSection({
  openPools,
  emptyOpenHint,
  description = OPEN_POOLS_DESCRIPTION,
  listTopMarginClass = "",
  onFundPool,
  onWithdrawPool,
}: {
  openPools: PoolCardView[];
  emptyOpenHint: string;
  description?: string;
  /** e.g. "mt-10" on Pools page; omit on Dashboard inside an existing card. */
  listTopMarginClass?: string;
  /** Row-level Fund action; when provided, Actions column is rendered. */
  onFundPool?: PoolRowActionHandler;
  /** Row-level Withdraw action; when provided, Actions column is rendered. */
  onWithdrawPool?: PoolRowActionHandler;
}) {
  const showActions = Boolean(onFundPool || onWithdrawPool);
  return (
    <section className={listTopMarginClass}>
      <h2 className="text-lg font-semibold text-white mb-2">Open Pools</h2>
      <p className="text-sm text-zinc-500 mb-4">{description}</p>
      {openPools.length === 0 ? (
        <p className="text-sm text-zinc-500 px-4 py-6">
          {emptyOpenHint}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <OpenPoolsTableHeadRow showActions={showActions} />
            </thead>
            <tbody>
              {openPools.map((pool) => (
                <OpenPoolRow
                  key={pool.id}
                  pool={pool}
                  onFund={onFundPool}
                  onWithdraw={onWithdrawPool}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ClosedPoolsSection({
  closedPools,
  emptyClosedHint,
}: {
  closedPools: PoolCardView[];
  emptyClosedHint: string;
}) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-white mb-2">Closed Pools</h2>
      <p className="text-sm text-zinc-500 mb-4">
        Pools past on-chain expiry — funding and owner withdrawals are closed;
        remaining balances should be released to the deployer via the contract.
      </p>
      {closedPools.length === 0 ? (
        <p className="text-sm text-zinc-500 px-4 py-6">
          {emptyClosedHint}
        </p>
      ) : (
        <ul className="rounded-2xl border border-zinc-800 bg-zinc-950/60 divide-y divide-zinc-800">
          {closedPools.map((pool) => (
            <li
              key={pool.id}
              className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium text-white">{pool.name}</p>
                {pool.description ? (
                  <p className="text-xs text-zinc-400 line-clamp-2">
                    {pool.description}
                  </p>
                ) : null}
                <p
                  className="text-xs text-zinc-500 font-mono"
                  title={pool.address}
                >
                  {shortAddress(pool.address)} · chain {pool.chainId} · last:{" "}
                  {pool.lastActivity}
                </p>
                <p className="text-xs text-zinc-500">
                  Expired {expiresLabel(pool.expiresAtUnix)}
                </p>
              </div>
              <div className="text-sm text-zinc-300 shrink-0">
                <span className="text-zinc-500 mr-1">Est. total:</span>$
                {pool.totalUsd.toLocaleString()}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function PoolsListSections({
  openPools,
  closedPools,
  emptyOpenHint,
  emptyClosedHint,
  onFundPool,
  onWithdrawPool,
}: {
  openPools: PoolCardView[];
  closedPools: PoolCardView[];
  emptyOpenHint: string;
  emptyClosedHint: string;
  onFundPool?: PoolRowActionHandler;
  onWithdrawPool?: PoolRowActionHandler;
}) {
  return (
    <div className="mt-10 space-y-8">
      <OpenPoolsSection
        openPools={openPools}
        emptyOpenHint={emptyOpenHint}
        onFundPool={onFundPool}
        onWithdrawPool={onWithdrawPool}
      />
      <ClosedPoolsSection
        closedPools={closedPools}
        emptyClosedHint={emptyClosedHint}
      />
    </div>
  );
}
