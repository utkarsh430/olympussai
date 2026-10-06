import { ErrorPanel, LoadingBlock } from '@/components/depot/shell/DataStates';
import { TREND_CHART_MIN_HEIGHT, TrendChart } from '@/components/depot/shared/TrendChart';
import { trendLinesBesideChart } from '@/lib/depot/forecast/trendsPageModel';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/usePolledJson';
import type { DepotForecastState } from '@/hooks/useDepotForecast';

/** Sentence rows under the chart: trend, method, error, horizon. */
const SENTENCE_ROWS = 4;
const SENTENCE_ROW_PX = 20;

export interface ForecastBlockProps {
  readonly state: DepotForecastState;
  /** What failed, for the error panel's title. */
  readonly errorTitle: string;
}

/**
 * The page's hero: one metric's MODELLED history ending on the live value,
 * its forecast with the band, the method and error in words (all printed by
 * the shared chart, with the headline trend), then the other trend sentence. When
 * no forecast is possible the chart shows the history and says why.
 */
export function ForecastBlock({ state, errorTitle }: ForecastBlockProps) {
  const { data } = state;
  if (data === null) {
    if (state.loading || state.error === null) {
      return (
        <div className="flex flex-col gap-2">
          <LoadingBlock rows={1} rowHeight={TREND_CHART_MIN_HEIGHT} label="Loading the trend" />
          <LoadingBlock rows={SENTENCE_ROWS} rowHeight={SENTENCE_ROW_PX} label="Loading the forecast" />
        </div>
      );
    }
    return (
      <ErrorPanel
        title={errorTitle}
        message={state.error || DEPOT_UNAVAILABLE_MESSAGE}
        onRetry={state.refresh}
      />
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="trends-forecast">
      <TrendChart data={data} headingLevel={2} />
      <ul className="depot-prose flex flex-col gap-1" data-testid="trends-trend-lines">
        {trendLinesBesideChart(data.trend.result, data.sentences.trend).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
