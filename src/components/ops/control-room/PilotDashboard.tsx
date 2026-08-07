import type { DailyKpiSnapshot, GuardrailBreach, WarRoomIncident } from '@/models/control';
import type { PilotSnapshot } from '@/lib/controlService/pilotData';
import { IncidentReviewForm } from './IncidentReviewForm';

function SourceNotice({ label, snapshot }: { label: string; snapshot: PilotSnapshot<unknown> }) {
  if (snapshot.source === 'live') return null;
  return (
    <div
      role="alert"
      className="mb-3 rounded-md border border-[#e8b34a]/40 bg-[#e8b34a]/10 px-3 py-2 text-xs text-[#e8c07a]"
    >
      {label}: showing the last known data{snapshot.stale ? ' (stale)' : ''} — the live feed did not respond
      {snapshot.error ? ` (${snapshot.error})` : ''}.
    </div>
  );
}

function formatSeconds(value: number | null): string {
  if (value === null) return '—';
  return `${value.toFixed(1)}s`;
}

function formatPct(value: number | null): string {
  if (value === null) return '—';
  return `${Math.round(value * 100)}%`;
}

function KpiTable({ snapshots }: { snapshots: DailyKpiSnapshot[] }) {
  if (snapshots.length === 0) {
    return <p className="text-sm text-[#9aa0ad]">No route-directions to report on yet.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-md border border-[rgba(255,255,255,0.1)]">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="bg-[rgba(255,255,255,0.03)] font-mono text-[10px] uppercase tracking-[0.12em] text-[#6f7684]">
          <tr>
            <th className="px-3 py-2">Route</th>
            <th className="px-3 py-2">EWT</th>
            <th className="px-3 py-2">CV</th>
            <th className="px-3 py-2">Recovery rate</th>
            <th className="px-3 py-2">Guardrail breaches</th>
            <th className="px-3 py-2">Compliance</th>
          </tr>
        </thead>
        <tbody>
          {snapshots.map((s) => (
            <tr key={s.routeDirectionId} className="border-t border-[rgba(255,255,255,0.06)]">
              <td className="px-3 py-2 text-[#e6e9ef]">
                {s.publicName} <span className="text-[#9aa0ad]">({s.directionCode})</span>
              </td>
              <td className="px-3 py-2">{formatSeconds(s.ewtSeconds)}</td>
              <td className="px-3 py-2">{s.cv === null ? '—' : s.cv.toFixed(2)}</td>
              <td className="px-3 py-2">
                {formatPct(s.recoveryRate)}{' '}
                <span className="text-[#6f7684]">
                  ({s.recoveredIncidentCount}/{s.incidentCount})
                </span>
              </td>
              <td className="px-3 py-2">
                <span className={s.guardrailBreachCount > 0 ? 'text-[#f0b45d]' : ''}>{s.guardrailBreachCount}</span>
              </td>
              <td className="px-3 py-2">
                {formatPct(s.compliancePct)}{' '}
                <span className="text-[#6f7684]">({s.complianceSampleCount})</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GuardrailBreachFeed({ breaches }: { breaches: GuardrailBreach[] }) {
  if (breaches.length === 0) {
    return <p className="text-sm text-[#9aa0ad]">No guardrail breaches recorded.</p>;
  }
  return (
    <ul className="space-y-2">
      {breaches.slice(0, 20).map((b) => (
        <li
          key={b.id}
          className="rounded-md border border-[rgba(255,255,255,0.08)] bg-[rgba(10,11,16,0.4)] px-3 py-2 text-xs"
        >
          <span
            className={`mr-2 rounded px-1.5 py-0.5 font-mono uppercase ${
              b.severity === 'critical'
                ? 'bg-[#f0857d]/20 text-[#f5a89f]'
                : b.severity === 'warning'
                  ? 'bg-[#e8b34a]/20 text-[#e8c07a]'
                  : 'bg-[rgba(255,255,255,0.08)] text-[#9aa0ad]'
            }`}
          >
            {b.severity}
          </span>
          <span className="text-[#e6e9ef]">{b.breachType}</span>
          <span className="ml-2 text-[#6f7684]">{new Date(b.detectedAt).toLocaleString()}</span>
        </li>
      ))}
    </ul>
  );
}

function WarRoomList({ incidents, viewerEmail }: { incidents: WarRoomIncident[]; viewerEmail: string }) {
  if (incidents.length === 0) {
    return <p className="text-sm text-[#9aa0ad]">No incidents recorded for this day.</p>;
  }
  return (
    <ul className="space-y-4">
      {incidents.map((incident) => (
        <li key={incident.incidentId} className="rounded-md border border-[rgba(255,255,255,0.1)] p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="font-mono uppercase text-[#8fb4ff]">{incident.severity}</span>
            <span className="text-[#6f7684]">started {new Date(incident.startedAt).toLocaleString()}</span>
            <span className="text-[#6f7684]">status: {incident.status}</span>
            {incident.measuredCompliance && (
              <span className="text-[#7ed6a5]">compliance: {incident.measuredCompliance}</span>
            )}
            {incident.measuredRecoverySeconds !== null && (
              <span className="text-[#7ed6a5]">recovered in {formatSeconds(incident.measuredRecoverySeconds)}</span>
            )}
          </div>
          <IncidentReviewForm incident={incident} viewerEmail={viewerEmail} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Pilot-staging dashboard content (AC2 KPI table, AC3 war-room list, AC4
 * guardrail-breach feed). Presentational — see ObservabilityDashboard's
 * doc comment for why this stays a thin server-rendered shell around
 * pilotData.ts's snapshots, with only the incident-review form
 * (IncidentReviewForm) escalating to a client component.
 */
export function PilotDashboard({
  kpi,
  breaches,
  warRoom,
  date,
  viewerEmail,
}: {
  kpi: PilotSnapshot<DailyKpiSnapshot[]>;
  breaches: PilotSnapshot<GuardrailBreach[]>;
  warRoom: PilotSnapshot<WarRoomIncident[]>;
  date?: string;
  viewerEmail: string;
}) {
  const shownDate = date ?? kpi.data[0]?.snapshotDate ?? new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-8">
      <p className="text-xs text-[#6f7684]">
        Reporting day: <span className="text-[#e6e9ef]">{shownDate}</span> (UTC). Rollout stages are set from{' '}
        <a href="/ops/admin/rollout-stages" className="text-[#8fb4ff] hover:underline">
          Admin &middot; Rollout stages
        </a>
        .
      </p>

      <section>
        <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#6f7684]">
          Daily KPIs — EWT / CV / recovery / breaches / compliance
        </h2>
        <SourceNotice label="Daily KPIs" snapshot={kpi} />
        <KpiTable snapshots={kpi.data} />
      </section>

      <section>
        <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#6f7684]">
          Guardrail breaches (real-time)
        </h2>
        <SourceNotice label="Guardrail breaches" snapshot={breaches} />
        <GuardrailBreachFeed breaches={breaches.data} />
      </section>

      <section>
        <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#6f7684]">
          War room — the day&apos;s incidents
        </h2>
        <SourceNotice label="War room" snapshot={warRoom} />
        <WarRoomList incidents={warRoom.data} viewerEmail={viewerEmail} />
      </section>
    </div>
  );
}
