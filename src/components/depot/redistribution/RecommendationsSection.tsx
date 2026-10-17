'use client';

import { Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Notice } from '@/components/depot/shell/Notice';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { formatCount } from '@/lib/depot/format';
import type { EngineModel } from '@/lib/depot/redistribution/engineModel';
import type { EngineAction, EngineState } from '@/lib/depot/redistribution/engineState';
import type { Recommendation } from '@/lib/depot/redistribution/types';
import { SECTION, UNRESOLVED_WORDS } from '@/lib/depot/redistribution/wording';
import { hourLabel } from '@/lib/depot/service/serviceWording';
import { RecommendationCard } from './RecommendationCard';
import { RecommendationsTable } from './RecommendationsTable';

export interface RecommendationsSectionProps {
  readonly model: EngineModel;
  readonly state: EngineState;
  readonly dispatch: (action: EngineAction) => void;
  readonly onPreview: (id: string) => void;
}

const GENERATION_STEPS = [
  'Identifying route-hours short of buses',
  'Locating surplus capacity in the same window',
  'Ranking shortages by passenger impact',
  'Matching donors by depot and repositioning time',
  'Checking that no bus is committed twice',
  'Projecting coverage after redistribution',
] as const;
const STEP_MS = 220;
const DEFAULT_CARDS = 6;
const DEFAULT_UNRESOLVED = 6;

/** Advances through the steps while the plan is "generating", then reports the plan ready. */
function GeneratingPanel({ dispatch }: { readonly dispatch: (action: EngineAction) => void }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (step >= GENERATION_STEPS.length - 1) {
      dispatch({ type: 'planReady' });
      return undefined;
    }
    const timer = setTimeout(() => setStep((s) => s + 1), STEP_MS);
    return () => clearTimeout(timer);
  }, [step, dispatch]);
  return (
    <div className="depot-panel px-5 py-5" role="status" aria-live="polite" data-testid="plan-generating">
      <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-holo-glow">Computing redistribution plan</div>
      <ol className="mt-3 space-y-1.5">
        {GENERATION_STEPS.map((s, i) => (
          <li key={s} className={`flex items-center gap-2 font-mono text-[12px] transition-colors ${i < step ? 'text-depot-muted' : i === step ? 'text-holo-glow' : 'text-depot-faint'}`}>
            <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full ${i < step ? 'bg-alert-green' : i === step ? 'bg-holo-glow depot-tag-breathe' : 'bg-depot-line'}`} />
            {s}
          </li>
        ))}
      </ol>
    </div>
  );
}

function IdlePanel({ model, onGenerate }: { readonly model: EngineModel; readonly onGenerate: () => void }) {
  const { before } = model;
  return (
    <div className="depot-panel flex flex-col items-start gap-4 px-5 py-6 md:flex-row md:items-center md:justify-between" data-testid="plan-idle">
      <div className="min-w-0">
        <p className="depot-prose">
          {`${formatCount(before.routesShort)} routes are short of ${formatCount(before.shortageBusHours)} bus-hours in ${model.bandLabel}, while ${formatCount(before.surplusBusHours)} surplus bus-hours stand on ${formatCount(before.routesSurplus)} routes.`}
        </p>
        <p className="depot-note mt-1">
          The engine matches the largest shortages to spare buses within reach, never commits a bus twice and never leaves a donor route short.
        </p>
      </div>
      <button type="button" className="depot-button-primary inline-flex shrink-0 items-center gap-2 px-5 py-2.5 text-[12px]" onClick={onGenerate} data-testid="generate-plan">
        <Sparkles aria-hidden className="h-4 w-4" />
        Generate AI Redistribution Plan
      </button>
    </div>
  );
}

function orderForFocus(recs: readonly Recommendation[], focusRouteId: string | null): readonly Recommendation[] {
  if (focusRouteId === null) return recs;
  const touches = (r: Recommendation): boolean => r.toRouteId === focusRouteId || r.fromRouteId === focusRouteId;
  return [...recs.filter(touches), ...recs.filter((r) => !touches(r))];
}

/** The engine's proposals: the generate action, then the cards or the table, with include and exclude. */
export function RecommendationsSection({ model, state, dispatch, onPreview }: RecommendationsSectionProps) {
  const [asTable, setAsTable] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [showAllUnresolved, setShowAllUnresolved] = useState(false);
  const recs = model.plan.recommendations;
  const ordered = useMemo(() => orderForFocus(recs, state.focusRouteId), [recs, state.focusRouteId]);
  const focusedCount = state.focusRouteId === null ? 0 : ordered.filter((r) => r.toRouteId === state.focusRouteId || r.fromRouteId === state.focusRouteId).length;
  const shown = showAll || asTable ? ordered : ordered.slice(0, DEFAULT_CARDS);
  const ready = state.planStatus === 'ready';
  const note = ready ? `${formatCount(model.included.length)} of ${formatCount(recs.length)} transfers included` : `${model.bandLabel}`;
  const unresolved = showAllUnresolved ? model.unresolvedAfter : model.unresolvedAfter.slice(0, DEFAULT_UNRESOLVED);

  return (
    <section aria-labelledby={SECTION.recommendations.id} className="min-w-0" data-testid="ai-recommendations">
      <SectionLabel
        id={SECTION.recommendations.id}
        label={SECTION.recommendations.label}
        count={ready ? recs.length : undefined}
        note={note}
        controls={
          ready ? (
            <>
              <button type="button" className="depot-filter-button" aria-pressed={!asTable} onClick={() => setAsTable(false)}>
                Cards
              </button>
              <button type="button" className="depot-filter-button" aria-pressed={asTable} onClick={() => setAsTable(true)}>
                Table
              </button>
              <button type="button" className="depot-filter-button" onClick={() => dispatch({ type: 'includeAll' })} disabled={state.excludedIds.size === 0}>
                Include all
              </button>
              <button type="button" className="depot-filter-button" onClick={() => dispatch({ type: 'excludeAll', ids: recs.map((r) => r.id) })} disabled={model.included.length === 0}>
                Exclude all
              </button>
            </>
          ) : undefined
        }
      />
      {state.planStatus === 'idle' ? <IdlePanel model={model} onGenerate={() => dispatch({ type: 'generate' })} /> : null}
      {state.planStatus === 'generating' ? <GeneratingPanel dispatch={dispatch} /> : null}
      {ready ? (
        <>
          <Notice status="info" word="Recommendation only">
            Every transfer here is a proposal for the manager to weigh; nothing is dispatched, and including or excluding a transfer only changes the projected figures.
          </Notice>
          {state.focusRouteId !== null ? (
            <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="focus-chip">
              <span className="depot-tag border-holo-teal/50 text-holo-teal">
                {`Focused on ${state.focusRouteId}${state.selectedCell && state.selectedCell.routeId === state.focusRouteId ? ` at ${hourLabel(state.selectedCell.hour)}` : ''} · ${formatCount(focusedCount)} ${focusedCount === 1 ? 'transfer' : 'transfers'}`}
              </span>
              <button type="button" className="depot-filter-button inline-flex items-center gap-1" onClick={() => dispatch({ type: 'focusRoute', routeId: null })}>
                <X aria-hidden className="h-3 w-3" />
                Clear focus
              </button>
            </div>
          ) : null}
          {recs.length === 0 ? (
            <StatePanel kind="empty" compact tone="ok" sentence="No feasible transfer in this window: either nothing is short, or no spare bus stands within reach of a short route." />
          ) : asTable ? (
            <RecommendationsTable rows={ordered} model={model} selectedId={state.selectedRecId} onToggle={(id) => dispatch({ type: 'toggleRec', id })} onPreview={onPreview} />
          ) : (
            <>
              <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3" aria-label="Transfer proposals">
                {shown.map((r) => (
                  <RecommendationCard
                    key={r.id}
                    rec={r}
                    model={model}
                    included={model.includedIds.has(r.id)}
                    selected={state.selectedRecId === r.id}
                    focused={state.focusRouteId !== null && (r.toRouteId === state.focusRouteId || r.fromRouteId === state.focusRouteId)}
                    onToggle={() => dispatch({ type: 'toggleRec', id: r.id })}
                    onPreview={() => onPreview(r.id)}
                  />
                ))}
              </ul>
              {ordered.length > DEFAULT_CARDS ? (
                <div className="mt-3">
                  <button type="button" className="depot-filter-button" aria-pressed={showAll} onClick={() => setShowAll((v) => !v)}>
                    {showAll ? `Show first ${DEFAULT_CARDS}` : `Show all ${formatCount(ordered.length)} proposals`}
                  </button>
                </div>
              ) : null}
            </>
          )}
          {model.unresolvedAfter.length > 0 ? (
            <div className="mt-6" data-testid="unresolved-shortages">
              <SectionLabel label="Shortages the plan cannot reach" level={3} count={model.unresolvedAfter.length} note="After the transfers kept above" />
              <ul className="divide-y divide-depot-line border-y border-depot-line">
                {unresolved.map((u) => (
                  <li key={u.routeId} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2">
                    <span className="font-mono text-[12px] text-depot-ink">{u.routeId}</span>
                    <span className="font-mono text-[11px] text-alert-amber">{`short ${formatCount(u.peakShortage)} at peak · ${formatCount(u.busHours)} bus-h`}</span>
                    <span className="font-mono text-[11px] text-depot-muted">{u.hours.map(hourLabel).join(' ')}</span>
                    <span className="depot-note ml-auto min-w-0">{UNRESOLVED_WORDS[u.reason]}</span>
                  </li>
                ))}
              </ul>
              {model.unresolvedAfter.length > DEFAULT_UNRESOLVED ? (
                <button type="button" className="depot-filter-button mt-2" aria-pressed={showAllUnresolved} onClick={() => setShowAllUnresolved((v) => !v)}>
                  {showAllUnresolved ? `Show first ${DEFAULT_UNRESOLVED}` : `Show all ${formatCount(model.unresolvedAfter.length)}`}
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
