'use client';

import Link from 'next/link';
import { useDepotDetailContext } from '@/components/depot/data/DepotDetailProvider';
import {
  EmptyState,
  ErrorPanel,
  LoadingBlock,
  StaleStrip,
} from '@/components/depot/shell/DataStates';
import { DEPOT_NOT_FOUND_MESSAGE } from '@/hooks/useDepotDetail';
import { useDepotFuel } from '@/hooks/useDepotFuel';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/usePolledJson';
import { emptyText, modelledStatement } from '@/lib/depot/fuel/fuelPageModel';
import { ClassBars } from './ClassBars';
import { FlaggedList } from './FlaggedList';
import { FuelSummary } from './FuelSummary';
import { RouteTable } from './RouteTable';

/** Placeholder footprint: summary, the class bars, then the two tables. */
const LOADING_ROWS = 14;
const DATA_SOURCES_HREF = '/project/depots/sources';

/** The fuel and cost page body for one depot; the id comes from the scope's provider. */
export function FuelPage() {
  const { depotId } = useDepotDetailContext();
  const { data, error, loading, refresh } = useDepotFuel(depotId);

  if (loading) return <LoadingBlock rows={LOADING_ROWS} label="Loading the fuel and cost view" />;
  if (!data) {
    return (
      <ErrorPanel
        title={error === DEPOT_NOT_FOUND_MESSAGE ? DEPOT_NOT_FOUND_MESSAGE : undefined}
        message={error ?? DEPOT_UNAVAILABLE_MESSAGE}
        onRetry={refresh}
      />
    );
  }
  const empty = data.totals.distanceKm <= 0;
  return (
    <div className="flex flex-col gap-8">
      {data.stale || error ? <StaleStrip since={data.feedNow} /> : null}
      <FuelSummary data={data} />
      {empty ? (
        <EmptyState>{emptyText()}</EmptyState>
      ) : (
        <>
          <ClassBars rows={data.perClass} />
          <FlaggedList data={data} />
          <RouteTable rows={data.perRoute} total={data.routeTotal} />
        </>
      )}
      <p className="depot-prose max-w-3xl">
        {modelledStatement()}{' '}
        <Link href={DATA_SOURCES_HREF} className="depot-link">
          Data sources
        </Link>
      </p>
    </div>
  );
}
