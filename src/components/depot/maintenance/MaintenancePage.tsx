'use client';

import { useMemo } from 'react';
import { useDepotDetailContext } from '@/components/depot/data/DepotDetailProvider';
import { ErrorPanel, LoadingBlock, StaleStrip } from '@/components/depot/shell/DataStates';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/usePolledJson';
import { useDepotMaintenance } from '@/hooks/useDepotMaintenance';
import { DEPOT_NOT_FOUND_MESSAGE } from '@/hooks/useDepotDetail';
import { OffRoadList } from './OffRoadList';
import { PreventiveSection } from './PreventiveSection';
import { offRoadBusesFrom } from '@/lib/depot/maintenance/offRoad';
import { workshopLoad } from '@/lib/depot/maintenance/workshop';
import { WorkshopSection } from './WorkshopSection';

/** Placeholder footprint: the hero list, then the two quieter sections. */
const LOADING_ROWS = 12;
const MODELLED_LOADING_ROWS = 8;

/**
 * The maintenance page body: what is off the road now (the hero), the
 * preventive view on a modelled odometer, and the workshop's load.
 *
 * The live off-road list comes from the depot detail the scope layout already
 * polls (`useDepotDetailContext`), the same data the page header counts, so the
 * two can never disagree. The page's own endpoint supplies only the modelled
 * parts; the workshop's live off-road count is taken from the detail list too.
 */
export function MaintenancePage() {
  const detail = useDepotDetailContext();
  const modelled = useDepotMaintenance(detail.depotId);
  const offRoad = useMemo(
    () => (detail.data ? offRoadBusesFrom(detail.data.buses) : []),
    [detail.data],
  );
  const bays = modelled.data?.workshop.load.bays;
  const load = useMemo(
    () => (bays === undefined ? null : workshopLoad(offRoad.length, bays)),
    [bays, offRoad.length],
  );

  if (!detail.data) {
    if (detail.loading || !detail.error) {
      return <LoadingBlock rows={LOADING_ROWS} label="Loading the maintenance view" />;
    }
    return (
      <ErrorPanel
        title={detail.error === DEPOT_NOT_FOUND_MESSAGE ? DEPOT_NOT_FOUND_MESSAGE : undefined}
        message={detail.error || DEPOT_UNAVAILABLE_MESSAGE}
        onRetry={detail.refresh}
      />
    );
  }
  const stale = detail.data.stale || modelled.data?.stale === true;
  return (
    <div className="flex flex-col gap-8">
      {stale || detail.error ? <StaleStrip since={detail.data.feedNow} /> : null}
      <OffRoadList depotId={detail.depotId} buses={offRoad} />
      {modelled.data && load ? (
        <div className="grid grid-cols-1 gap-8 xl:grid-cols-3">
          <div className="min-w-0 xl:col-span-2">
            <PreventiveSection
              depotId={detail.depotId}
              preventive={modelled.data.preventive}
              distanceCoverage={modelled.data.distanceCoverage}
            />
          </div>
          <div className="min-w-0">
            <WorkshopSection load={load} />
          </div>
        </div>
      ) : modelled.error && !modelled.loading ? (
        <ErrorPanel
          title="The modelled parts did not load"
          message={modelled.error || DEPOT_UNAVAILABLE_MESSAGE}
          onRetry={modelled.refresh}
        />
      ) : (
        <LoadingBlock rows={MODELLED_LOADING_ROWS} label="Loading the modelled maintenance view" />
      )}
    </div>
  );
}
