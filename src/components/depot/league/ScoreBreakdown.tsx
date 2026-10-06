import { useRef } from 'react';
import { TableOverflowCue, useColumnsToTheRight } from '@/components/depot/shell/TableOverflowCue';
import { formatCount } from '@/lib/depot/format';
import {
  PEER_GROUP_LABEL,
  explainRow,
  formatRate,
  type LeagueRow,
} from '@/lib/depot/league/leagueModel';
import { peerRankPhrase } from '@/lib/depot/league/leagueWording';

const WEIGHT_PERCENT = 100;

function signed(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  if (rounded === 0) return '0.00';
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toFixed(2)}`;
}

/**
 * Why one depot scored what it did: each component's value, the peer median,
 * the robust z against peers and the weighted contribution, then one sentence.
 */
export function ScoreBreakdown({
  row,
  headingRef,
}: {
  readonly row: LeagueRow;
  /** Lets the page move focus here after a selection. */
  readonly headingRef?: React.Ref<HTMLHeadingElement>;
}) {
  const group = row.peerGroup === null ? null : PEER_GROUP_LABEL[row.peerGroup];
  const frame = useRef<HTMLDivElement>(null);
  const moreColumns = useColumnsToTheRight(frame, row.components.length > 0);
  return (
    <section
      aria-labelledby="score-breakdown-title"
      data-testid="depot-score-breakdown"
      className="depot-panel min-w-0 p-4"
    >
      <div className="depot-label">Score breakdown</div>
      <h2
        id="score-breakdown-title"
        ref={headingRef}
        tabIndex={-1}
        className="mt-1 scroll-mt-[var(--depot-anchor-mt)] font-mono text-sm text-depot-ink focus:outline-none"
      >
        {row.name}
        {row.ranked && row.rank !== null && row.peerCount !== null && group !== null
          ? ` · ${peerRankPhrase(row.rank, row.peerCount, group)}`
          : ' · not ranked'}
      </h2>
      <p className="depot-prose mt-1">
        {`Fleet: ${formatCount(row.fleet)} ${row.fleet === 1 ? 'bus' : 'buses'}. `}
        {explainRow(row)}
      </p>
      {row.components.length > 0 ? (
        // Its own relative frame: at 28rem beside the table the six columns may not fit,
        // so they scroll here, with the cue, rather than being clipped.
        <div className="relative mt-3 min-w-0">
          <div ref={frame} className="depot-table-frame !max-h-none">
            <table className="depot-table">
              <caption className="sr-only">{`Components of the efficiency index for ${row.name}`}</caption>
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
                    Z<span className="sr-only">, the robust z against peers; higher is better</span>
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
                {row.components.map((c) => (
                  <tr key={c.key}>
                    <th
                      scope="row"
                      className="!static !bg-transparent !text-left !normal-case !tracking-normal !text-depot-ink"
                    >
                      {c.label}
                    </th>
                    <td className="depot-align-right">{formatRate(c.value)}</td>
                    <td className="depot-align-right">{formatRate(c.peerMedian)}</td>
                    <td className="depot-align-right">{c.z === null ? '—' : signed(c.z)}</td>
                    <td className="depot-align-right">{Math.round(c.weight * WEIGHT_PERCENT)}%</td>
                    <td className="depot-align-right">
                      {row.ranked ? signed(c.contribution) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {moreColumns ? <TableOverflowCue /> : null}
        </div>
      ) : null}
      <p className="depot-prose mt-3 text-xs">
        Z is the robust z against peers; higher is better. The contributions are summed and scaled
        so a typical peer sits at 50: a total of +3 reaches 100 and −3 reaches 0. Each rate is
        compared with the peer median, not with an absolute target.
      </p>
    </section>
  );
}
