'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bot, ShieldAlert } from 'lucide-react';
import { formatCount } from '@/lib/depot/format';
import { type JourneyAudit, type VehicleFuelHistory } from '@/lib/depot/os/intel/fuelAudit';
import { DEPOT_PALETTE } from '@/lib/depot/palette';
import { useOsStore, type CaseStatus } from '../osStore';
import { EmptyNote, Fact, SeverityChip, StatusTag } from '../ui';

export const CASE_LABEL: Readonly<Record<CaseStatus, string>> = {
  open: 'Open',
  assigned: 'Assigned for verification',
  under_review: 'Under review',
  explained: 'Explained',
  referred: 'Referred for physical verification',
};

const CASE_ORDER: readonly CaseStatus[] = ['open', 'assigned', 'under_review', 'explained', 'referred'];

/** The vehicle's 14 journeys as km/L bars, its median as a line, the selected one lit. */
function HistoryChart({ history, selectedId }: { readonly history: VehicleFuelHistory; readonly selectedId: string }) {
  const W = 360;
  const H = 120;
  const j = history.journeys;
  if (j.length === 0) return null;
  const max = Math.max(history.classKmPerLitre, ...j.map((x) => x.kmPerLitre)) * 1.1;
  const bw = W / j.length;
  const y = (v: number): number => H - (v / max) * (H - 14);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[120px] w-full" role="img" aria-label="Economy of each journey in the window">
      {j.map((x, i) => (
        <rect
          key={x.id}
          x={i * bw + 2}
          y={y(x.kmPerLitre)}
          width={bw - 4}
          height={H - y(x.kmPerLitre)}
          rx={2}
          fill={x.id === selectedId ? DEPOT_PALETTE.crimson : x.flagged ? DEPOT_PALETTE.amber : DEPOT_PALETTE.deep}
          opacity={x.id === selectedId ? 1 : 0.85}
        >
          <title>{`${x.date}: ${x.kmPerLitre.toFixed(2)} km/L`}</title>
        </rect>
      ))}
      {history.medianKmPerLitre !== null ? (
        <line x1={0} x2={W} y1={y(history.medianKmPerLitre)} y2={y(history.medianKmPerLitre)} stroke={DEPOT_PALETTE.teal} strokeDasharray="4 3" strokeWidth={1.5} />
      ) : null}
      <line x1={0} x2={W} y1={y(history.classKmPerLitre)} y2={y(history.classKmPerLitre)} stroke={DEPOT_PALETTE.slate} strokeDasharray="2 4" strokeWidth={1} />
    </svg>
  );
}

/**
 * One flagged journey under investigation: actual against expected fuel, the bus's own
 * history and class, comparable buses, the factors behind the flag, the explanations to
 * check, and the case's status. The panel never concludes a cause.
 */
export function FuelInvestigation({
  journey,
  history,
  peers,
}: {
  readonly journey: JourneyAudit | null;
  readonly history: VehicleFuelHistory | null;
  /** Buses of the same class in the same depot, by median km/L. */
  readonly peers: readonly { readonly registration: string; readonly median: number | null }[];
}) {
  const fuelCases = useOsStore((s) => s.fuelCases);
  const setFuelCase = useOsStore((s) => s.setFuelCase);
  const setFocus = useOsStore((s) => s.setFocus);
  const askCopilot = useOsStore((s) => s.askCopilot);
  const openEntity = useOsStore((s) => s.openEntity);
  const current = journey ? fuelCases[journey.id] : undefined;
  const [assignee, setAssignee] = useState('');

  useEffect(() => {
    setAssignee(current?.assignee ?? '');
    if (journey) setFocus({ kind: 'journey', id: journey.id, label: `${journey.registration} on ${journey.date}` });
  }, [journey, current?.assignee, setFocus]);

  const peerMedian = useMemo(() => {
    const values = peers.flatMap((p) => (p.median === null ? [] : [p.median])).sort((a, b) => a - b);
    return values.length > 0 ? values[Math.floor(values.length / 2)]! : null;
  }, [peers]);

  if (!journey || !history) return <EmptyNote>Select a flagged journey to investigate it.</EmptyNote>;
  const status = current?.status ?? 'open';
  const maxLitres = Math.max(journey.fuelLitres, journey.expectedLitres);

  return (
    <div className="space-y-4 p-4" data-testid="os-fuel-investigation">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <button type="button" onClick={() => openEntity({ kind: 'vehicle', id: journey.registration, depotId: journey.depotId })} className="font-mono text-[16px] font-semibold text-holo-glow hover:underline">
            {journey.registration}
          </button>
          <div className="font-sans text-[12px] text-depot-prose">
            {journey.date} · {journey.routeName ?? 'Route not carried in the feed'} · {history.serviceClass} · {history.ageYears} yrs
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {journey.severity ? <SeverityChip severity={journey.severity} /> : null}
          <StatusTag status="scenario" />
        </div>
      </div>

      <section>
        <h3 className="os-kicker mb-2">Actual against expected</h3>
        {[
          { label: 'Issued', litres: journey.fuelLitres, cls: 'bg-alert-crimson' },
          { label: 'Expected at its own median', litres: journey.expectedLitres, cls: 'bg-holo-teal' },
        ].map((row) => (
          <div key={row.label} className="mb-1.5">
            <div className="mb-0.5 flex justify-between font-sans text-[12px] text-depot-prose">
              <span>{row.label}</span>
              <span className="font-mono text-depot-ink">{row.litres.toFixed(1)} L</span>
            </div>
            <div className="h-2 rounded-full bg-depot-raised">
              <div className={`h-2 rounded-full ${row.cls}`} style={{ width: `${(row.litres / maxLitres) * 100}%` }} />
            </div>
          </div>
        ))}
        <dl className="mt-2">
          <Fact label="Distance" value={`${formatCount(journey.distanceKm)} km`} />
          <Fact label="Economy this journey" value={`${journey.kmPerLitre.toFixed(2)} km/L`} tone="crimson" />
          <Fact label="Its own median" value={`${journey.baselineKmPerLitre.toFixed(2)} km/L`} />
          <Fact label="Variance" value={`+${Math.round(journey.variance * 100)}% · ${journey.z === null ? '—' : `${journey.z}σ`}`} tone="amber" />
          <Fact label="Excess fuel · exposure" value={`${journey.excessLitres.toFixed(1)} L · ₹${formatCount(journey.exposureRupees)}`} tone="amber" />
        </dl>
      </section>

      <section>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="os-kicker">Vehicle history, 14 days</h3>
          <span className="font-sans text-[11px] text-depot-prose">Teal: its median · grey: class</span>
        </div>
        <HistoryChart history={history} selectedId={journey.id} />
      </section>

      <section>
        <h3 className="os-kicker mb-1">Comparable buses</h3>
        <dl>
          <Fact label="Class figure" value={`${history.classKmPerLitre.toFixed(1)} km/L`} />
          <Fact label={`Same class in the depot (${formatCount(peers.length)})`} value={peerMedian === null ? '—' : `${peerMedian.toFixed(2)} km/L median`} />
          <Fact label="This bus" value={history.medianKmPerLitre === null ? '—' : `${history.medianKmPerLitre.toFixed(2)} km/L median`} />
        </dl>
      </section>

      <section>
        <h3 className="os-kicker mb-1">Why it was flagged</h3>
        <ul className="space-y-1">
          {journey.factors.map((f) => (
            <li key={f} className="flex gap-2 font-sans text-[12.5px] text-depot-ink">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-alert-amber" aria-hidden />
              {f}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="os-kicker mb-1">Explanations to check, in order</h3>
        <ol className="list-decimal space-y-1 pl-4">
          {journey.explanations.map((e) => (
            <li key={e} className="font-sans text-[12.5px] text-depot-prose">
              {e}
            </li>
          ))}
        </ol>
        <p className="mt-2 flex items-start gap-1.5 font-sans text-[12px] text-depot-prose">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-alert-amber" aria-hidden />
          An anomaly, not a finding. No conclusion about any person is drawn by the system.
        </p>
      </section>

      <section className="border-t border-holo-glow/10 pt-3">
        <h3 className="os-kicker mb-2">Case</h3>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={status}
            onChange={(event) => setFuelCase(journey.id, event.target.value as CaseStatus, assignee.trim())}
            aria-label="Case status"
            className="depot-control depot-select font-sans"
          >
            {CASE_ORDER.map((c) => (
              <option key={c} value={c}>
                {CASE_LABEL[c]}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={assignee}
            onChange={(event) => setAssignee(event.target.value)}
            placeholder="Assign to (role or desk)"
            aria-label="Assign to"
            maxLength={60}
            className="depot-field min-w-0 flex-1 font-sans text-depot-ink"
          />
          <button
            type="button"
            onClick={() => setFuelCase(journey.id, status === 'open' ? 'assigned' : status, assignee.trim() || 'Depot accounts')}
            className="os-button os-button-solid"
            data-testid="os-fuel-assign"
          >
            {status === 'open' ? 'Assign for verification' : 'Update'}
          </button>
        </div>
        {current ? (
          <p className="mt-2 font-sans text-[12px] text-holo-teal">
            {CASE_LABEL[current.status]}
            {current.assignee ? ` · ${current.assignee}` : ''} · {new Date(current.at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
          </p>
        ) : null}
        <button type="button" onClick={() => askCopilot('Why was this fuel journey flagged?')} className="os-button os-button-quiet mt-3">
          <Bot className="h-3.5 w-3.5" aria-hidden />
          Ask the copilot
        </button>
      </section>
    </div>
  );
}
