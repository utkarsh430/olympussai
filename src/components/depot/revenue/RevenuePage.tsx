'use client';

import { useDepotDetailContext } from '@/components/depot/data/DepotDetailProvider';
import { modelledDaySentence } from '@/lib/depot/sim/operatingDayWording';
import { ErrorPanel, StaleStrip } from '@/components/depot/shell/DataStates';
import { Figure, FigureBand } from '@/components/depot/shell/FigureBand';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { DEPOT_NOT_FOUND_MESSAGE } from '@/hooks/useDepotDetail';
import { useDepotRevenue } from '@/hooks/useDepotRevenue';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/usePolledJson';
import { revenueBand, revenueDisclosure } from '@/lib/depot/revenue/revenueTablePageModel';
import { HowProduced } from './HowProduced';
import { RevenueRoutesTable } from './RevenueRoutesTable';

/** Placeholder footprint: the band, then the table. */
const LOADING_ROWS = 8;

/**
 * The revenue page body: a short, calm page. The provenance line is in the header;
 * here the day's band, one table by route with an inline revenue bar, and the
 * closed disclosure that says how the figures are produced.
 */
export function RevenuePage() {
  const { depotId, data: detail } = useDepotDetailContext();
  const { data, error, loading, refresh } = useDepotRevenue(depotId);

  if (loading)
    return <StatePanel kind="loading" rows={LOADING_ROWS} sentence="Loading the revenue view" />;
  if (!data) {
    return (
      <ErrorPanel
        title={
          error === DEPOT_NOT_FOUND_MESSAGE
            ? DEPOT_NOT_FOUND_MESSAGE
            : 'Could not load revenue figures'
        }
        message={error ?? DEPOT_UNAVAILABLE_MESSAGE}
        onRetry={refresh}
      />
    );
  }
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
        <FigureBand label={`Revenue and ridership for ${data.operatingDate}`}>
          {revenueBand(data.summary).map((f) => (
            <Figure key={f.key} label={f.label} value={f.value} caption={f.caption} />
          ))}
        </FigureBand>
      </div>
      <RevenueRoutesTable routes={data.routes} coverage={data.summary.lengthCoverage} />
      <HowProduced paragraphs={revenueDisclosure(data.model.params, data.summary, data.notes)} />
    </div>
  );
}
