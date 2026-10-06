'use client';

import { useMemo } from 'react';
import { useDepotDetailContext } from '@/components/depot/data/DepotDetailProvider';
import { ErrorPanel, LoadingBlock, StaleStrip } from '@/components/depot/shell/DataStates';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/usePolledJson';
import { useDepotMaintenance } from '@/hooks/useDepotMaintenance';
import { DEPOT_NOT_FOUND_MESSAGE } from '@/hooks/useDepotDetail';
import { FigureBand, Figure } from '@/components/depot/shell/FigureBand';
import { SERVICE_INTERVAL_KM } from '@/lib/depot/maintenance/config';
import {
  bandFigures,
  disclosureItems,
  MODELLED_PARTS_FAILED,
  WORKSHOP_LOAD_FAILED,
} from '@/lib/depot/maintenance/pageModel';
import { StatePanel } from '@/components/depot/shell/StatePanel';
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
  const polled = useDepotMaintenance(detail.depotId);
  // After a failed poll the hook keeps the last answer; it is not shown, since the band
  // and the preventive table would present it as current beside the live list.
  const modelledFailed = polled.error !== null;
  const modelledData = modelledFailed ? null : polled.data;
  const offRoad = useMemo(
    () => (detail.data ? offRoadBusesFrom(detail.data.buses) : []),
    [detail.data],
  );
  const bays = modelledData?.workshop.load.bays;
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
  const stale = detail.data.stale || modelledData?.stale === true;
  const preventive = modelledData?.preventive ?? null;
  const figures = bandFigures(offRoad.length, preventive);
  return (
    <div className="depot-stack">
      {stale || detail.error ? <StaleStrip since={detail.data.feedNow} /> : null}
      {/* The shared stack: 40px from the band's rule to each section's rule. */}
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
      <div data-testid="maintenance-lists" className="depot-stack">
        <div className="grid grid-cols-1 gap-x-8 gap-y-7 sm:gap-y-10 xl:grid-cols-3">
          <div className="min-w-0 xl:col-span-2">
            <OffRoadList depotId={detail.depotId} buses={offRoad} feedNow={detail.data.feedNow} />
          </div>
          <div className="min-w-0">
            {load ? (
              <WorkshopSection load={load} />
            ) : modelledFailed ? (
              <StatePanel kind="error" compact sentence={WORKSHOP_LOAD_FAILED} />
            ) : null}
          </div>
        </div>
        {modelledData && preventive ? (
          <>
            <PreventiveSection depotId={detail.depotId} preventive={preventive} />
            <FiguresDisclosure
              sections={disclosureItems(
                { ...preventive, intervals: INTERVAL_LINES },
                modelledData.distanceCoverage.coverage,
              )}
            />
          </>
        ) : modelledFailed ? (
          <div role="alert" className="flex min-w-0 flex-wrap items-center gap-3">
            <StatePanel kind="error" compact sentence={MODELLED_PARTS_FAILED} />
            <button type="button" className="depot-filter-button" onClick={polled.refresh}>
              Retry
            </button>
          </div>
        ) : (
          <LoadingBlock
            rows={MODELLED_LOADING_ROWS}
            label="Loading the modelled maintenance view"
          />
        )}
      </div>
    </div>
  );
}
