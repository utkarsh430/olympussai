'use client';

import { useMemo, useState } from 'react';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { formatCount } from '@/lib/depot/format';
import { DEPOT_PALETTE } from '@/lib/depot/palette';
import type { EngineModel } from '@/lib/depot/redistribution/engineModel';
import type { EngineAction, EngineState } from '@/lib/depot/redistribution/engineState';
import type { Recommendation } from '@/lib/depot/redistribution/types';
import { busesWord, clock, hourWindow, SECTION } from '@/lib/depot/redistribution/wording';
import { hourDigits } from '@/lib/depot/service/serviceWording';
import { proposalNumber } from './RecommendationCard';

export interface TimelineSectionProps {
  readonly model: EngineModel;
  readonly state: EngineState;
  readonly dispatch: (action: EngineAction) => void;
}

const MINUTES_PER_HOUR = 60;
const DEFAULT_ROWS = 16;

interface Axis {
  readonly fromMin: number;
  readonly toMin: number;
}

/** From an hour before the earliest departure to the end of the latest target hour, at least the window. */
function axisOf(recs: readonly Recommendation[], window: { readonly fromHour: number; readonly toHour: number }): Axis {
  const starts = recs.map((r) => Math.floor(r.repositionStartMin / MINUTES_PER_HOUR) * MINUTES_PER_HOUR);
  const ends = recs.map((r) => (r.targetToHour + 1) * MINUTES_PER_HOUR);
  const fromMin = Math.max(0, Math.min(window.fromHour * MINUTES_PER_HOUR, ...starts) - MINUTES_PER_HOUR);
  const toMin = Math.min(24 * MINUTES_PER_HOUR, Math.max((window.toHour + 1) * MINUTES_PER_HOUR, ...ends));
  return { fromMin, toMin };
}

const pos = (axis: Axis, minute: number): string => `${((minute - axis.fromMin) / (axis.toMin - axis.fromMin)) * 100}%`;
const width = (axis: Axis, from: number, to: number): string => `${((to - from) / (axis.toMin - axis.fromMin)) * 100}%`;

/** Amber diagonal strokes: the bus is on the road between routes. */
const REPOSITIONING_FILL = `repeating-linear-gradient(135deg, ${DEPOT_PALETTE.amber}d9 0 3px, ${DEPOT_PALETTE.amber}40 3px 6px)`;

function Segment({ axis, from, to, className, style, label }: { axis: Axis; from: number; to: number; className: string; style?: React.CSSProperties; label: string }) {
  return (
    <span
      className={`absolute top-1 bottom-1 flex items-center overflow-hidden whitespace-nowrap rounded-[2px] px-1.5 font-mono text-[10px] ${className}`}
      style={{ left: pos(axis, from), width: width(axis, from, to), ...style }}
      title={label}
    >
      <span className="truncate">{label}</span>
    </span>
  );
}

function Row({ rec, axis, included, selected, onSelect }: { rec: Recommendation; axis: Axis; included: boolean; selected: boolean; onSelect: () => void }) {
  const leaveMin = rec.repositionStartMin;
  const targetFrom = rec.targetFromHour * MINUTES_PER_HOUR;
  const targetTo = (rec.targetToHour + 1) * MINUTES_PER_HOUR;
  const label = `${proposalNumber(rec)} ${rec.fromRouteId} to ${rec.toRouteId}, ${busesWord(rec.buses)}`;
  return (
    <li className={`grid grid-cols-[220px_minmax(0,1fr)_88px] items-stretch gap-x-3 border-t border-depot-line ${included ? '' : 'opacity-50'}`} data-testid="timeline-row">
      <button
        type="button"
        className={`min-w-0 py-1.5 text-left font-mono text-[11px] leading-4 ${selected ? 'text-holo-glow' : 'text-depot-ink'} hover:text-holo-glow focus-visible:outline focus-visible:outline-2 focus-visible:outline-holo-glow`}
        aria-pressed={selected}
        onClick={onSelect}
        title={label}
      >
        <span className="text-depot-muted">{proposalNumber(rec)} </span>
        <span className="text-alert-amber">{rec.fromRouteId}</span>
        <span className="text-depot-faint"> → </span>
        <span className="text-holo-teal">{rec.toRouteId}</span>
        <span className="block text-depot-muted">{busesWord(rec.buses)}</span>
      </button>
      <div className={`relative my-1 min-h-[32px] rounded-[2px] ${selected ? 'bg-holo-glow/[0.08] ring-1 ring-holo-glow/60' : 'bg-depot-surface'}`} aria-label={`${label}: available on ${rec.fromRouteId} until ${clock(leaveMin)}, repositioning ${clock(leaveMin)}–${clock(rec.repositionEndMin)}, assigned to ${rec.toRouteId} ${hourWindow(rec.targetFromHour, rec.targetToHour)}`} role="img">
        <Segment axis={axis} from={axis.fromMin} to={leaveMin} className="bg-slate-400/15 text-depot-muted" label={`Available on ${rec.fromRouteId}`} />
        <Segment axis={axis} from={leaveMin} to={rec.repositionEndMin} className="text-depot-page" style={{ backgroundImage: REPOSITIONING_FILL }} label={`Repositioning ${clock(leaveMin)}–${clock(rec.repositionEndMin)}`} />
        <Segment axis={axis} from={targetFrom} to={targetTo} className="bg-holo-teal/80 text-depot-page" label={`Assigned to ${rec.toRouteId} ${hourWindow(rec.targetFromHour, rec.targetToHour)}`} />
      </div>
      <span className={`self-center font-mono text-[10px] uppercase tracking-[0.1em] ${included ? 'text-alert-green' : 'text-depot-muted'}`}>
        {included ? 'In plan' : 'Excluded'}
      </span>
    </li>
  );
}

/** The proposed movements against the hours of the day, one row a transfer, the selected one lit. */
export function TimelineSection({ model, state, dispatch }: TimelineSectionProps) {
  const [showAll, setShowAll] = useState(false);
  const ready = state.planStatus === 'ready';
  const recs = model.plan.recommendations;
  const ordered = useMemo(() => {
    const sel = recs.find((r) => r.id === state.selectedRecId);
    const rest = [...recs].filter((r) => r.id !== state.selectedRecId).sort((a, b) => a.repositionStartMin - b.repositionStartMin || a.ordinal - b.ordinal);
    return sel ? [sel, ...rest] : rest;
  }, [recs, state.selectedRecId]);
  const shown = showAll ? ordered : ordered.slice(0, DEFAULT_ROWS);
  const axis = useMemo(() => axisOf(recs, model.selection), [recs, model.selection]);
  const hours = useMemo(() => {
    const out: number[] = [];
    for (let m = axis.fromMin; m <= axis.toMin; m += MINUTES_PER_HOUR) out.push(m);
    return out;
  }, [axis]);

  return (
    <section aria-labelledby={SECTION.timeline.id} className="min-w-0" data-testid="movement-timeline">
      <SectionLabel
        id={SECTION.timeline.id}
        label={SECTION.timeline.label}
        count={ready ? recs.length : undefined}
        note={ready ? 'Available → Repositioning → Assigned to new route' : 'Appears once a plan is generated'}
      />
      {!ready ? (
        <StatePanel kind="empty" compact sentence="The movement timeline shows each proposed transfer against the hours of the day once a plan is generated." />
      ) : recs.length === 0 ? (
        <StatePanel kind="empty" compact tone="ok" sentence="No movement to show: the plan holds no transfer for this window." />
      ) : (
        <>
          <ul className="depot-note mb-3 flex flex-wrap items-center gap-x-5 gap-y-1" aria-label="Timeline legend">
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-3 w-5 rounded-[1px] bg-slate-400/25" />
              Available on source route
            </li>
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-3 w-5 rounded-[1px]" style={{ backgroundImage: REPOSITIONING_FILL }} />
              Repositioning
            </li>
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-3 w-5 rounded-[1px] bg-holo-teal/80" />
              Assigned to new route
            </li>
            <li className="text-depot-muted">A bus is committed from the minute it leaves its source until its target window ends; the engine never promises it to two routes.</li>
          </ul>
          <div className="overflow-x-auto">
            <div className="min-w-[760px]">
              <div className="grid grid-cols-[220px_minmax(0,1fr)_88px] gap-x-3" aria-hidden>
                <span />
                <div className="relative h-5">
                  {hours.map((m) => (
                    <span key={m} className={`absolute top-0 -translate-x-1/2 font-mono text-[10px] ${m >= model.selection.fromHour * MINUTES_PER_HOUR && m < (model.selection.toHour + 1) * MINUTES_PER_HOUR ? 'text-holo-glow' : 'text-depot-faint'}`} style={{ left: pos(axis, m) }}>
                      {hourDigits(m / MINUTES_PER_HOUR)}
                    </span>
                  ))}
                </div>
                <span />
              </div>
              <ul className="border-b border-depot-line" aria-label="Proposed movements">
                {shown.map((r) => (
                  <Row key={r.id} rec={r} axis={axis} included={model.includedIds.has(r.id)} selected={state.selectedRecId === r.id} onSelect={() => dispatch({ type: 'selectRec', id: state.selectedRecId === r.id ? null : r.id })} />
                ))}
              </ul>
            </div>
          </div>
          {ordered.length > DEFAULT_ROWS ? (
            <button type="button" className="depot-filter-button mt-3" aria-pressed={showAll} onClick={() => setShowAll((v) => !v)}>
              {showAll ? `Show first ${DEFAULT_ROWS}` : `Show all ${formatCount(ordered.length)} movements`}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
