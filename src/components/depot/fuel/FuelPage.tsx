'use client';

import { useDepotDetailContext } from '@/components/depot/data/DepotDetailProvider';
import { HowProduced } from '@/components/depot/revenue/HowProduced';
import { modelledDaySentence } from '@/lib/depot/sim/operatingDayWording';
import { ErrorPanel, StaleStrip } from '@/components/depot/shell/DataStates';
import { Figure, FigureBand } from '@/components/depot/shell/FigureBand';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { DEPOT_NOT_FOUND_MESSAGE } from '@/hooks/useDepotDetail';
import { useDepotFuel } from '@/hooks/useDepotFuel';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/usePolledJson';
import { emptyText } from '@/lib/depot/fuel/fuelPageModel';
import { fuelBand, fuelDisclosure } from '@/lib/depot/fuel/fuelPageTables';
import { ClassTable } from './ClassTable';
import { FlaggedList } from './FlaggedList';
import { RouteTable } from './RouteTable';

/** Placeholder footprint: the band, then the stand-out table, the class table and the routes. */
const LOADING_ROWS = 14;

/**
 * The fuel and cost page body for one depot. The page's provenance line is in its
 * header; here the band, "Buses that stand out" (the hero), the class and route
 * tables, and the closed disclosure that says how the figures are produced.
 */
export function FuelPage() {
  const { depotId, data: detail } = useDepotDetailContext();
  const { data, error, loading, refresh } = useDepotFuel(depotId);

  if (loading)
    return (
      <StatePanel kind="loading" rows={LOADING_ROWS} sentence="Loading the fuel and cost view" />
    );
  if (!data) {
    return (
      <ErrorPanel
        title={
          error === DEPOT_NOT_FOUND_MESSAGE ? DEPOT_NOT_FOUND_MESSAGE : 'Could not load fuel data'
        }
        message={error ?? DEPOT_UNAVAILABLE_MESSAGE}
        onRetry={refresh}
      />
    );
  }
  const empty = data.totals.distanceKm <= 0;
  return (
    <div className="flex flex-col gap-6">
      {data.stale || error ? <StaleStrip since={data.feedNow} /> : null}
      <p className="-mt-3 max-w-3xl font-sans text-[13px] text-depot-muted">
        {modelledDaySentence({
          scheduled: detail?.outshed.coverage ?? null,
          duties: data.day.duties,
          routes: data.day.routes,
        })}
      </p>
      <div>
        <FigureBand label={`Fuel and cost for ${data.operatingDate}`}>
          {fuelBand(data).map((f) => (
            <Figure key={f.key} label={f.label} value={f.value} caption={f.caption} />
          ))}
        </FigureBand>
      </div>
      {empty ? (
        <StatePanel kind="empty" sentence={emptyText(data.day)} />
      ) : (
        <>
          <FlaggedList data={data} />
          <ClassTable rows={data.perClass} />
          <RouteTable rows={data.perRoute} total={data.routeTotal} other={data.otherRoutes} />
        </>
      )}
      <HowProduced paragraphs={fuelDisclosure(data)} />
    </div>
  );
}
