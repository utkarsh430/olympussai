import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import { formatCount } from '@/lib/depot/format';
import type { PlanSummary } from '@/lib/depot/rebalance/rebalanceModel';

export interface BalanceSummaryProps {
  readonly summary: PlanSummary;
  /** True while a what-if scenario, not the server's plan, is showing. */
  readonly scenarioActive: boolean;
}

interface Line {
  readonly key: string;
  readonly label: string;
  readonly before: number;
  readonly after: number;
}

function linesOf(s: PlanSummary): readonly Line[] {
  return [
    {
      key: 'deficit-depots',
      label: 'Depots short of buses',
      before: s.before.depotsInDeficit,
      after: s.after.depotsInDeficit,
    },
    {
      key: 'surplus-depots',
      label: 'Depots with spare buses',
      before: s.before.depotsInSurplus,
      after: s.after.depotsInSurplus,
    },
    {
      key: 'deficit',
      label: 'Buses short, network',
      before: s.before.totalDeficit,
      after: s.after.totalDeficit,
    },
    {
      key: 'surplus',
      label: 'Spare buses, network',
      before: s.before.totalSurplus,
      after: s.after.totalSurplus,
    },
  ];
}

/**
 * The network's position before and after the recommended transfers, as a
 * plain two-column ledger, then what the plan moves and what it cannot cover.
 */
export function BalanceSummary({ summary, scenarioActive }: BalanceSummaryProps) {
  return (
    <section aria-labelledby="rebalance-summary-heading" data-testid="rebalance-summary">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 id="rebalance-summary-heading" className="depot-section-label mb-0">
          {scenarioActive ? 'Before and after, what-if scenario' : 'Before and after'}
        </h2>
        <ProvenanceBadge provenance="modelled" />
      </div>
      <div className="depot-table-frame max-h-none">
        <table className="depot-table">
          <caption className="sr-only">Network balance before and after the transfers</caption>
          <thead>
            <tr>
              <th scope="col">Figure</th>
              <th scope="col" className="depot-align-right">
                Before
              </th>
              <th scope="col" className="depot-align-right">
                After
              </th>
            </tr>
          </thead>
          <tbody>
            {linesOf(summary).map((line) => (
              <tr key={line.key}>
                <th scope="row" className="font-normal normal-case tracking-normal text-depot-ink">
                  {line.label}
                </th>
                <td className="depot-align-right">{formatCount(line.before)}</td>
                <td className="depot-align-right">{formatCount(line.after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="depot-kpi-grid mt-4">
        <div className="depot-kpi-cell">
          <dt className="depot-label">Buses moved</dt>
          <dd className="mt-1 text-[20px] text-depot-ink">{formatCount(summary.busesMoved)}</dd>
          <dd className="depot-prose text-xs">in {formatCount(summary.transfers)} transfers</dd>
        </div>
        <div className="depot-kpi-cell">
          <dt className="depot-label">Shortfall covered</dt>
          <dd className="mt-1 text-[20px] text-depot-ink">{formatCount(summary.coveredDeficit)}</dd>
          <dd className="depot-prose text-xs">buses</dd>
        </div>
        <div className="depot-kpi-cell">
          <dt className="depot-label">Shortfall left</dt>
          <dd className="mt-1 text-[20px] text-depot-ink">
            {formatCount(summary.uncoveredDeficit)}
          </dd>
          <dd className="depot-prose text-xs">buses, listed below</dd>
        </div>
        <div className="depot-kpi-cell">
          <dt className="depot-label">Empty running</dt>
          <dd className="mt-1 text-[20px] text-depot-ink">{summary.busKm.toFixed(1)}</dd>
          <dd className="depot-prose text-xs">bus-km, road estimate</dd>
        </div>
      </dl>
    </section>
  );
}
