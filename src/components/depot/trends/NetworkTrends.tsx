'use client';

import { ErrorPanel, LoadingBlock, StaleNotice } from '@/components/depot/shell/DataStates';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { HowProduced } from '@/components/depot/shell/HowProduced';
import { chartDisclosureParagraphs, NETWORK_TRENDS_PATH } from '@/lib/depot/forecast/trendsPageModel';
import type { MetricKey } from '@/lib/depot/sim/types';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/usePolledJson';
import { useDepotForecast } from '@/hooks/useDepotForecast';
import { useDepotTrends } from '@/hooks/useDepotTrends';
import { ForecastBlock } from './ForecastBlock';
import { MetricChooser } from './MetricChooser';
import { UnitTrendTable } from './UnitTrendTable';

/** Placeholder rows for the unit table: a first page of rows. */
const TABLE_LOADING_ROWS = 10;

const DEAD_BAND_RULE =
  "A change smaller than the series' own usual movement at that lag reads as steady, so " +
  'noise is never reported as a direction. The 7-day and 4-week words use the same rule.';

export interface NetworkTrendsProps {
  readonly metric: MetricKey;
}

/**
 * The network Trends page body: two requests in all. One forecast request
 * draws the network's chart; one batch request lists every unit's trend
 * for the same metric, never a request per row.
 */
export function NetworkTrends({ metric }: NetworkTrendsProps) {
  const forecast = useDepotForecast({ metric, scope: { kind: 'network' } });
  const trends = useDepotTrends({ metric });
  const stale =
    forecast.data?.stale === true ||
    trends.data?.stale === true ||
    (forecast.data !== null && forecast.error !== null) ||
    (trends.data !== null && trends.error !== null);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex min-w-0 flex-col gap-3">
        <MetricChooser path={NETWORK_TRENDS_PATH} metric={metric} />
        {stale ? <StaleNotice since={forecast.data?.feedNow ?? trends.data?.feedNow ?? null} /> : null}
        <ForecastBlock state={forecast} errorTitle="Could not load the network trend" />
      </div>
      <section aria-labelledby="trends-units-heading" className="min-w-0">
        <SectionLabel
          id="trends-units-heading"
          label="Every unit"
          count={trends.data?.units.length}
          note="Worst four-week change first"
          tag="modelled"
        />
        {trends.data ? (
          <UnitTrendTable data={trends.data} />
        ) : trends.loading || trends.error === null ? (
          <LoadingBlock rows={TABLE_LOADING_ROWS} label="Loading every unit's trend" />
        ) : (
          <ErrorPanel
            title="Could not load the unit trends"
            message={trends.error || DEPOT_UNAVAILABLE_MESSAGE}
            onRetry={trends.refresh}
          />
        )}
      </section>
      <HowProduced
        testId="depot-produced"
        className="mt-8"
        paragraphs={[...chartDisclosureParagraphs(forecast.data?.sentences ?? null), DEAD_BAND_RULE]}
      />
    </div>
  );
}
