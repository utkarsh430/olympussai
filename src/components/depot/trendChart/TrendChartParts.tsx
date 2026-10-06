import type { LegendEntry, LegendMark, TrendChartModel } from '@/lib/depot/forecast/chartModel';
import { BAND_OPACITY, FORECAST_DASH, TREND_COLOUR } from './trendStyle';

const KEY_WIDTH = 18;
const KEY_HEIGHT = 10;
const MID = KEY_HEIGHT / 2;

/** A small drawing of the mark the entry names: solid line, dot, dashed line or wash. */
function LegendKey({ mark }: { readonly mark: LegendMark }) {
  return (
    <svg width={KEY_WIDTH} height={KEY_HEIGHT} aria-hidden="true" className="shrink-0">
      {mark === 'line' ? (
        <line
          x1={1}
          y1={MID}
          x2={KEY_WIDTH - 1}
          y2={MID}
          stroke={TREND_COLOUR.history}
          strokeWidth={2}
        />
      ) : null}
      {mark === 'dashed' ? (
        <line
          x1={1}
          y1={MID}
          x2={KEY_WIDTH - 1}
          y2={MID}
          stroke={TREND_COLOUR.accent}
          strokeWidth={2}
          strokeDasharray={FORECAST_DASH}
        />
      ) : null}
      {mark === 'dot' ? (
        <circle cx={KEY_WIDTH / 2} cy={MID} r={4} fill={TREND_COLOUR.accent} />
      ) : null}
      {mark === 'area' ? (
        <rect
          x={1}
          y={1}
          width={KEY_WIDTH - 2}
          height={KEY_HEIGHT - 2}
          fill={TREND_COLOUR.accent}
          fillOpacity={BAND_OPACITY * 2}
        />
      ) : null}
    </svg>
  );
}

/** The legend in words; the history and forecast entries each carry MODELLED. */
export function TrendLegend({ entries }: { readonly entries: readonly LegendEntry[] }) {
  return (
    <ul aria-label="Legend" className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
      {entries.map((entry) => (
        <li
          key={entry.key}
          className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-depot-muted"
        >
          <LegendKey mark={entry.mark} />
          <span data-legend={entry.key}>{entry.label}</span>
        </li>
      ))}
    </ul>
  );
}

/** The same points as the chart, as a table: the alternative to hovering. */
export function TrendTable({ model }: { readonly model: TrendChartModel }) {
  return (
    <div className="depot-table-frame">
      <table className="depot-table">
        <caption className="sr-only">{model.title}: every point drawn</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col" className="depot-align-right">
              Value
            </th>
            <th scope="col" className="depot-align-right">
              Low
            </th>
            <th scope="col" className="depot-align-right">
              High
            </th>
            <th scope="col">Kind</th>
          </tr>
        </thead>
        <tbody>
          {model.table.map((row) => (
            <tr key={row.date}>
              <td className="whitespace-nowrap">{row.date}</td>
              <td className="depot-align-right">{row.value}</td>
              <td className="depot-align-right">{row.low}</td>
              <td className="depot-align-right">{row.high}</td>
              <td className="whitespace-nowrap">{row.kind}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
