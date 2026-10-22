'use client';

import { ArrowRight, Check, Minus } from 'lucide-react';
import { useState } from 'react';
import { formatCount, formatPercent } from '@/lib/depot/format';
import type { EngineModel } from '@/lib/depot/redistribution/engineModel';
import type { Feasibility, Recommendation } from '@/lib/depot/redistribution/types';
import { busesWord, clock, coveragePoints, FEASIBILITY_LABEL, FEASIBILITY_WORDS, hoursPhrase, hourWindow } from '@/lib/depot/redistribution/wording';

export const FEASIBILITY_CLASS: Readonly<Record<Feasibility, string>> = {
  high: 'border-alert-green/50 text-alert-green',
  medium: 'border-alert-amber/50 text-alert-amber',
  low: 'border-alert-crimson/50 text-alert-crimson',
};

export function proposalNumber(rec: Pick<Recommendation, 'ordinal'>): string {
  return `#${String(rec.ordinal).padStart(2, '0')}`;
}

export interface RecommendationCardProps {
  readonly rec: Recommendation;
  readonly model: EngineModel;
  readonly included: boolean;
  readonly selected: boolean;
  readonly focused: boolean;
  readonly onToggle: () => void;
  readonly onPreview: () => void;
}

function Fact({ label, value, tone }: { readonly label: string; readonly value: string; readonly tone?: string }) {
  return (
    <div className="min-w-0">
      <dt className="depot-label">{label}</dt>
      <dd className={`mt-0.5 font-mono text-[13px] tabular-nums ${tone ?? 'text-depot-ink'}`}>{value}</dd>
    </div>
  );
}

/** One transfer proposal as a card: the route pair, the buses, the times, the gap and the reason. */
export function RecommendationCard({ rec, model, included, selected, focused, onToggle, onPreview }: RecommendationCardProps) {
  const [open, setOpen] = useState(false);
  const fromDepot = model.depotNames.get(rec.fromDepotId) ?? rec.fromDepotId;
  const toDepot = model.depotNames.get(rec.toDepotId) ?? rec.toDepotId;
  const crossDepot = rec.fromDepotId !== rec.toDepotId;
  const frame = selected ? 'border-holo-glow/70 shadow-[0_0_28px_-10px] shadow-holo-glow/80' : focused ? 'border-holo-teal/60' : '';
  return (
    <li
      className={`depot-panel flex min-w-0 flex-col px-4 py-3 transition-opacity ${frame} ${included ? '' : 'opacity-55'}`}
      data-testid="recommendation-card"
      data-included={included}
      id={`transfer-${rec.ordinal}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-holo-glow">{`Transfer Proposal ${proposalNumber(rec)}`}</span>
        <div className="flex items-center gap-1.5">
          <span className={`depot-tag ${FEASIBILITY_CLASS[rec.feasibility]}`} title={FEASIBILITY_WORDS[rec.feasibility]}>
            {FEASIBILITY_LABEL[rec.feasibility].replace(' feasibility', '')}
          </span>
          {crossDepot ? <span className="depot-tag border-depot-line text-depot-muted">Inter-depot</span> : null}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
        <div className="min-w-0">
          <div className="depot-label">From</div>
          <div className="truncate font-mono text-[15px] text-alert-amber" title={rec.fromRouteId}>
            {rec.fromRouteId}
          </div>
          <p className="depot-caption truncate">{fromDepot}</p>
        </div>
        <div className="flex flex-col items-center px-1">
          <span className="font-mono text-[22px] leading-none text-holo-glow tabular-nums">{rec.buses}</span>
          <span className="depot-label mt-0.5">{rec.buses === 1 ? 'bus' : 'buses'}</span>
          <ArrowRight aria-hidden className="mt-1 h-4 w-4 text-holo-teal" />
        </div>
        <div className="min-w-0 text-right">
          <div className="depot-label">To</div>
          <div className="truncate font-mono text-[15px] text-holo-teal" title={rec.toRouteId}>
            {rec.toRouteId}
          </div>
          <p className="depot-caption truncate">{toDepot}</p>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-depot-line pt-3 sm:grid-cols-3">
        <Fact label="Proposed movement" value={`${clock(rec.repositionStartMin)}–${clock(rec.repositionEndMin)}`} />
        <Fact label="Target service window" value={hourWindow(rec.targetFromHour, rec.targetToHour)} />
        <Fact label="Repositioning" value={`~${rec.repositionMin} min`} />
        <Fact label="Demand gap addressed" value={`${formatCount(rec.gapBusHours)} bus-h`} />
        <Fact label="Passengers served" value={`~${formatCount(rec.passengersServed)}`} />
        <Fact label="Expected improvement" value={`${formatPercent(rec.coverageBefore)} → ${formatPercent(rec.coverageAfter)} (${coveragePoints(rec.coverageBefore, rec.coverageAfter)})`} tone="text-alert-green" />
      </dl>

      {open ? (
        <div className="mt-3 border-t border-depot-line pt-3" data-testid="recommendation-detail">
          <div className="depot-label">Reason</div>
          <p className="depot-prose mt-1">{rec.reason}</p>
          <p className="depot-note mt-2">{`${FEASIBILITY_LABEL[rec.feasibility]}: ${FEASIBILITY_WORDS[rec.feasibility]} The ${busesWord(rec.buses)} are committed from ${clock(rec.repositionStartMin)} until ${hoursPhrase(rec.targetFromHour, rec.targetToHour)} ends, so no other transfer can claim them.`}</p>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-depot-line pt-3">
        <button type="button" className="depot-filter-button" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide details' : 'View details'}
        </button>
        <button type="button" className="depot-filter-button" onClick={onPreview}>
          Preview impact
        </button>
        <button
          type="button"
          className={`depot-filter-button ml-auto inline-flex items-center gap-1 ${included ? '' : 'border-depot-line text-depot-muted'}`}
          aria-pressed={included}
          onClick={onToggle}
          title={included ? 'Exclude this transfer from the projected results' : 'Include this transfer in the projected results'}
        >
          {included ? <Check aria-hidden className="h-3 w-3" /> : <Minus aria-hidden className="h-3 w-3" />}
          {included ? 'Included' : 'Excluded'}
        </button>
      </div>
    </li>
  );
}
