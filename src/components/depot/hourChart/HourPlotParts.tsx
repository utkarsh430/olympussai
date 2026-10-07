'use client';

import { BASIS_WORD, type HourColumn } from '@/lib/depot/service/hourChartModel';
import { busFigure, gapWords, SERVICE_TEXT } from '@/lib/depot/service/serviceWording';
import { GAP_COLOUR, HOUR_AXIS_FONT_SIZE, HOUR_COLOUR } from './hourChartStyle';

const HOURS = 24;
const GAP_BASELINE_PX = 14;
/** How far a staggered row's second line sits under its first. */
export const GAP_LINE_PX = 14;
const LABEL_INSET_PX = 4;

export interface GapTickProps {
  readonly x?: number;
  readonly y?: number;
  /** The axis width Recharts passes to a tick: 24 columns share it. */
  readonly width?: number;
  readonly column: HourColumn | undefined;
  /** Every odd hour a line lower, so a narrow column's gap never touches its neighbour's. */
  readonly staggered?: boolean;
}

/**
 * One cell of the gap row under the hour axis: the signed whole gap. An hour whose
 * deployment was seen in the feed is crimson when short, green when over; any other hour's
 * gap compares a model with a model, so it is printed in the axis colour and never reads as
 * a measured shortfall. The sign says it without the colour. The
 * first cell also writes the row's name, "Gap", in the y-axis band to its left. Staggered,
 * the odd hours drop a line.
 */
export function GapTick({ x = 0, y = 0, width = 0, column, staggered = false }: GapTickProps) {
  if (!column) return null;
  const baseline = y + GAP_BASELINE_PX;
  const own = staggered && column.hour % 2 === 1 ? baseline + GAP_LINE_PX : baseline;
  const half = width / HOURS / 2;
  return (
    <g data-testid="hour-gap-cell" data-gap={column.gapTone} data-seen={String(column.gapSeen)}>
      {column.hour === 0 ? (
        <text
          x={x - half - LABEL_INSET_PX}
          y={baseline}
          textAnchor="end"
          fontSize={HOUR_AXIS_FONT_SIZE}
          fill={HOUR_COLOUR.axisText}
        >
          Gap
        </text>
      ) : null}
      <text
        x={x}
        y={own}
        textAnchor="middle"
        fontSize={HOUR_AXIS_FONT_SIZE}
        fill={column.gapSeen ? GAP_COLOUR[column.gapTone] : HOUR_COLOUR.axisText}
      >
        {column.gapText}
      </text>
    </g>
  );
}

/** The hour's figures and what the deployed figure rests on. */
export function HourTooltip({ column }: { readonly column: HourColumn | undefined }) {
  if (!column) return null;
  const rows: readonly (readonly [string, string])[] = [
    ['Deployed', `${busFigure(column.deployed)} · ${BASIS_WORD[column.kind]}`],
    ['Scheduled', busFigure(column.scheduled)],
    [
      'Needed',
      `${busFigure(column.needed)} (${busFigure(column.neededBand[0])} to ${busFigure(column.neededBand[1])})`,
    ],
    ['Gap', `${column.gapText} · ${gapWords(column.gap)}`],
  ];
  return (
    <div className="depot-lit rounded-[3px] border border-depot-line bg-depot-surface px-2.5 py-1.5 font-mono text-[11px] text-depot-muted">
      <div className="text-depot-ink">{column.label}</div>
      {rows.map(([name, value]) => (
        <div key={name}>
          {name}: <span className="tabular-nums text-depot-ink">{value}</span>
        </div>
      ))}
      {column.scheduled === null ? <div>{SERVICE_TEXT.noScheduled}</div> : null}
    </div>
  );
}
