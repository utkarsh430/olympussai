import { ErrorPanel, LoadingBlock } from '@/components/depot/shell/DataStates';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import {
  BOTH_MODELLED_NOTE,
  compareAvailability,
  type AvailabilityComparison,
} from '@/lib/depot/forecast/availabilityComparison';
import { formatCount } from '@/lib/depot/format';
import type { DepotDistributionState } from '@/hooks/useDepotDistribution';
import type { DepotForecastState } from '@/hooks/useDepotForecast';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/usePolledJson';

const LOADING_ROWS = 3;

export interface AvailabilityPanelProps {
  readonly depotId: string;
  /** The depot's forecast of available buses. */
  readonly available: DepotForecastState;
  readonly distribution: DepotDistributionState;
}

function Figures({ comparison }: { readonly comparison: AvailabilityComparison }) {
  if (comparison.status !== 'ok') return null;
  const cells = [
    { label: 'Modelled requirement', value: formatCount(comparison.required) },
    {
      label: `Forecast, next ${comparison.horizonDays} days`,
      value: `${formatCount(comparison.lowest)} to ${formatCount(comparison.highest)}`,
    },
    {
      label: 'Days below the requirement',
      value: `${comparison.daysBelow} of ${comparison.horizonDays}`,
    },
  ];
  return (
    <dl className="flex flex-wrap gap-x-8 gap-y-3">
      {cells.map((cell) => (
        <div key={cell.label} className="min-w-0">
          <dt className="depot-label">{cell.label}</dt>
          <dd className="mt-0.5 flex flex-wrap items-baseline gap-2">
            <span className="text-[15px] tabular-nums text-depot-ink">{cell.value}</span>
            <ProvenanceBadge provenance="modelled" />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The forecast of available buses beside the fleet distribution's modelled
 * requirement for this depot, with one sentence on what the comparison
 * means and one saying both sides are modelled.
 */
export function AvailabilityPanel({ depotId, available, distribution }: AvailabilityPanelProps) {
  const failed = available.data === null ? available : distribution.data === null ? distribution : null;
  let body: React.ReactNode;
  if (available.data === null || distribution.data === null) {
    body =
      failed !== null && !failed.loading && failed.error !== null ? (
        <ErrorPanel
          title="Could not load the availability comparison"
          message={failed.error || DEPOT_UNAVAILABLE_MESSAGE}
          onRetry={failed.refresh}
        />
      ) : (
        <LoadingBlock rows={LOADING_ROWS} label="Loading the availability comparison" />
      );
  } else {
    const balance = distribution.data.balances.find((b) => b.depotId === depotId) ?? null;
    const comparison = compareAvailability(
      available.data.forecast.result,
      balance,
      available.data.sentences.unavailable,
    );
    body = (
      <div className="flex flex-col gap-3" data-testid="trends-availability">
        <Figures comparison={comparison} />
        <p className="depot-prose max-w-3xl">{comparison.sentence}</p>
        <p className="font-sans text-xs text-depot-muted">{BOTH_MODELLED_NOTE}</p>
      </div>
    );
  }
  return (
    <section aria-labelledby="trends-availability-heading" className="min-w-0">
      <h2 id="trends-availability-heading" className="depot-section-label">
        Available buses against the requirement, MODELLED
      </h2>
      {body}
    </section>
  );
}
