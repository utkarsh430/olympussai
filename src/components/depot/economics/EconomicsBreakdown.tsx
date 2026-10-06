import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import {
  BREAKDOWN_NOTE,
  breakdownRows,
  explainEconomics,
  peerRankPhrase,
  type EconomicsRow,
} from '@/lib/depot/revenue/economicsPageModel';
import { breakdownButtonName } from '@/lib/depot/revenue/economicsLayout';
import type { EconomicsResponse } from '@/lib/depot/revenue/api';
import { coverageSentence } from '@/lib/depot/revenue/revenuePageModel';

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
  readonly headingRef?: React.Ref<HTMLElement>;
}) {
  return (
    <section
      id="economics-breakdown"
      ref={headingRef}
      tabIndex={-1}
      aria-labelledby="economics-breakdown-title"
      data-testid="depot-economics-breakdown"
      className="depot-panel min-w-0 p-4 focus:outline-none 2xl:sticky 2xl:top-[var(--depot-panel-top)] 2xl:self-start"
    >
      <SectionLabel
        id="economics-breakdown-title"
        label={breakdownButtonName(row.name)}
        tag="modelled"
      />
      <h3 className="font-mono text-sm text-depot-ink">{`${row.name} · ${peerRankPhrase(row)}`}</h3>
      <p className="depot-prose mt-1">{explainEconomics(row)}</p>
      <p className="depot-note mt-1">
        {`Earnings per km: ${coverageSentence(row.lengthCoverage).toLowerCase()}.`}
      </p>
      <div className="depot-table-frame mt-3">
        <table className="depot-table">
          <caption className="sr-only">{`Components of the modelled economics index for ${row.name}`}</caption>
          <thead>
            <tr>
              <th scope="col">Component</th>
              <th scope="col" className="depot-align-right">
                Depot
              </th>
              <th scope="col" className="depot-align-right">
                Peer median
              </th>
              <th scope="col" className="depot-align-right">
                Z (higher is better)
              </th>
              <th scope="col" className="depot-align-right">
                Weight
              </th>
              <th scope="col" className="depot-align-right">
                Contribution
              </th>
            </tr>
          </thead>
          <tbody>
            {breakdownRows(row, weights).map((c) => (
              <tr key={c.key}>
                <th
                  scope="row"
                  className="!static !bg-transparent !text-left !normal-case !tracking-normal !text-depot-ink"
                >
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
