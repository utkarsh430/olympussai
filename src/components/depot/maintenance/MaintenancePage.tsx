'use client';

import { useMemo } from 'react';
import { useDepotDetailContext } from '@/components/depot/data/DepotDetailProvider';
import { ErrorPanel, LoadingBlock, StaleStrip } from '@/components/depot/shell/DataStates';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/usePolledJson';
import { useDepotMaintenance } from '@/hooks/useDepotMaintenance';
import { DEPOT_NOT_FOUND_MESSAGE } from '@/hooks/useDepotDetail';
import { FigureBand, Figure } from '@/components/depot/shell/FigureBand';
import { SERVICE_INTERVAL_KM } from '@/lib/depot/maintenance/config';
import { bandFigures, disclosureItems } from '@/lib/depot/maintenance/pageModel';
import { intervalText } from '@/lib/depot/maintenance/text';
import type { ServiceClass } from '@/lib/depot/sim/types';
import { FiguresDisclosure } from './FiguresDisclosure';
import { OffRoadList } from './OffRoadList';
import { PreventiveSection } from './PreventiveSection';
import { offRoadBusesFrom } from '@/lib/depot/maintenance/offRoad';
import { workshopLoad } from '@/lib/depot/maintenance/workshop';
import { WorkshopSection } from './WorkshopSection';

/** Placeholder footprint: the hero list, then the two quieter sections. */
const LOADING_ROWS = 12;
const MODELLED_LOADING_ROWS = 8;
const INTERVAL_LINES: readonly string[] = (
  Object.keys(SERVICE_INTERVAL_KM) as readonly ServiceClass[]
).map((serviceClass) => intervalText(serviceClass, SERVICE_INTERVAL_KM[serviceClass]));

/**
 * The maintenance page body: the three-figure band (the hero), the live off-road
 * list beside the workshop's load, the preventive table and the closing disclosure.
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
        title={
          detail.error === DEPOT_NOT_FOUND_MESSAGE
            ? DEPOT_NOT_FOUND_MESSAGE
            : 'Could not load maintenance data'
        }
        message={detail.error || DEPOT_UNAVAILABLE_MESSAGE}
        onRetry={detail.refresh}
      />
    );
  }
  const stale = detail.data.stale || modelled.data?.stale === true;
  const preventive = modelled.data?.preventive ?? null;
  const figures = bandFigures(offRoad.length, preventive);
  return (
    <div className="flex flex-col gap-8">
      {stale || detail.error ? <StaleStrip since={detail.data.feedNow} /> : null}
      <FigureBand label="Maintenance figures">
        {figures.map((figure) => (
          <Figure
            key={figure.key}
            label={figure.label}
            value={figure.value}
            caption={figure.caption}
            tag={figure.tag}
          />
        ))}
      </FigureBand>
      <div className="grid grid-cols-1 gap-8 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          <OffRoadList
            depotId={detail.depotId}
            buses={offRoad}
            feedNow={detail.data.feedNow}
          />
        </div>
        <div className="min-w-0">
          {load ? <WorkshopSection load={load} /> : null}
        </div>
      </div>
      {modelled.data && preventive ? (
        <>
          <PreventiveSection depotId={detail.depotId} preventive={preventive} />
          <FiguresDisclosure
            sections={disclosureItems(
              { ...preventive, intervals: INTERVAL_LINES },
              modelled.data.distanceCoverage.coverage,
            )}
          />
        </>
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
