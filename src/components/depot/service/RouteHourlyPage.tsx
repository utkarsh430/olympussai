'use client';

import { HourChart } from '@/components/depot/hourChart/HourChart';
import { StaleNotice } from '@/components/depot/shell/StaleNotice';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { SERVICE_TEXT } from '@/lib/depot/service/serviceWording';
import type { RouteHourlyResponse } from '@/lib/depot/service/types';
import { ProposalsTable } from './ProposalsTable';
import { PunctualitySection } from './PunctualitySection';
import { ServiceFigureBand } from './ServiceFigureBand';
import { ServiceMethod } from './ServiceMethod';

export { routeHourlyProvenance, coverageSentences } from '@/lib/depot/service/servicePageModel';

export interface RouteHourlyPageProps {
  readonly response: RouteHourlyResponse | null;
  /** The request's fixed error words, or null. */
  readonly error: string | null;
  readonly loading: boolean;
  readonly onRetry?: () => void;
}

/** The chart's footprint while the day loads: the label row, the plot, the legend. */
const LOADING_ROWS = 3;
const LOADING_ROW_PX = 120;

/**
 * The route's day hour by hour, under the page's header (which the page draws with
 * `routeHourlyProvenance`): the hour chart as the hero, the current hour's figures, the
 * proposals, punctuality by hour, and the closing disclosure. Each state is one panel.
 */
export function RouteHourlyPage({ response, error, loading, onRetry }: RouteHourlyPageProps) {
  if (response === null) {
    if (loading) {
      return (
        <StatePanel kind="loading" sentence={SERVICE_TEXT.loading} rows={LOADING_ROWS} rowHeight={LOADING_ROW_PX} />
      );
    }
    if (error !== null) {
      return (
        <StatePanel
          kind="error"
          title={SERVICE_TEXT.errorTitle}
          sentence={error}
          action={
            onRetry ? (
              <button type="button" className="depot-filter-button" onClick={onRetry}>
                Retry
              </button>
            ) : undefined
          }
        />
      );
    }
    return <StatePanel kind="empty" sentence={SERVICE_TEXT.empty} />;
  }
  if (response.hours.length === 0) return <StatePanel kind="empty" sentence={SERVICE_TEXT.empty} />;
  return (
    <>
      {response.stale ? <StaleNotice since={response.feedNow} fetchedAt={response.fetchedAt} /> : null}
      <div className="depot-stack" data-testid="route-hourly-page">
        <HourChart body={response} />
        <div>
          <ServiceFigureBand response={response} />
        </div>
        <ProposalsTable proposals={response.proposals} />
        <PunctualitySection hours={response.hours} />
        <ServiceMethod need={response.need} demandBasis={response.demandBasis} />
      </div>
    </>
  );
}
