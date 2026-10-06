'use client';

import Link from 'next/link';
import { useDepotDetailContext } from '@/components/depot/data/DepotDetailProvider';
import { EmptyState, StaleStrip } from '@/components/depot/shell/DataStates';
import { depotTrendsPath, MODELLED_HISTORY_NOTE } from '@/lib/depot/forecast/trendsPageModel';
import type { MetricKey } from '@/lib/depot/sim/types';
import { DEPOT_NOT_FOUND_MESSAGE } from '@/hooks/useDepotDetail';
import { useDepotDistribution } from '@/hooks/useDepotDistribution';
import { useDepotForecast } from '@/hooks/useDepotForecast';
import { AvailabilityPanel } from './AvailabilityPanel';
import { ForecastBlock } from './ForecastBlock';
import { MetricChooser } from './MetricChooser';

const AVAILABLE: MetricKey = 'available';
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
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <MetricChooser path={depotTrendsPath(depotId)} metric={metric} />
        <p className="depot-prose max-w-3xl" data-testid="trends-history-note">
          {MODELLED_HISTORY_NOTE}
        </p>
      </div>
      {stale ? <StaleStrip since={chosen.data?.feedNow ?? null} /> : null}
      <ForecastBlock state={chosen} errorTitle="Could not load this depot's trend" />
      <AvailabilityPanel depotId={depotId} available={available} distribution={distribution} />
    </div>
  );
}
