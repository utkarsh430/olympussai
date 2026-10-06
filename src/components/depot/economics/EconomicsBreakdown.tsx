import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import {
  BREAKDOWN_NOTE,
  breakdownRows,
  explainEconomics,
  peerRankPhrase,
  type EconomicsRow,
} from '@/lib/depot/revenue/economicsPageModel';
import type { EconomicsResponse } from '@/lib/depot/revenue/api';
import { coverageSentence, modelledHeader } from '@/lib/depot/revenue/revenuePageModel';

/**
 * Why one depot scored what it did on the MODELLED economics index: each
 * component's value, the peer median, the robust z, its weight and its
 * contribution, then one sentence. It never shows an efficiency value.
 */
export function EconomicsBreakdown({
  row,
  weights,
  headingRef,
}: {
  readonly row: EconomicsRow;
  readonly weights: EconomicsResponse['weights'];
  /** Lets the page move focus here after a selection. */
  readonly headingRef?: React.Ref<HTMLHeadingElement>;
}) {
  return (
    <section
      aria-labelledby="economics-breakdown-title"
      data-testid="depot-economics-breakdown"
      className="depot-panel min-w-0 p-4 xl:sticky xl:top-20 xl:self-start"
    >
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="depot-label">Economics breakdown (modelled)</span>
        <ProvenanceBadge provenance="modelled" />
      </p>
      <h2
        id="economics-breakdown-title"
        ref={headingRef}
        tabIndex={-1}
        className="mt-1 font-mono text-sm text-depot-ink focus:outline-none"
      >
        {`${row.name} · ${peerRankPhrase(row)}`}
      </h2>
      <p className="depot-prose mt-1">{explainEconomics(row)}</p>
      <p className="mt-1 text-[11px] text-depot-muted">
        {`Earnings per km: ${coverageSentence(row.earningsCoverage).toLowerCase()}.`}
      </p>
      <div className="depot-table-frame mt-3">
        <table className="depot-table">
          <caption className="sr-only">{`Components of the modelled economics index for ${row.name}`}</caption>
          <thead>
            <tr>
              <th scope="col">Component</th>
              <th scope="col" className="depot-align-right">{modelledHeader('Depot')}</th>
              <th scope="col" className="depot-align-right">{modelledHeader('Peer median')}</th>
              <th scope="col" className="depot-align-right">{modelledHeader('Z (higher is better)')}</th>
              <th scope="col" className="depot-align-right">Weight</th>
              <th scope="col" className="depot-align-right">{modelledHeader('Contribution')}</th>
            </tr>
          </thead>
          <tbody>
            {breakdownRows(row, weights).map((c) => (
              <tr key={c.key}>
                <th scope="row" className="!static !bg-transparent !text-left !normal-case !tracking-normal !text-depot-ink">
                  {c.label}
                </th>
                <td className="depot-align-right">
                  {c.valueText}
                  {c.coverageText === null ? null : (
                    <span className="block text-[11px] text-depot-muted">{`on ${c.coverageText}`}</span>
                  )}
                </td>
                <td className="depot-align-right">{c.peerMedianText}</td>
                <td className="depot-align-right">{c.zText}</td>
                <td className="depot-align-right">{c.weightText}</td>
                <td className="depot-align-right">{c.contributionText}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="depot-prose mt-3 text-xs">{BREAKDOWN_NOTE}</p>
    </section>
  );
}
