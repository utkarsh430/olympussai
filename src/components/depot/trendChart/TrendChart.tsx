'use client';

import { useId, useMemo, useState } from 'react';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import {
  buildTrendChartModel,
  type LegendEntry,
  type TrendChartInput,
} from '@/lib/depot/forecast/chartModel';
import {
  relabelLegend,
  trendsTableRows,
  type TrendsTableRow,
} from '@/lib/depot/forecast/trendsChartView';
import type { Provenance } from '@/lib/depot/types';
import { TrendLegend, TrendTable } from './TrendChartParts';
import { TrendPlot } from './TrendPlot';

/** Plot height including the x-axis band; the chart never sets a width. */
export const TREND_CHART_MIN_HEIGHT = 240;

const NO_VALUE = '—';

const SORTABLE_COLUMNS: readonly Column<TrendsTableRow>[] = [
  { key: 'date', header: 'Date', sortValue: (row) => row.iso, render: (row) => row.date },
  {
    key: 'value',
    header: 'Value',
    align: 'right',
    sortValue: (row) => row.sortValue,
    render: (row) => row.value,
  },
  {
    key: 'low',
    header: 'Low',
    align: 'right',
    sortValue: (row) => row.sortLow,
    render: (row) => row.low || NO_VALUE,
  },
  {
    key: 'high',
    header: 'High',
    align: 'right',
    sortValue: (row) => row.sortHigh,
    render: (row) => row.high || NO_VALUE,
  },
  { key: 'kind', header: 'Kind', sortValue: (row) => row.kind, render: (row) => row.kind },
];

const BY_DATE = { key: 'date', direction: 'asc' } as const;

export interface TrendChartProps {
  /** The forecast API response, or any object with the same fields. */
  readonly data: TrendChartInput;
  /** Heading level for the title, to sit in the page's outline. */
  readonly headingLevel?: 2 | 3 | 4;
  readonly height?: number;
  /**
   * A section title: the head becomes the shared SectionLabel (with `tag` and `note`)
   * and the view switch sits in its controls slot as CHART | TABLE.
   */
  readonly title?: string;
  readonly tag?: Provenance;
  /** The label's 12 px note under it. */
  readonly note?: string;
  /** The legend's own words, in the order of the keys. */
  readonly legendLabels?: Readonly<Partial<Record<LegendEntry['key'], string>>>;
  /** Replaces the model's sentences with one caption line; null prints none. */
  readonly caption?: string | null;
  /** Replaces the model's text equivalent. */
  readonly summary?: string;
  /** Marks now with the amber flag on the axis. */
  readonly nowFlag?: boolean;
  /** The table view as the shared sortable table instead of the plain one. */
  readonly sortableTable?: boolean;
  readonly testId?: string;
}

/** The view switch: one "Show as table" button, or CHART | TABLE in a label's controls. */
function ViewSwitch(props: {
  readonly segmented: boolean;
  readonly asTable: boolean;
  readonly bodyId: string;
  readonly onChange: (asTable: boolean) => void;
}) {
  const { segmented, asTable, bodyId, onChange } = props;
  if (!segmented) {
    return (
      <button
        type="button"
        className="depot-filter-button"
        aria-pressed={asTable}
        aria-controls={bodyId}
        onClick={() => onChange(!asTable)}
      >
        Show as table
      </button>
    );
  }
  return (
    <div role="group" aria-label="Show the trend as" className="flex gap-1">
      {(['chart', 'table'] as const).map((option) => {
        const pressed = (option === 'table') === asTable;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={pressed}
            aria-controls={bodyId}
            onClick={() => onChange(option === 'table')}
            className={`rounded-[3px] border px-3 py-1 font-mono text-[11px] uppercase leading-4 tracking-[0.12em] ${
              pressed
                ? 'border-holo-glow/60 bg-holo-glow/15 text-holo-glow shadow-hud'
                : 'border-holo-glow/30 bg-holo-glow/[0.06] text-holo-glow/90 hover:border-holo-glow/70 hover:bg-holo-glow/15 hover:text-holo-glow'
            }`}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

/**
 * History, the live value and the forecast with its band, titled and legended with
 * MODELLED, with the sentences the view wrote underneath and a "Show as table" control
 * that swaps the plot for the same points as rows. Without a forecast it draws the
 * history and says why. Fills its container's width. The Trends pages pass their own
 * title, tag, legend words, caption, text equivalent, the amber Now flag and the
 * sortable table through the optional props; every other use looks as it always did.
 */
export function TrendChart({
  data,
  headingLevel = 3,
  height = TREND_CHART_MIN_HEIGHT,
  title,
  tag,
  note,
  legendLabels,
  caption,
  summary,
  nowFlag = false,
  sortableTable = false,
  testId,
}: TrendChartProps) {
  const model = useMemo(() => buildTrendChartModel(data), [data]);
  const legend = useMemo(
    () => (legendLabels ? relabelLegend(model.legend, legendLabels) : model.legend),
    [model, legendLabels],
  );
  const rows = useMemo(
    () => (sortableTable ? trendsTableRows(model, data.metric.unit) : []),
    [model, sortableTable, data.metric.unit],
  );
  const [asTable, setAsTable] = useState(false);
  const [announced, setAnnounced] = useState(false);
  const titleId = useId();
  const bodyId = useId();
  const Heading = `h${headingLevel}` as const;
  const change = (next: boolean): void => {
    setAsTable(next);
    setAnnounced(true);
  };
  const viewSwitch = (
    <ViewSwitch
      segmented={title !== undefined}
      asTable={asTable}
      bodyId={bodyId}
      onChange={change}
    />
  );
  return (
    <section aria-labelledby={titleId} className="min-w-0" data-testid={testId}>
      {title !== undefined ? (
        <SectionLabel
          id={titleId}
          label={title}
          tag={tag}
          note={note}
          level={headingLevel}
          controls={viewSwitch}
        />
      ) : (
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <Heading id={titleId} className="depot-section-label mb-0 min-w-0">
            {model.title}
          </Heading>
          {viewSwitch}
        </div>
      )}
      {/* Announces the swap; silent until the control is first used. */}
      <p role="status" className="sr-only">
        {announced ? (asTable ? 'Showing the values as a table.' : 'Showing the chart.') : ''}
      </p>
      {title !== undefined ? (
        <div className="mb-2 min-w-0">
          <TrendLegend entries={legend} />
        </div>
      ) : (
        <TrendLegend entries={legend} />
      )}
      <div id={bodyId}>
        {asTable && sortableTable ? (
          <DataTable
            columns={SORTABLE_COLUMNS}
            rows={rows}
            rowKey={(row) => row.key}
            caption={`${title ?? model.title}: every point drawn`}
            initialSort={BY_DATE}
          />
        ) : asTable ? (
          <TrendTable model={model} />
        ) : (
          <div
            role="img"
            aria-label={summary ?? model.summary}
            className="relative w-full min-w-0"
            style={{ minHeight: height }}
          >
            <TrendPlot model={model} unit={data.metric.unit} height={height} nowFlag={nowFlag} />
          </div>
        )}
      </div>
      {caption !== undefined ? (
        caption === null ? null : (
          <p className="depot-caption mt-3" data-testid="trends-caption">
            {caption}
          </p>
        )
      ) : (
        <div className="mt-3 space-y-1">
          {model.notes.map((line) => (
            <p key={line} className="depot-prose">
              {line}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
