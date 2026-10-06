'use client';

import Link from 'next/link';
import { useDepotDetailContext } from '@/components/depot/data/DepotDetailProvider';
import { HowProduced } from '@/components/depot/revenue/HowProduced';
import { ErrorPanel, StaleNotice } from '@/components/depot/shell/DataStates';
import { Figure, FigureBand } from '@/components/depot/shell/FigureBand';
import { PageHeader } from '@/components/depot/shell/PageHeader';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { DEPOT_NOT_FOUND_MESSAGE } from '@/lib/depot/scopeState';
import type { ProvenanceDescription } from '@/lib/depot/provenanceLine';
import { useDepotFuel } from '@/hooks/useDepotFuel';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/usePolledJson';
import { formatPlainDate } from '@/lib/depot/format';
import type { FuelResponse } from '@/lib/depot/fuel/api';
import { fuelHeader } from '@/lib/depot/fuel/fuelHeader';
import { emptyText } from '@/lib/depot/fuel/fuelPageModel';
import { emptyRemedy, fuelBand, fuelDisclosure } from '@/lib/depot/fuel/fuelPageTables';
import { modelledDayLine } from '@/lib/depot/modelledDayLine';
import { ClassTable } from './ClassTable';
import { FlaggedList } from './FlaggedList';
import { RouteTable } from './RouteTable';
import { SOURCES_PATH } from '@/lib/depot/nav';
import { feedAnchor } from '@/lib/depot/sources/sourcesModel';
import { DEPOT_FIGURE_MEANING, isLeadFigure } from '@/lib/depot/figureTones';

/** Placeholder footprint: the band, then the stand-out table, the class table and the routes. */
const LOADING_ROWS = 14;
const FUEL_SOURCES_HREF = `${SOURCES_PATH}#${feedAnchor('fuel')}`;

/** A modelled day with no distance run: no band and no modelled-day line, one panel. */
function isEmptyDay(data: FuelResponse): boolean {
  return data.totals.distanceKm <= 0;
}

/**
 * The fuel and cost page for one depot: the header (its provenance line carries the
 * dated modelled day once the response arrives), the band, "Buses that stand out" (the
 * hero), the class and route tables, and the closed disclosure. An empty modelled day
 * is the state panel in place of the band, never a band of zeros.
 */
export function FuelPage({ provenance }: { readonly provenance: ProvenanceDescription }) {
  const { depotId, data: detail } = useDepotDetailContext();
  const { data, error, loading, refresh } = useDepotFuel(depotId);
  // Fuel C: an empty day prints no "0 duties on 0 routes"; the panel says it once.
  const modelledDay =
    data && !isEmptyDay(data)
      ? modelledDayLine({
          operatingDate: data.operatingDate,
          duties: data.day.duties,
          routes: data.day.routes,
          scheduled: detail?.outshed.coverage ?? null,
        })
      : undefined;
  return (
    <>
      <PageHeader {...fuelHeader(provenance, modelledDay)} />
      {loading ? (
        <StatePanel kind="loading" rows={LOADING_ROWS} sentence="Loading the fuel and cost view" />
      ) : data ? (
        <FuelBody data={data} stale={data.stale || error !== null} />
      ) : (
        <ErrorPanel
          title={
            error === DEPOT_NOT_FOUND_MESSAGE ? DEPOT_NOT_FOUND_MESSAGE : 'Fuel data is unavailable'
          }
          message={error ?? DEPOT_UNAVAILABLE_MESSAGE}
          onRetry={refresh}
        />
      )}
    </>
  );
}

function FuelBody({ data, stale }: { readonly data: FuelResponse; readonly stale: boolean }) {
  return (
    <div className="depot-stack">
      {stale ? <StaleNotice since={data.feedNow} /> : null}
      {isEmptyDay(data) ? (
        <StatePanel
          kind="empty"
          sentence={emptyText(data.day, formatPlainDate(data.operatingDate))}
          remedy={emptyRemedy(data.day)}
          action={
            <Link href={FUEL_SOURCES_HREF} className="depot-link">
              Data sources
            </Link>
          }
        />
      ) : (
        <>
          <FigureBand label={`Fuel and fuel cost for ${formatPlainDate(data.operatingDate)}`}>
            {fuelBand(data).map((f) => (
              <Figure
                key={f.key}
                label={f.label}
                value={f.value}
                caption={f.caption}
                tone={DEPOT_FIGURE_MEANING[f.key]}
                lead={isLeadFigure(f.key)}
              />
            ))}
          </FigureBand>
          <FlaggedList data={data} />
          <ClassTable rows={data.perClass} />
          <RouteTable rows={data.perRoute} total={data.routeTotal} other={data.otherRoutes} />
        </>
      )}
      <HowProduced paragraphs={fuelDisclosure(data)} />
    </div>
  );
}
