'use client';

import { ArrowRight } from 'lucide-react';
import { formatCount, formatPercent } from '@/lib/depot/format';
import type { EngineModel } from '@/lib/depot/redistribution/engineModel';
import type { CellRef } from '@/lib/depot/redistribution/engineState';
import { cellCoverage } from '@/lib/depot/redistribution/metrics';
import { SERVICE_CLASS_LABEL } from '@/lib/depot/redistribution/scenario';
import type { Recommendation } from '@/lib/depot/redistribution/types';
import { busesWord, clock } from '@/lib/depot/redistribution/wording';
import { hourLabel } from '@/lib/depot/service/serviceWording';

export interface CellDetailProps {
  readonly cell: CellRef | null;
  readonly model: EngineModel;
  readonly planReady: boolean;
  readonly onExplore: (routeId: string) => void;
}

const MINUTES_PER_HOUR = 60;

/** The transfers that touch this route in this hour, as destination or as donor. */
function relatedTransfers(model: EngineModel, cell: CellRef): readonly Recommendation[] {
  return model.plan.recommendations.filter((r) => {
    if (r.toRouteId === cell.routeId) return cell.hour >= r.targetFromHour && cell.hour <= r.targetToHour;
    if (r.fromRouteId === cell.routeId) return cell.hour >= Math.floor(r.repositionStartMin / MINUTES_PER_HOUR) && cell.hour <= r.targetToHour;
    return false;
  });
}

function Row({ label, value, tone }: { readonly label: string; readonly value: string; readonly tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-depot-line py-1.5 first:border-t-0">
      <dt className="depot-label">{label}</dt>
      <dd className={`font-mono text-[13px] tabular-nums ${tone ?? 'text-depot-ink'}`}>{value}</dd>
    </div>
  );
}

/** The inspector for one route-hour: its figures, its transfers, and the way into the recommendations. */
export function CellDetail({ cell, model, planReady, onExplore }: CellDetailProps) {
  if (cell === null) {
    return (
      <aside className="depot-panel flex min-h-[180px] flex-col justify-center px-4 py-4" aria-label="Cell details" data-testid="cell-detail">
        <div className="depot-label">Cell inspector</div>
        <p className="depot-note mt-2">Click any route-hour cell to see its passenger demand, buses required and available, and the transfers that reach it.</p>
      </aside>
    );
  }
  const route = model.routeIndex.get(cell.routeId);
  if (!route) return null;
  const demand = route.demand[cell.hour] ?? 0;
  const required = route.required[cell.hour] ?? 0;
  const available = route.available[cell.hour] ?? 0;
  const projected = model.projected.get(route.id)?.[cell.hour] ?? available;
  const gap = required - available;
  const coverage = cellCoverage(required, available);
  const gapWords = required <= 0 ? 'No service this hour' : gap > 0 ? `Short ${busesWord(gap)}` : gap < 0 ? `Surplus ${busesWord(-gap)}` : 'Balanced';
  const gapTone = gap > 0 ? 'text-alert-amber' : gap < 0 ? 'text-alert-green' : 'text-depot-ink';
  const related = relatedTransfers(model, cell);
  return (
    <aside className="depot-panel px-4 py-4" aria-label={`Details for ${route.id} at ${hourLabel(cell.hour)}`} data-testid="cell-detail">
      <div className="flex items-baseline justify-between gap-3">
        <div className="depot-label">Cell inspector</div>
        <span className="font-mono text-[11px] text-holo-glow">{hourLabel(cell.hour)}</span>
      </div>
      <div className="mt-1 font-mono text-[15px] text-holo-glow">{route.id}</div>
      <p className="depot-caption">{`${model.depotNames.get(route.depotId) ?? route.depotId} · ${SERVICE_CLASS_LABEL[route.serviceClass]} · ${route.seats} seats`}</p>
      <dl className="mt-3">
        <Row label="Passenger demand" value={formatCount(demand)} />
        <Row label="Buses required" value={formatCount(required)} />
        <Row label="Buses available" value={formatCount(available)} />
        <Row label="Balance" value={gapWords} tone={gapTone} />
        <Row label="Demand coverage" value={required <= 0 ? '—' : formatPercent(coverage)} />
        {planReady && projected !== available ? (
          <Row label="After kept transfers" value={`${formatCount(projected)} buses · ${formatPercent(cellCoverage(required, projected))}`} tone="text-holo-teal" />
        ) : null}
      </dl>
      <div className="mt-3 border-t border-depot-line pt-3">
        <div className="depot-label">Redistribution opportunities</div>
        {!planReady ? (
          <p className="depot-note mt-1">Generate a plan to see the transfers that reach this route-hour.</p>
        ) : related.length === 0 ? (
          <p className="depot-note mt-1">{gap > 0 ? 'No feasible transfer reaches this route-hour.' : 'No transfer touches this route-hour.'}</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {related.map((r) => (
              <li key={r.id} className="flex items-center gap-2 font-mono text-[11px] text-depot-ink">
                <span className="text-depot-muted">{`#${String(r.ordinal).padStart(2, '0')}`}</span>
                <span className={r.fromRouteId === route.id ? 'text-alert-amber' : 'text-holo-teal'}>{r.fromRouteId}</span>
                <ArrowRight aria-hidden className="h-3 w-3 text-depot-faint" />
                <span className={r.toRouteId === route.id ? 'text-holo-teal' : 'text-depot-ink'}>{r.toRouteId}</span>
                <span className="ml-auto text-depot-muted">{`${busesWord(r.buses)} · ${clock(r.repositionStartMin)}`}</span>
                {!model.includedIds.has(r.id) ? <span className="text-depot-faint">excluded</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
      <button type="button" className="depot-button-primary mt-4 w-full" onClick={() => onExplore(route.id)}>
        Explore Redistribution Options
      </button>
    </aside>
  );
}
