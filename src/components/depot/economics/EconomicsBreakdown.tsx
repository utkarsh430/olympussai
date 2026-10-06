import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
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

/** "rank 3 of 41 in its peer group (Small fleets)" as a sentence. */
function rankSentence(row: EconomicsRow): string {
  const phrase = peerRankPhrase(row);
  return `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}.`;
}

/**
 * Why one depot scored what it did on the MODELLED economics index: each
 * component's value, the peer median, the robust z, its weight and its
 * contribution, then one sentence. It never shows an efficiency value. It opens
 * as the expanded row under the depot's row, so it carries one heading and no
 * hairline of its own (the row's rule is above it); Escape closes it.
 */
export function EconomicsBreakdown({
  row,
  weights,
  headingRef,
  onClose,
}: {
  readonly row: EconomicsRow;
  readonly weights: EconomicsResponse['weights'];
  /** Lets the page move focus here when it opens. */
  readonly headingRef?: React.Ref<HTMLElement>;
  readonly onClose: () => void;
}) {
  return (
    <section
      id="economics-breakdown"
      ref={headingRef}
      tabIndex={-1}
      aria-labelledby="economics-breakdown-title"
      data-testid="depot-economics-breakdown"
      className="min-w-0 focus:outline-none"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        onClose();
      }}
    >
      <div className="depot-tag-fit flex min-w-0 items-baseline gap-2">
        <h3
          id="economics-breakdown-title"
          className="min-w-0 font-mono text-[11px] font-normal uppercase leading-4 tracking-[0.16em] text-depot-muted"
        >
          {breakdownButtonName(row.name)}
        </h3>
        <ProvenanceBadge provenance="modelled" pill />
      </div>
      <p className="depot-prose mt-2">{rankSentence(row)}</p>
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
