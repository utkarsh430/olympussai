'use client';

import { useDepotDetailContext } from '@/components/depot/data/DepotDetailProvider';
import { modelledDaySentence } from '@/lib/depot/sim/operatingDayWording';
import { ErrorPanel, LoadingBlock, StaleStrip } from '@/components/depot/shell/DataStates';
import { DEPOT_NOT_FOUND_MESSAGE } from '@/hooks/useDepotDetail';
import { useDepotRevenue } from '@/hooks/useDepotRevenue';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/usePolledJson';
import { ModelledStatement } from './ModelledStatement';
import { RevenueHero } from './RevenueHero';
import { RevenueRoutesTable } from './RevenueRoutesTable';
import { RevenueSummary } from './RevenueSummary';

/** Placeholder footprint: the summary row, the hero, then the table. */
const LOADING_ROWS = 12;

/**
 * The revenue page body: the day's modelled summary, revenue by route as the
 * hero, the by-route table and the MODELLED statement. The depot id comes from
 * the scope's provider, which has already validated it.
 */
export function RevenuePage() {
  const { depotId, data: detail } = useDepotDetailContext();
  const { data, error, loading, refresh } = useDepotRevenue(depotId);

  if (loading) return <LoadingBlock rows={LOADING_ROWS} label="Loading the revenue view" />;
  if (!data) {
    return (
      <ErrorPanel
        title={error === DEPOT_NOT_FOUND_MESSAGE ? DEPOT_NOT_FOUND_MESSAGE : 'Could not load revenue figures'}
        message={error ?? DEPOT_UNAVAILABLE_MESSAGE}
        onRetry={refresh}
      />
    );
  }
  return (
    <div className="flex flex-col gap-8">
      {data.stale || error ? <StaleStrip since={data.feedNow} /> : null}
      <p className="depot-prose max-w-3xl">
        {modelledDaySentence({
          scheduled: detail?.outshed.coverage ?? null,
          duties: data.day.duties,
          routes: data.day.routes,
        })}
      </p>
      <RevenueSummary totals={data.summary} operatingDate={data.operatingDate} />
      <RevenueHero routes={data.routes} />
      <RevenueRoutesTable routes={data.routes} />
      <ModelledStatement params={data.model.params} notes={data.notes} />
    </div>
  );
}
