import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import { summaryTiles } from '@/lib/depot/revenue/revenuePageModel';
import type { DepotRevenueTotals } from '@/lib/depot/revenue/types';

/**
 * The day's totals for the operating date. Each tile carries the MODELLED tag:
 * the feed has no ticketing, so none of these is a measured figure.
 */
export function RevenueSummary({
  totals,
  operatingDate,
}: {
  readonly totals: DepotRevenueTotals;
  readonly operatingDate: string;
}) {
  return (
    <section aria-labelledby="revenue-summary-title">
      <h2 id="revenue-summary-title" className="depot-label mb-2">
        {`Summary for ${operatingDate}`}
      </h2>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {summaryTiles(totals).map((tile) => (
          <div key={tile.key} className="depot-panel min-w-0 p-3">
            <dt className="depot-label">{tile.label}</dt>
            <dd className="mt-1 break-words font-mono text-lg tabular-nums text-depot-ink">
              {tile.value}
            </dd>
            <dd className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <ProvenanceBadge provenance="modelled" />
              {tile.note ? <span className="text-[11px] text-depot-muted">{tile.note}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
