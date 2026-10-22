'use client';

import { memo } from 'react';
import { formatCount } from '@/lib/depot/format';
import type { CellRef } from '@/lib/depot/redistribution/engineState';
import { cellColour, type HeatMode, type HeatScale } from '@/lib/depot/redistribution/heatScale';
import { HOURS_PER_DAY, type AvailabilityGrid, type ScenarioRoute } from '@/lib/depot/redistribution/types';
import { hourDigits, hourLabel } from '@/lib/depot/service/serviceWording';

const HOURS = Array.from({ length: HOURS_PER_DAY }, (_, h) => h);

export interface HeatWindow {
  readonly fromHour: number;
  readonly toHour: number;
}

export interface HeatGridProps {
  readonly routes: readonly ScenarioRoute[];
  /** A projected availability; null for the current allocation. */
  readonly grid: AvailabilityGrid | null;
  readonly mode: HeatMode;
  readonly scale: HeatScale;
  readonly window: HeatWindow;
  readonly depotNames: ReadonlyMap<string, string>;
  readonly selectedCell?: CellRef | null;
  readonly highlightRouteIds?: ReadonlySet<string>;
  readonly onCell?: (cell: CellRef) => void;
  /** Smaller cells, for two grids side by side. */
  readonly compact?: boolean;
  readonly maxHeight?: number;
  readonly label: string;
  readonly testId?: string;
}

/** One cell's figures in words, for its title and its label. */
export function cellWords(route: ScenarioRoute, hour: number, available: number): string {
  const demand = route.demand[hour] ?? 0;
  const required = route.required[hour] ?? 0;
  const gap = required - available;
  const state =
    required <= 0 ? 'no service' : gap > 0 ? `short ${formatCount(gap)}` : gap < 0 ? `surplus ${formatCount(-gap)}` : 'balanced';
  return `${route.id} at ${hourLabel(hour)}: ${formatCount(demand)} passengers, ${formatCount(available)} of ${formatCount(required)} buses, ${state}`;
}

interface RowProps {
  readonly route: ScenarioRoute;
  readonly available: readonly number[];
  readonly mode: HeatMode;
  readonly scale: HeatScale;
  readonly window: HeatWindow;
  readonly depotName: string;
  readonly selectedHour: number | null;
  readonly highlighted: boolean;
  readonly compact: boolean;
  readonly onCell?: (cell: CellRef) => void;
}

const HeatRow = memo(function HeatRow({ route, available, mode, scale, window, depotName, selectedHour, highlighted, compact, onCell }: RowProps) {
  const size = compact ? 'h-[14px] w-[18px]' : 'h-[22px] w-[26px]';
  return (
    <tr className={highlighted ? 'bg-holo-glow/[0.07]' : ''} data-testid="heat-row">
      <th
        scope="row"
        className={`sticky left-0 z-10 whitespace-nowrap bg-depot-page pr-3 text-left font-mono text-[11px] font-normal leading-none ${
          highlighted ? 'text-holo-glow' : 'text-depot-ink'
        }`}
        title={`${route.id} · ${depotName}`}
      >
        <span className={compact ? 'block max-w-[112px] truncate' : 'block max-w-[150px] truncate'}>
          {route.id}
          {compact ? null : <span className="ml-1.5 text-depot-faint">{depotName.split(' ')[0]}</span>}
        </span>
      </th>
      {HOURS.map((h) => {
        const have = available[h] ?? 0;
        const inWindow = h >= window.fromHour && h <= window.toHour;
        const words = cellWords(route, h, have);
        const colour = cellColour(mode, { demand: route.demand[h] ?? 0, required: route.required[h] ?? 0, available: have }, scale);
        const selected = selectedHour === h;
        return (
          <td key={h} className={`p-0 ${inWindow ? '' : 'opacity-40'}`}>
            {onCell ? (
              <button
                type="button"
                className={`${size} block rounded-[1px] transition-colors duration-500 hover:outline hover:outline-1 hover:outline-holo-glow/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-holo-glow ${
                  selected ? 'outline outline-2 outline-holo-glow shadow-[0_0_10px] shadow-holo-glow/70' : ''
                }`}
                style={{ backgroundColor: colour }}
                title={words}
                aria-label={words}
                aria-pressed={selected}
                onClick={() => onCell({ routeId: route.id, hour: h })}
              />
            ) : (
              <span className={`${size} block rounded-[1px] transition-colors duration-700`} style={{ backgroundColor: colour }} title={words} aria-label={words} role="img" />
            )}
          </td>
        );
      })}
    </tr>
  );
});

/**
 * Routes by hour as a table whose hour row and route column stay in view while the frame
 * scrolls. Every cell's figures are in its title; the hours outside the window are dimmed.
 */
export function HeatGrid(props: HeatGridProps) {
  const { routes, grid, mode, scale, window, depotNames, selectedCell = null, highlightRouteIds, onCell, compact = false, maxHeight = 560, label, testId } = props;
  const hourCell = compact ? 'w-[18px] text-[9px]' : 'w-[26px] text-[10px]';
  return (
    <div className="depot-table-frame overflow-auto rounded-[3px] border border-depot-line" style={{ maxHeight }} data-testid={testId}>
      <table className="w-max border-separate [border-spacing:1px] font-mono" aria-label={label}>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 top-0 z-30 bg-depot-page pb-1 pr-3 text-left font-mono text-[10px] font-normal uppercase tracking-[0.12em] text-depot-muted">
              Route
            </th>
            {HOURS.map((h) => {
              const inWindow = h >= window.fromHour && h <= window.toHour;
              return (
                <th
                  key={h}
                  scope="col"
                  className={`sticky top-0 z-20 bg-depot-page pb-1 text-center font-normal tabular-nums ${hourCell} ${
                    inWindow ? 'border-b border-holo-glow/70 text-holo-glow' : 'text-depot-faint'
                  }`}
                  title={hourLabel(h)}
                >
                  {compact ? (h % 3 === 0 ? hourDigits(h) : '') : hourDigits(h)}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {routes.map((route) => (
            <HeatRow
              key={route.id}
              route={route}
              available={grid?.get(route.id) ?? route.available}
              mode={mode}
              scale={scale}
              window={window}
              depotName={depotNames.get(route.depotId) ?? route.depotId}
              selectedHour={selectedCell?.routeId === route.id ? selectedCell.hour : null}
              highlighted={highlightRouteIds?.has(route.id) ?? false}
              compact={compact}
              onCell={onCell}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
