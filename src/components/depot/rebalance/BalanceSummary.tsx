import { Figure, FigureBand } from '@/components/depot/shell/FigureBand';
import { planFigures } from '@/lib/depot/rebalance/pageLayout';
import type { PlanSummary } from '@/lib/depot/rebalance/rebalanceModel';

export interface BalanceSummaryProps {
  readonly summary: PlanSummary;
  /** True while a what-if scenario, not the server's plan, is showing. */
  readonly scenarioActive: boolean;
}

/**
 * The network before and after the transfers, as one band of four figures ("Short depots
 * 9 → 0"). Every figure here is modelled, which the provenance line already says.
 */
export function BalanceSummary({ summary, scenarioActive }: BalanceSummaryProps) {
  return (
    <div data-testid="rebalance-summary" className="min-w-0">
      <FigureBand
        label={scenarioActive ? 'Before and after, what-if scenario' : 'Before and after the plan'}
      >
        {planFigures(summary).map((f) => (
          <Figure key={f.key} label={f.label} value={f.value} caption={f.caption} />
        ))}
      </FigureBand>
    </div>
  );
}
