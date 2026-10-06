'use client';

import { useDepotDetailContext } from '@/components/depot/data/DepotDetailProvider';
import { ErrorPanel, LoadingBlock, StaleStrip } from '@/components/depot/shell/DataStates';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/usePolledJson';
import { useDepotMaintenance } from '@/hooks/useDepotMaintenance';
import { DEPOT_NOT_FOUND_MESSAGE } from '@/hooks/useDepotDetail';
import { OffRoadList } from './OffRoadList';
import { PreventiveSection } from './PreventiveSection';
import { WorkshopSection } from './WorkshopSection';

/** Placeholder footprint: the hero list, then the two quieter sections. */
const LOADING_ROWS = 12;

/**
 * The maintenance page body: what is off the road now (the hero), the
 * preventive view on a modelled odometer, and the workshop's load. The depot id
 * comes from the scope's provider, which has already validated it.
 */
export function MaintenancePage() {
  const { depotId } = useDepotDetailContext();
  const { data, error, loading, refresh } = useDepotMaintenance(depotId);

  if (loading) return <LoadingBlock rows={LOADING_ROWS} label="Loading the maintenance view" />;
  if (!data) {
    return (
      <ErrorPanel
        title={error === DEPOT_NOT_FOUND_MESSAGE ? DEPOT_NOT_FOUND_MESSAGE : undefined}
        message={error ?? DEPOT_UNAVAILABLE_MESSAGE}
        onRetry={refresh}
      />
    );
  }
  return (
    <div className="flex flex-col gap-8">
      {data.stale || error ? <StaleStrip since={data.feedNow} /> : null}
      <OffRoadList depotId={data.depot.id} buses={data.offRoad.buses} />
      <div className="grid grid-cols-1 gap-8 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          <PreventiveSection
            depotId={data.depot.id}
            preventive={data.preventive}
            distanceCoverage={data.distanceCoverage}
          />
        </div>
        <div className="min-w-0">
          <WorkshopSection workshop={data.workshop} />
        </div>
      </div>
    </div>
  );
}
