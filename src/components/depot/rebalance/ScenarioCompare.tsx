import { formatCount } from '@/lib/depot/format';
import type { ScenarioDelta } from '@/lib/depot/optimise/types';
import type { PlanSummary } from '@/lib/depot/rebalance/rebalanceModel';
import { describeDelta } from '@/lib/depot/rebalance/scenarioForm';

export interface ScenarioCompareProps {
  /** Scenario minus baseline, from `compareOutcomes`. */
  readonly delta: ScenarioDelta;
  readonly baseline: PlanSummary;
  readonly scenario: PlanSummary;
}

interface Line {
  readonly key: string;
  readonly label: string;
  readonly baseline: string;
  readonly scenario: string;
  readonly words: string;
}

function linesOf(d: ScenarioDelta, a: PlanSummary, b: PlanSummary): readonly Line[] {
  return [
    {
      key: 'transfers',
      label: 'Transfers',
      baseline: formatCount(a.transfers),
      scenario: formatCount(b.transfers),
      words: describeDelta(d.transfers, 'transfer', 'transfers', ''),
    },
    {
      key: 'moved',
      label: 'Buses moved',
      baseline: formatCount(a.busesMoved),
      scenario: formatCount(b.busesMoved),
      words: describeDelta(d.busesMoved, 'bus', 'buses', 'moved'),
    },
    {
      key: 'covered',
      label: 'Shortfall covered',
      baseline: formatCount(a.coveredDeficit),
      scenario: formatCount(b.coveredDeficit),
      words: describeDelta(d.coveredDeficit, 'bus', 'buses', 'of shortfall covered'),
    },
    {
      key: 'uncovered',
      label: 'Shortfall left',
      baseline: formatCount(a.uncoveredDeficit),
      scenario: formatCount(b.uncoveredDeficit),
      words: describeDelta(d.uncoveredDeficit, 'bus', 'buses', 'of shortfall left'),
    },
    {
      key: 'short-after',
      label: 'Depots still short',
      baseline: formatCount(a.after.depotsInDeficit),
      scenario: formatCount(b.after.depotsInDeficit),
      words: describeDelta(d.depotsInDeficitAfter, 'depot', 'depots', 'still short'),
    },
    {
      key: 'bus-km',
      label: 'Empty running, bus-km',
      baseline: a.busKm.toFixed(1),
      scenario: b.busKm.toFixed(1),
      words: describeDelta(d.totalBusKm, 'bus-km', 'bus-km', 'of empty running'),
    },
  ];
}

/** The modelled baseline plan against the what-if plan, each difference said in words. */
export function ScenarioCompare({ delta, baseline, scenario }: ScenarioCompareProps) {
  return (
    <section aria-labelledby="rebalance-compare-heading" data-testid="rebalance-compare">
      <h2 id="rebalance-compare-heading" className="depot-section-label">
        Baseline against what-if
      </h2>
      <div className="depot-table-frame max-h-none">
        <table className="depot-table">
          <caption className="sr-only">The baseline plan compared with the what-if plan</caption>
          <thead>
            <tr>
              <th scope="col">Figure</th>
              <th scope="col" className="depot-align-right">
                Baseline
              </th>
              <th scope="col" className="depot-align-right">
                What-if
              </th>
              <th scope="col">Difference</th>
            </tr>
          </thead>
          <tbody>
            {linesOf(delta, baseline, scenario).map((line) => (
              <tr key={line.key}>
                <th scope="row" className="font-normal normal-case tracking-normal text-depot-ink">
                  {line.label}
                </th>
                <td className="depot-align-right">{line.baseline}</td>
                <td className="depot-align-right">{line.scenario}</td>
                <td className="whitespace-nowrap text-depot-muted">{line.words}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
