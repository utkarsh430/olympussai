'use client';

import { useMemo, useState } from 'react';
import { SearchField, Select } from '@/components/depot/shell/Controls';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { formatCount } from '@/lib/depot/format';
import type { EngineModel } from '@/lib/depot/redistribution/engineModel';
import type { EngineAction, EngineState } from '@/lib/depot/redistribution/engineState';
import { HEAT_MODES } from '@/lib/depot/redistribution/heatScale';
import { routeWindowFigures, type RouteWindowFigures } from '@/lib/depot/redistribution/metrics';
import { SECTION } from '@/lib/depot/redistribution/wording';
import { CellDetail } from './CellDetail';
import { HeatGrid } from './HeatGrid';
import { HeatLegend } from './HeatLegend';

export interface HeatmapSectionProps {
  readonly model: EngineModel;
  readonly state: EngineState;
  readonly dispatch: (action: EngineAction) => void;
  readonly onExplore: (routeId: string) => void;
}

type SortKey = 'shortage' | 'surplus' | 'demand' | 'name';

const SORTS: readonly { readonly key: SortKey; readonly label: string }[] = [
  { key: 'shortage', label: 'Greatest shortage' },
  { key: 'surplus', label: 'Greatest surplus' },
  { key: 'demand', label: 'Peak demand' },
  { key: 'name', label: 'Route name' },
];

const DEFAULT_ROWS = 40;

function compare(sort: SortKey, a: RouteWindowFigures, b: RouteWindowFigures): number {
  switch (sort) {
    case 'shortage':
      return b.peakShortage - a.peakShortage || b.shortageBusHours - a.shortageBusHours;
    case 'surplus':
      return b.surplusBusHours - a.surplusBusHours;
    case 'demand':
      return b.peakDemand - a.peakDemand;
    case 'name':
      return 0;
  }
}

/** The route-by-hour heat map with its view, sort, search and the cell inspector beside it. */
export function HeatmapSection({ model, state, dispatch, onExplore }: HeatmapSectionProps) {
  const [sort, setSort] = useState<SortKey>('shortage');
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);

  const figures = useMemo(
    () => new Map(model.routes.map((r) => [r.id, routeWindowFigures(r, null, model.selection)] as const)),
    [model.routes, model.selection],
  );
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = model.routes.filter(
      (r) => needle === '' || r.id.toLowerCase().includes(needle) || (model.depotNames.get(r.depotId) ?? '').toLowerCase().includes(needle),
    );
    return [...matched].sort((a, b) => {
      const fa = figures.get(a.id) as RouteWindowFigures;
      const fb = figures.get(b.id) as RouteWindowFigures;
      return compare(sort, fa, fb) || a.id.localeCompare(b.id);
    });
  }, [model.routes, model.depotNames, figures, query, sort]);
  const shown = showAll ? rows : rows.slice(0, DEFAULT_ROWS);
  const mode = HEAT_MODES.find((m) => m.key === state.heatMode) ?? HEAT_MODES[0];

  return (
    <section aria-labelledby={SECTION.heatmap.id} className="min-w-0" data-testid="demand-supply-heatmap">
      <SectionLabel
        id={SECTION.heatmap.id}
        label={SECTION.heatmap.label}
        count={rows.length}
        note={`${mode?.label ?? ''} · ${SORTS.find((s) => s.key === sort)?.label.toLowerCase() ?? ''} first`}
        controls={
          <div role="group" aria-label="Heat map view" className="flex flex-wrap gap-1">
            {HEAT_MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                className="depot-filter-button"
                aria-pressed={state.heatMode === m.key}
                onClick={() => dispatch({ type: 'heatMode', mode: m.key })}
                title={m.label}
              >
                {m.short}
              </button>
            ))}
          </div>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        <Select label="Sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </Select>
        <SearchField label="Route" placeholder="Search route or depot" value={query} onChange={(e) => setQuery(e.target.value)} />
        {rows.length > DEFAULT_ROWS ? (
          <button type="button" className="depot-filter-button" aria-pressed={showAll} onClick={() => setShowAll((v) => !v)}>
            {showAll ? `Show first ${DEFAULT_ROWS}` : `Show all ${formatCount(rows.length)}`}
          </button>
        ) : null}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          {shown.length === 0 ? (
            <StatePanel kind="empty" compact sentence="No route matches the search." />
          ) : (
            <HeatGrid
              routes={shown}
              grid={null}
              mode={state.heatMode}
              scale={model.scale}
              window={model.selection}
              depotNames={model.depotNames}
              selectedCell={state.selectedCell}
              onCell={(cell) => dispatch({ type: 'selectCell', cell })}
              label={`${mode?.label ?? ''} by route and hour, ${model.bandLabel} highlighted`}
              testId="heat-grid"
            />
          )}
          <HeatLegend mode={state.heatMode} scale={model.scale} bandLabel={model.bandLabel} />
        </div>
        <div className="xl:sticky xl:top-4 xl:self-start">
          <CellDetail cell={state.selectedCell} model={model} planReady={state.planStatus === 'ready'} onExplore={onExplore} />
        </div>
      </div>
    </section>
  );
}
