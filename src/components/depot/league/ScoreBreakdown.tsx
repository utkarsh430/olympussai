import {
  PEER_GROUP_LABEL,
  explainRow,
  formatRate,
  type LeagueRow,
} from '@/lib/depot/league/leagueModel';

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
export function ScoreBreakdown({ row }: { readonly row: LeagueRow }) {
  const group = row.peerGroup === null ? null : PEER_GROUP_LABEL[row.peerGroup];
  return (
    <section
      aria-labelledby="score-breakdown-title"
      data-testid="depot-score-breakdown"
      className="depot-panel mt-4 p-4"
    >
      <p className="depot-label">Score breakdown</p>
      <h2 id="score-breakdown-title" className="mt-1 font-mono text-sm text-depot-ink">
        {row.name}
        {row.ranked && row.rank !== null && row.peerCount !== null && group !== null
          ? ` · rank ${row.rank} of ${row.peerCount} in ${group}`
          : ' · not ranked'}
      </h2>
      <p className="depot-prose mt-1">{explainRow(row)}</p>
      {row.components.length > 0 ? (
        <div className="depot-table-frame mt-3">
          <table className="depot-table">
            <caption className="sr-only">{`Components of the efficiency index for ${row.name}`}</caption>
            <thead>
              <tr>
                <th scope="col">Component</th>
                <th scope="col" className="depot-align-right">Depot</th>
                <th scope="col" className="depot-align-right">Peer median</th>
                <th scope="col" className="depot-align-right">Z (higher is better)</th>
                <th scope="col" className="depot-align-right">Weight</th>
                <th scope="col" className="depot-align-right">Contribution</th>
              </tr>
            </thead>
            <tbody>
              {row.components.map((c) => (
                <tr key={c.key}>
                  <th scope="row" className="!text-left !normal-case !tracking-normal !text-depot-ink">
                    {c.label}
                  </th>
                  <td className="depot-align-right">{formatRate(c.value)}</td>
                  <td className="depot-align-right">{formatRate(c.peerMedian)}</td>
                  <td className="depot-align-right">{c.z === null ? '—' : signed(c.z)}</td>
                  <td className="depot-align-right">{Math.round(c.weight * WEIGHT_PERCENT)}%</td>
                  <td className="depot-align-right">{row.ranked ? signed(c.contribution) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="depot-prose mt-3 text-xs">
        The contributions are summed and scaled so a typical peer sits at 50: a total of +3 reaches
        100 and −3 reaches 0. Each rate is compared with the peer median, not with an absolute
        target.
      </p>
    </section>
  );
}
