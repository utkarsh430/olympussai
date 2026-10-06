import { ErrorPanel, LoadingBlock } from '@/components/depot/shell/DataStates';
import { TREND_CHART_MIN_HEIGHT, TrendChart } from '@/components/depot/shared/TrendChart';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { NO_FORECAST_REMEDY, noTrendSentence } from '@/lib/depot/forecast/trendsPageModel';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/usePolledJson';
import type { DepotForecastState } from '@/hooks/useDepotForecast';
import { TRENDS_LEGEND_LABEL, buildTrendsChartView } from '@/lib/depot/forecast/trendsChartView';

export interface ForecastBlockProps {
  readonly state: DepotForecastState;
  /** What failed, for the error panel's title. */
  readonly errorTitle: string;
}

/** Why there is nothing to forecast or trend, said once: the forecast's reason first. */
function stateSentence(data: NonNullable<DepotForecastState['data']>): string | null {
  const { unavailable } = data.sentences;
  if (unavailable !== null) return unavailable;
  const { result } = data.trend;
  return result.status === 'ok' ? null : noTrendSentence(result);
}

/**
 * The page's hero: one metric's MODELLED history ending on the live value, its forecast
 * with the band, and the one caption line (the shared chart, worded by `buildTrendsChartView`:
 * the history is generated beside a real unit, so the section label carries the one
 * MODELLED tag, ruling S51, and nothing under it repeats the word). When no forecast is
 * possible the chart still draws the history and one state panel says why, with the date
 * of a gap when a gap is the reason; a forecast is never drawn from too little history.
 */
export function ForecastBlock({ state, errorTitle }: ForecastBlockProps) {
  const { data } = state;
  if (data === null) {
    if (state.loading || state.error === null) {
      return <LoadingBlock rows={1} rowHeight={TREND_CHART_MIN_HEIGHT} label="Loading the trend" />;
    }
    return (
      <ErrorPanel
        title={errorTitle}
        message={state.error || DEPOT_UNAVAILABLE_MESSAGE}
        onRetry={state.refresh}
      />
    );
  }
  const why = stateSentence(data);
  const view = buildTrendsChartView(data);
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="trends-forecast">
      <TrendChart
        data={data}
        headingLevel={2}
        title={view.label}
        tag="modelled"
        legendLabels={TRENDS_LEGEND_LABEL}
        caption={view.caption}
        summary={view.summary}
        nowFlag
        sortableTable
        testId="trends-chart"
      />
      {why !== null ? (
        <StatePanel
          kind="not-established"
          sentence={why}
          remedy={NO_FORECAST_REMEDY}
          testId="trends-no-forecast"
        />
      ) : null}
    </div>
  );
}
