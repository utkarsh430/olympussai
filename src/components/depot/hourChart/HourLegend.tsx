'use client';

import type { ReactNode } from 'react';
import { LEGEND_TEXT } from '@/lib/depot/service/serviceWording';
import { GAP_COLOUR, HOUR_COLOUR, NEEDED_BAND_OPACITY, NEEDED_DASH } from './hourChartStyle';

const SWATCH = 14;

function Swatch({ children }: { readonly children: ReactNode }) {
  return (
    <svg width={SWATCH} height={SWATCH} viewBox="0 0 14 14" aria-hidden className="shrink-0">
      {children}
    </svg>
  );
}

export interface HourLegendProps {
  readonly hasNow: boolean;
  /** False when this server has observed nothing today: the one solid bar is the feed now. */
  readonly observed: boolean;
  /** The Scheduled entry's words, carrying the buses whose trips are known. */
  readonly scheduled: string;
}

/** Each entry is its mark and its words; nothing in the chart is told by colour alone. */
export function HourLegend({ hasNow, observed, scheduled }: HourLegendProps) {
  const entries: readonly (readonly [string, ReactNode])[] = [
    [observed ? LEGEND_TEXT.observed : LEGEND_TEXT.nowOnly, <rect key="o" x={2} y={2} width={10} height={10} fill={HOUR_COLOUR.deployed} />],
    [
      LEGEND_TEXT.modelled,
      <g key="m" stroke={HOUR_COLOUR.deployed} strokeWidth={1}>
        <rect x={2} y={2} width={10} height={10} fill="none" />
        <path d="M2 9 L9 2 M5 12 L12 5" />
      </g>,
    ],
    [
      LEGEND_TEXT.notObserved,
      <rect key="n" x={2} y={2} width={10} height={10} fill="none" stroke={HOUR_COLOUR.outline} />,
    ],
    [scheduled, <path key="s" d="M1 10 H7 V4 H13" fill="none" stroke={HOUR_COLOUR.scheduled} strokeWidth={2} />],
    [
      LEGEND_TEXT.needed,
      <g key="d">
        <rect x={0} y={3} width={14} height={8} fill={HOUR_COLOUR.needed} fillOpacity={NEEDED_BAND_OPACITY} />
        <path d="M0 7 H14" stroke={HOUR_COLOUR.needed} strokeWidth={2} strokeDasharray={NEEDED_DASH} />
      </g>,
    ],
    ...(hasNow
      ? [[LEGEND_TEXT.now, <path key="w" d="M7 0 V14" stroke={HOUR_COLOUR.now} strokeWidth={2} />] as const]
      : []),
    [
      LEGEND_TEXT.gap,
      <g key="g" fontSize={11} textAnchor="middle">
        <text x={4} y={11} fill={GAP_COLOUR.short}>+</text>
        <text x={10} y={11} fill={GAP_COLOUR.over}>−</text>
      </g>,
    ],
  ];
  return (
    <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5" aria-label="Chart legend" data-testid="hour-legend">
      {entries.map(([words, mark]) => (
        <li key={words} className="depot-note flex min-w-0 items-center gap-1.5">
          <Swatch>{mark}</Swatch>
          <span>{words}</span>
        </li>
      ))}
    </ul>
  );
}
