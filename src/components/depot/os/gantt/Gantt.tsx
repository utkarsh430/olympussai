'use client';

import { memo } from 'react';
import { clockOf } from '@/lib/depot/os/intel/readiness';

/**
 * The operational Gantt: rows of resources (buses, crew, duties), bars of work over the
 * day's hours, a line at the feed clock, and selection that lights linked bars across
 * rows. Positions are percentages of the window, so it fits any width without a measure.
 */

export type GanttTone = 'cyan' | 'teal' | 'green' | 'amber' | 'crimson' | 'slate' | 'violet' | 'ghost';

export interface GanttBar {
  readonly id: string;
  /** Minutes after midnight. */
  readonly start: number;
  readonly end: number;
  readonly tone: GanttTone;
  /** Drawn inside the bar when it is wide enough. */
  readonly label?: string;
  /** The tooltip: the bar's full description. */
  readonly title: string;
  /** Hatched: uncovered or proposed work. */
  readonly hatched?: boolean;
  /** Ids this bar is linked to (a crew shift to its bus block), lit when either is selected. */
  readonly links?: readonly string[];
}

export interface GanttRow {
  readonly id: string;
  readonly label: string;
  readonly sub?: string;
  readonly bars: readonly GanttBar[];
  /** A thin marker on the label: a conflict or a warning on the whole row. */
  readonly flag?: 'amber' | 'crimson';
}

interface GanttProps {
  readonly rows: readonly GanttRow[];
  /** Window, minutes after midnight. */
  readonly from?: number;
  readonly to?: number;
  readonly nowMin?: number | null;
  readonly selectedId?: string | null;
  /** Bar or row ids to light (linked selection). */
  readonly highlight?: ReadonlySet<string>;
  readonly onSelect?: (barId: string, rowId: string) => void;
  readonly rowHeight?: number;
  readonly labelWidth?: number;
  readonly maxHeight?: number;
  readonly ariaLabel: string;
  readonly emptyText?: string;
}

const TONE_CLASS: Readonly<Record<GanttTone, string>> = {
  cyan: 'os-bar-cyan',
  teal: 'os-bar-teal',
  green: 'os-bar-green',
  amber: 'os-bar-amber',
  crimson: 'os-bar-crimson',
  slate: 'os-bar-slate',
  violet: 'os-bar-violet',
  ghost: 'os-bar-ghost',
};

const pct = (minute: number, from: number, to: number): number => ((Math.min(to, Math.max(from, minute)) - from) / (to - from)) * 100;

function GanttImpl({
  rows,
  from = 240,
  to = 1440,
  nowMin = null,
  selectedId = null,
  highlight,
  onSelect,
  rowHeight = 26,
  labelWidth = 132,
  maxHeight = 520,
  ariaLabel,
  emptyText = 'Nothing to draw.',
}: GanttProps) {
  const hours: number[] = [];
  for (let m = Math.ceil(from / 60) * 60; m <= to; m += 60) hours.push(m);
  const step = to - from > 14 * 60 ? 2 : 1;
  const nowPct = nowMin !== null && nowMin >= from && nowMin <= to ? pct(nowMin, from, to) : null;
  const lit = (bar: GanttBar): boolean => bar.id === selectedId || (highlight?.has(bar.id) ?? false) || (bar.links ?? []).some((l) => l === selectedId || (highlight?.has(l) ?? false));

  return (
    <div className="os-gantt" role="figure" aria-label={ariaLabel} style={{ ['--gantt-label' as string]: `${labelWidth}px` }}>
      <div className="os-gantt-head">
        <div className="os-gantt-corner" />
        <div className="relative h-6">
          {hours.map((m, i) =>
            i % step === 0 ? (
              <span key={m} className="os-gantt-tick" style={{ left: `${pct(m, from, to)}%` }}>
                {clockOf(m % 1440)}
              </span>
            ) : null,
          )}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 font-sans text-[12.5px] text-depot-prose">{emptyText}</p>
      ) : (
        <div className="os-scroll relative overflow-y-auto" style={{ maxHeight }}>
          {rows.map((row) => {
            const rowLit = row.id === selectedId || (highlight?.has(row.id) ?? false);
            return (
              <div key={row.id} className={`os-gantt-row ${rowLit ? 'os-gantt-row-lit' : ''}`} style={{ height: rowHeight }}>
                <div className="os-gantt-label" title={row.sub ? `${row.label} · ${row.sub}` : row.label}>
                  {row.flag ? <span className={`h-3 w-[3px] shrink-0 rounded-full ${row.flag === 'crimson' ? 'bg-alert-crimson' : 'bg-alert-amber'}`} aria-hidden /> : null}
                  <span className="truncate font-mono text-[11.5px] text-depot-ink">{row.label}</span>
                  {row.sub ? <span className="truncate font-sans text-[10.5px] text-depot-muted">{row.sub}</span> : null}
                </div>
                <div className="os-gantt-track">
                  {hours.map((m) => (
                    <span key={m} className="os-gantt-grid" style={{ left: `${pct(m, from, to)}%` }} aria-hidden />
                  ))}
                  {row.bars.map((bar) => {
                    const left = pct(bar.start, from, to);
                    const width = Math.max(0.35, pct(bar.end, from, to) - left);
                    const on = lit(bar);
                    return (
                      <button
                        key={bar.id}
                        type="button"
                        title={bar.title}
                        aria-label={bar.title}
                        aria-pressed={bar.id === selectedId}
                        onClick={onSelect ? () => onSelect(bar.id, row.id) : undefined}
                        tabIndex={onSelect ? 0 : -1}
                        className={`os-gantt-bar ${TONE_CLASS[bar.tone]} ${bar.hatched ? 'os-bar-hatched' : ''} ${on ? 'os-gantt-bar-lit' : ''} ${selectedId && !on ? 'opacity-55' : ''}`}
                        style={{ left: `${left}%`, width: `${width}%` }}
                      >
                        {bar.label && width > 6 ? <span className="truncate px-1">{bar.label}</span> : null}
                      </button>
                    );
                  })}
                  {nowPct !== null ? <span className="os-gantt-now" style={{ left: `${nowPct}%` }} aria-hidden /> : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const Gantt = memo(GanttImpl);

/** The legend under a Gantt: tone swatches with their meaning. */
export function GanttLegend({ items }: { readonly items: readonly { readonly tone: GanttTone; readonly label: string; readonly hatched?: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-sans text-[11.5px] text-depot-prose">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5">
          <span className={`inline-block h-2.5 w-5 rounded-[2px] ${TONE_CLASS[item.tone]} ${item.hatched ? 'os-bar-hatched' : ''}`} aria-hidden />
          {item.label}
        </span>
      ))}
    </div>
  );
}
