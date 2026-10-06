'use client';

import { useDepotDetailContext } from '@/components/depot/data/DepotDetailProvider';
import { ErrorPanel, StaleNotice } from '@/components/depot/shell/DataStates';
import { Figure, FigureBand } from '@/components/depot/shell/FigureBand';
import { PageHeader } from '@/components/depot/shell/PageHeader';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { DEPOT_NOT_FOUND_MESSAGE } from '@/lib/depot/scopeState';
import type { ProvenanceDescription } from '@/lib/depot/provenanceLine';
import { useDepotRevenue } from '@/hooks/useDepotRevenue';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/usePolledJson';
import { formatPlainDate } from '@/lib/depot/format';
import type { RevenueResponse } from '@/lib/depot/revenue/api';
import { modelledDayLine } from '@/lib/depot/modelledDayLine';
import { revenueHeader } from '@/lib/depot/revenue/revenueHeader';
import {
  NO_TRIPS_REMEDY,
  noTripsSentence,
  revenueBand,
  revenueDisclosure,
} from '@/lib/depot/revenue/revenueTablePageModel';
import { HowProduced } from './HowProduced';
import { RevenueRoutesTable } from './RevenueRoutesTable';
import { DEPOT_FIGURE_MEANING } from '@/lib/depot/figureTones';

/** Placeholder footprint: the band, then the table. */
const LOADING_ROWS = 8;

/**
 * The revenue page: a short, calm page. The header's provenance line carries the dated
 * modelled day once the response arrives; then the day's band, one table by route, and
 * the closed disclosure. An empty modelled day is the state panel in place of the band.
 */
export function RevenuePage({ provenance }: { readonly provenance: ProvenanceDescription }) {
  const { depotId, data: detail } = useDepotDetailContext();
  const { data, error, loading, refresh } = useDepotRevenue(depotId);
  const modelledDay = data
    ? modelledDayLine({
        operatingDate: data.operatingDate,
        duties: data.day.duties,
        routes: data.day.routes,
        scheduled: detail?.outshed.coverage ?? null,
      })
    : undefined;
  return (
    <>
      <PageHeader {...revenueHeader(provenance, modelledDay)} />
      {loading ? (
        <StatePanel kind="loading" rows={LOADING_ROWS} sentence="Loading the revenue view" />
      ) : data ? (
        <RevenueBody data={data} stale={data.stale || error !== null} />
      ) : (
        <ErrorPanel
          title={
            error === DEPOT_NOT_FOUND_MESSAGE
              ? DEPOT_NOT_FOUND_MESSAGE
              : 'Could not load revenue figures'
          }
          message={error ?? DEPOT_UNAVAILABLE_MESSAGE}
          onRetry={refresh}
        />
      )}
    </>
  );
}

function RevenueBody({ data, stale }: { readonly data: RevenueResponse; readonly stale: boolean }) {
  const empty = data.summary.trips <= 0;
  return (
    <div className="depot-stack">
      {stale ? <StaleNotice since={data.feedNow} /> : null}
      {empty ? (
        <StatePanel kind="empty" sentence={noTripsSentence(data.day)} remedy={NO_TRIPS_REMEDY} />
      ) : (
        <>
          <FigureBand label={`Revenue and ridership for ${formatPlainDate(data.operatingDate)}`}>
            {revenueBand(data.summary).map((f) => (
              <Figure
                key={f.key}
                label={f.label}
                value={f.value}
                caption={f.caption}
                tone={DEPOT_FIGURE_MEANING[f.key]}
              />
            ))}
          </FigureBand>
          <RevenueRoutesTable routes={data.routes} />
        </>
      )}
      <HowProduced paragraphs={revenueDisclosure(data.model.params, data.summary, data.notes)} />
    </div>
  );
}
