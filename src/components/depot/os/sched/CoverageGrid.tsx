'use client';

import { memo } from 'react';
import type { Trip } from '@/lib/depot/os/sched/types';

export type CellState = 'covered' | 'at_risk' | 'uncovered';

export interface CoverageCell {
  readonly routeId: string;
  readonly hour: number;
  readonly trips: readonly Trip[];
  readonly covered: number;
  readonly atRisk: number;
  readonly uncovered: number;
}

const HOURS = Array.from({ length: 20 }, (_, i) => i + 4);

/** Departures by route and hour, each counted as run, at risk (a bus with no crew) or uncovered. */
export function coverageCells(trips: readonly Trip[], runs: ReadonlySet<string>, withBus: ReadonlySet<string>): Map<string, CoverageCell> {
  const cells = new Map<string, CoverageCell>();
  for (const t of trips) {
    const hour = Math.floor(t.dep / 60);
    const key = `${t.routeId}|${hour}`;
    const prev = cells.get(key) ?? { routeId: t.routeId, hour, trips: [], covered: 0, atRisk: 0, uncovered: 0 };
    const state: CellState = runs.has(t.id) ? 'covered' : withBus.has(t.id) ? 'at_risk' : 'uncovered';
    cells.set(key, {
      ...prev,
      trips: [...prev.trips, t],
      covered: prev.covered + (state === 'covered' ? 1 : 0),
      atRisk: prev.atRisk + (state === 'at_risk' ? 1 : 0),
      uncovered: prev.uncovered + (state === 'uncovered' ? 1 : 0),
    });
  }
  return cells;
}

function GridImpl({
  routes,
  cells,
  selectedKey,
  lit,
  onSelect,
}: {
  readonly routes: readonly string[];
  readonly cells: ReadonlyMap<string, CoverageCell>;
  readonly selectedKey: string | null;
  /** Cells holding a selected bus's or shift's departures. */
  readonly lit: ReadonlySet<string>;
  readonly onSelect: (key: string) => void;
}) {
  return (
    <div className="os-scroll overflow-x-auto" role="figure" aria-label="Service coverage by route and hour">
      <table className="w-full border-separate border-spacing-[2px] font-mono text-[10px]">
        <thead>
          <tr>
            <th className="sticky left-0 z-[1] bg-depot-surface px-1 text-left font-normal text-depot-muted">Route</th>
            {HOURS.map((h) => (
              <th key={h} className="px-0.5 text-center font-normal text-depot-muted">
                {String(h).padStart(2, '0')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {routes.map((route) => (
            <tr key={route}>
              <th className="sticky left-0 z-[1] max-w-[7.5rem] truncate bg-depot-surface px-1 text-left font-normal text-depot-ink" title={route}>
                {route}
              </th>
              {HOURS.map((h) => {
                const key = `${route}|${h}`;
                const cell = cells.get(key);
                if (!cell) return <td key={h} className="h-6 rounded-[2px] bg-depot-raised/40" />;
                const tone = cell.uncovered > 0 ? 'os-cell-uncovered' : cell.atRisk > 0 ? 'os-cell-risk' : 'os-cell-covered';
                const total = cell.trips.length;
                return (
                  <td key={h} className="p-0">
                    <button
                      type="button"
                      onClick={() => onSelect(key)}
                      title={`${route} ${String(h).padStart(2, '0')}:00 · ${cell.covered} run, ${cell.atRisk} with a bus but no crew, ${cell.uncovered} uncovered`}
                      aria-label={`${route} at ${h}:00: ${cell.covered} of ${total} run`}
                      className={`os-cell ${tone} ${selectedKey === key ? 'os-cell-selected' : lit.has(key) ? 'os-cell-lit' : ''}`}
                    >
                      {total}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const CoverageGrid = memo(GridImpl);
