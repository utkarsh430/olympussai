'use client';

import Link from 'next/link';
import { useDepotDetailContext } from '@/components/depot/data/DepotDetailProvider';
import { EmptyState, StaleNotice } from '@/components/depot/shell/DataStates';
import { HowProduced } from '@/components/depot/shell/HowProduced';
import { chartDisclosureParagraphs, depotTrendsPath } from '@/lib/depot/forecast/trendsPageModel';
import type { MetricKey } from '@/lib/depot/sim/types';
import { DEPOT_NOT_FOUND_MESSAGE } from '@/lib/depot/scopeState';
import { useDepotDistribution } from '@/hooks/useDepotDistribution';
import { useDepotForecast } from '@/hooks/useDepotForecast';
import { AvailabilityPanel } from './AvailabilityPanel';
import { ForecastBlock } from './ForecastBlock';
import { MetricChooser } from './MetricChooser';

const AVAILABLE: MetricKey = 'available';
const REQUIREMENT_NOTE =
  "The requirement is the fleet distribution's modelled number of buses the depot needs; the " +
  'forecast is of buses available. Neither side is measured today.';
const NETWORK_ROOT = '/project/depots';

export interface DepotTrendsProps {
  readonly metric: MetricKey;
}

/**
 * One depot's Trends page body. Two or three requests: the chosen metric's
 * forecast, the available-bus forecast (shared with the first when that is
 * the metric chosen) and the fleet distribution for the modelled requirement.
 */
export function DepotTrends({ metric }: DepotTrendsProps) {
  const { depotId, error: detailError } = useDepotDetailContext();
  const scope = { kind: 'depot', depotId } as const;
  const chosen = useDepotForecast({ metric, scope });
  const ownAvailable = useDepotForecast(metric === AVAILABLE ? null : { metric: AVAILABLE, scope });
  const available = metric === AVAILABLE ? chosen : ownAvailable;
  const distribution = useDepotDistribution();

  if (detailError === DEPOT_NOT_FOUND_MESSAGE || chosen.error === DEPOT_NOT_FOUND_MESSAGE) {
    return (
      <div data-testid="trends-unknown-depot">
        <EmptyState>
          No depot has the id {depotId} in the current feed.{' '}
          <Link href={NETWORK_ROOT} className="depot-link">
            Back to the network overview
          </Link>
        </EmptyState>
      </div>
    );
  }
  const stale = chosen.data?.stale === true || (chosen.data !== null && chosen.error !== null);
  return (
    <div className="depot-stack">
      <div className="flex min-w-0 flex-col gap-3">
        <MetricChooser path={depotTrendsPath(depotId)} metric={metric} />
        {stale ? <StaleNotice since={chosen.data?.feedNow ?? null} /> : null}
        <ForecastBlock state={chosen} errorTitle="Could not load this depot's trend" />
      </div>
      <AvailabilityPanel depotId={depotId} available={available} distribution={distribution} />
      <HowProduced
        testId="depot-produced"
        paragraphs={[...chartDisclosureParagraphs(chosen.data?.sentences ?? null), REQUIREMENT_NOTE]}
      />
    </div>
  );
}
