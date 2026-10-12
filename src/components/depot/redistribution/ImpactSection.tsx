'use client';

import { useMemo } from 'react';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { formatCount, formatPercent, signFor } from '@/lib/depot/format';
import type { EngineModel } from '@/lib/depot/redistribution/engineModel';
import type { EngineAction, EngineState, ImpactView } from '@/lib/depot/redistribution/engineState';
import { routeWindowFigures } from '@/lib/depot/redistribution/metrics';
import type { NetworkMetrics, ScenarioRoute } from '@/lib/depot/redistribution/types';
import { SECTION } from '@/lib/depot/redistribution/wording';
import { HeatGrid } from './HeatGrid';
import { HeatLegend } from './HeatLegend';

export interface ImpactSectionProps {
  readonly model: EngineModel;
  readonly state: EngineState;
  readonly dispatch: (action: EngineAction) => void;
}

const VIEWS: readonly { readonly key: ImpactView; readonly label: string }[] = [
  { key: 'current', label: 'Current Network' },
  { key: 'optimized', label: 'Optimized Network' },
  { key: 'side_by_side', label: 'Side-by-Side Comparison' },
];

const COMPARE_ROWS = 30;
const CURRENT_TITLE = 'Current Allocation';
const AFTER_TITLE = 'After AI Redistribution';

interface CompareRow {
  readonly label: string;
  readonly before: string;
  readonly after: string;
  readonly change: string;
  /** Whether a fall is an improvement. */
  readonly tone: 'better' | 'worse' | 'neutral';
  readonly help: string;
}

const pct = (before: number, after: number): string => (before === 0 ? '' : ` (${Math.round(((after - before) / before) * 100)}%)`);
const signed = (n: number, digits = 0): string => `${signFor(n)}${Math.abs(n).toFixed(digits)}`;
const toneOf = (delta: number, lowerIsBetter: boolean): CompareRow['tone'] =>
  delta === 0 ? 'neutral' : (delta < 0) === lowerIsBetter ? 'better' : 'worse';

function compareRows(before: NetworkMetrics, after: NetworkMetrics): readonly CompareRow[] {
  const shortage = after.shortageBusHours - before.shortageBusHours;
  const routes = after.routesShort - before.routesShort;
  const coverage = Math.round((after.coverage - before.coverage) * 100);
  const used = before.surplusBusHours - after.surplusBusHours;
  const wait = after.meanWaitMin - before.meanWaitMin;
  return [
    {
      label: 'Bus-hour shortage',
      before: formatCount(before.shortageBusHours),
      after: formatCount(after.shortageBusHours),
      change: `${signed(shortage)}${pct(before.shortageBusHours, after.shortageBusHours)}`,
      tone: toneOf(shortage, true),
      help: 'Cumulative bus-hours short across the window, before and after the kept transfers.',
    },
    {
      label: 'Routes facing shortage',
      before: formatCount(before.routesShort),
      after: formatCount(after.routesShort),
      change: `${signed(routes)}${pct(before.routesShort, after.routesShort)}`,
      tone: toneOf(routes, true),
      help: 'Routes short in at least one hour of the window.',
    },
    {
      label: 'Passenger demand coverage',
      before: formatPercent(before.coverage),
      after: formatPercent(after.coverage),
      change: `${signed(coverage)} pts`,
      tone: toneOf(-coverage, true),
      help: 'Share of forecast passengers the allocation can carry.',
    },
    {
      label: 'Surplus bus-hours utilized',
      before: formatCount(before.surplusBusHours),
      after: formatCount(after.surplusBusHours),
      change: `${formatCount(used)} put to use${pct(before.surplusBusHours, after.surplusBusHours)}`,
      tone: used > 0 ? 'better' : 'neutral',
      help: 'Spare bus-hours before and after; the change is what the transfers put to use.',
    },
    {
      label: 'Estimated passenger wait',
      before: `${before.meanWaitMin.toFixed(1)} min`,
      after: `${after.meanWaitMin.toFixed(1)} min`,
      change: `${signed(wait, 1)} min${pct(before.meanWaitMin, after.meanWaitMin)}`,
      tone: toneOf(wait, true),
      help: 'Demand-weighted mean wait, taken as half the headway each hour at its allocation; a headway-based estimate, not a measurement.',
    },
  ];
}

const TONE_CLASS: Readonly<Record<CompareRow['tone'], string>> = {
  better: 'text-alert-green',
  worse: 'text-alert-crimson',
  neutral: 'text-depot-muted',
};

function ComparisonStrip({ model }: { readonly model: EngineModel }) {
  const rows = compareRows(model.before, model.after);
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Impact comparison" data-testid="impact-comparison">
      {rows.map((r) => (
        <li key={r.label} className="depot-panel px-4 py-3" title={r.help}>
          <div className="depot-label">{r.label}</div>
          <div className="mt-2 flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-[13px] text-depot-muted line-through decoration-depot-faint">{r.before}</span>
            <span className="text-[20px] leading-6 text-depot-ink transition-all duration-500">{r.after}</span>
          </div>
          <div className={`mt-1 font-mono text-[11px] uppercase tracking-[0.08em] ${TONE_CLASS[r.tone]}`}>{r.change}</div>
          <p className="sr-only">{r.help}</p>
        </li>
      ))}
    </ul>
  );
}

/** The routes both heat maps show: the most short now, plus the selected transfer's pair. */
function compareRoutes(model: EngineModel, selectedRecId: string | null): readonly ScenarioRoute[] {
  const ranked = [...model.routes]
    .map((r) => ({ r, f: routeWindowFigures(r, null, model.selection) }))
    .sort((a, b) => b.f.shortageBusHours - a.f.shortageBusHours || b.f.peakDemand - a.f.peakDemand)
    .map((x) => x.r);
  const rec = model.plan.recommendations.find((x) => x.id === selectedRecId);
  const pinned = rec ? [rec.toRouteId, rec.fromRouteId].map((id) => model.routeIndex.get(id)).filter((r): r is ScenarioRoute => r !== undefined) : [];
  const rest = ranked.filter((r) => !pinned.some((p) => p.id === r.id));
  return [...pinned, ...rest].slice(0, COMPARE_ROWS);
}

/** Current allocation against the projected one: the comparison figures and the paired heat maps. */
export function ImpactSection({ model, state, dispatch }: ImpactSectionProps) {
  const ready = state.planStatus === 'ready';
  const rows = useMemo(() => compareRoutes(model, state.selectedRecId), [model, state.selectedRecId]);
  const rec = model.plan.recommendations.find((x) => x.id === state.selectedRecId);
  const highlight = rec ? new Set([rec.fromRouteId, rec.toRouteId]) : undefined;
  const view: ImpactView = ready ? state.impactView : 'current';
  const remaining =
    model.after.shortageBusHours === 0
      ? 'No shortage remains in the window under the kept transfers.'
      : `${formatCount(model.after.shortageBusHours)} bus-hours of shortage remain on ${formatCount(model.after.routesShort)} routes after the kept transfers.`;
  const gridProps = { mode: state.heatMode, scale: model.scale, window: model.selection, depotNames: model.depotNames, highlightRouteIds: highlight } as const;

  return (
    <section aria-labelledby={SECTION.impact.id} className="min-w-0" data-testid="impact-analysis">
      <SectionLabel
        id={SECTION.impact.id}
        label={SECTION.impact.label}
        note={ready ? remaining : 'Generate a plan to project the optimized network'}
        noteTone={ready ? (model.after.shortageBusHours === 0 ? 'better' : 'warning') : undefined}
        controls={
          <div role="group" aria-label="Impact view" className="flex flex-wrap gap-1">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                type="button"
                className="depot-filter-button"
                aria-pressed={view === v.key}
                disabled={!ready && v.key !== 'current'}
                onClick={() => dispatch({ type: 'impactView', view: v.key })}
              >
                {v.label}
              </button>
            ))}
          </div>
        }
      />
      {ready ? (
        <div className="mb-4">
          <ComparisonStrip model={model} />
        </div>
      ) : (
        <div className="mb-4">
          <StatePanel kind="empty" compact sentence="The projected figures appear beside the current ones once a plan is generated." />
        </div>
      )}
      {view === 'side_by_side' ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {[
            { title: CURRENT_TITLE, grid: null, id: 'impact-current' },
            { title: AFTER_TITLE, grid: model.projected, id: 'impact-after' },
          ].map((side) => (
            <div key={side.id} className="min-w-0">
              <div className={`depot-label mb-2 ${side.grid === null ? '' : 'text-holo-teal'}`}>{side.title}</div>
              <HeatGrid {...gridProps} routes={rows} grid={side.grid} compact maxHeight={520} label={`${side.title} by route and hour`} testId={side.id} />
            </div>
          ))}
        </div>
      ) : (
        <div className="min-w-0">
          <div className={`depot-label mb-2 ${view === 'optimized' ? 'text-holo-teal' : ''}`}>{view === 'optimized' ? AFTER_TITLE : CURRENT_TITLE}</div>
          <HeatGrid {...gridProps} routes={rows} grid={view === 'optimized' ? model.projected : null} maxHeight={520} label={`${view === 'optimized' ? AFTER_TITLE : CURRENT_TITLE} by route and hour`} testId="impact-single" />
        </div>
      )}
      <HeatLegend mode={state.heatMode} scale={model.scale} bandLabel={model.bandLabel} />
      <p className="depot-note mt-2">{`The ${formatCount(rows.length)} routes with the largest current shortage in ${model.bandLabel}; both views share the same routes, hours, scale and colours.`}</p>
    </section>
  );
}
