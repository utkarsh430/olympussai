import { ErrorPanel, LoadingBlock } from '@/components/depot/shell/DataStates';
import { Figure, FigureBand } from '@/components/depot/shell/FigureBand';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import {
  BOTH_MODELLED_NOTE,
  compareAvailability,
  type AvailabilityComparison,
  type RequirementInput,
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

interface FiguresProps {
  readonly comparison: Extract<AvailabilityComparison, { status: 'ok' }>;
  readonly requirement: RequirementInput;
}

function Figures({ comparison, requirement }: FiguresProps) {
  return (
    <FigureBand label="Available buses against the requirement">
      <Figure
        label="Requirement"
        value={formatCount(comparison.required)}
        caption={`${formatCount(requirement.peakRequirement)} at peak + ${formatCount(requirement.spareTarget)} spare`}
      />
      <Figure
        label={`Forecast, next ${comparison.horizonDays} days`}
        value={`${formatCount(comparison.lowest)} to ${formatCount(comparison.highest)}`}
        caption="available buses"
      />
      <Figure
        label="Days short"
        caption="below the requirement"
        value={`${comparison.daysBelow} of ${comparison.horizonDays}`}
      />
    </FigureBand>
  );
}

/**
 * The forecast of available buses beside the fleet distribution's requirement for
 * this depot: one short figure band and one sentence saying both sides are modelled.
 * When the comparison cannot be made, a state panel says why in the comparison's own
 * sentence. The longer sentence on what the comparison means is the band's `title`.
 */
export function AvailabilityPanel({ depotId, available, distribution }: AvailabilityPanelProps) {
  const failed =
    available.data === null ? available : distribution.data === null ? distribution : null;
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
    body =
      comparison.status === 'ok' && balance !== null ? (
        <div data-testid="trends-availability" title={comparison.sentence}>
          <Figures comparison={comparison} requirement={balance} />
        </div>
      ) : (
        <div data-testid="trends-availability">
          <StatePanel kind="not-established" sentence={comparison.sentence} />
        </div>
      );
  }
  return (
    <section aria-labelledby="trends-availability-heading" className="min-w-0">
      <SectionLabel
        id="trends-availability-heading"
        label="Available buses against the requirement"
        tag="modelled"
        note={BOTH_MODELLED_NOTE}
      />
      {body}
    </section>
  );
}
