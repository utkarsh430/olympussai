import type { DailyKpiSnapshot, GuardrailBreach, WarRoomIncident } from '@/models/control';
import type { PilotSnapshot } from '@/lib/controlService/pilotData';
import {
  OpsAlert,
  OpsBadge,
  OpsEmptyState,
  OpsPanel,
  OpsSection,
  OpsStack,
  OpsTableFrame,
  opsTableClass,
  opsTdClass,
  opsTdNumericClass,
  opsThClass,
  opsTheadRowClass,
  opsTrClass,
} from '@/components/ops/ui';
import {
  METRIC,
  SAFETY_BLOCK_HINT,
  SAFETY_BLOCK_LABEL,
  complianceLabel,
  directionLabel,
  incidentSeverityLabel,
  incidentStatusLabel,
  safetyBlockSeverityLabel,
  safetyBlockTypeLabel,
} from '@/lib/ops/vocabulary';
import { IncidentReviewForm } from './IncidentReviewForm';

/**
 * How the rollout is going, day over day.
 *
 * ─── WHY IT IS STILL ITS OWN PAGE ────────────────────────────────────────
 *
 * The console folds observability and the assistant in because their content
 * IS the console's content. This is not: it answers a different question on a
 * different clock, and its incident review is retrospective paperwork rather
 * than something done while watching buses move. Only its live-relevant
 * numbers come forward into the console band.
 *
 * ─── WHAT THIS PASS CHANGED ──────────────────────────────────────────────
 *
 * Nothing structural. This page had barely been touched since it was written
 * and was the densest remaining pocket of raw enum values in the control room:
 * `EWT`, `CV`, `Guardrail breaches`, `{b.breachType}` printed verbatim as
 * `rollout_stage_violation`, `{b.severity}` as `critical`, `status: open`,
 * `compliance: full`, and an ISO date as the reporting day. All of it now goes
 * through src/lib/ops/vocabulary.ts.
 *
 * "Guardrail breach" is the one worth naming. These rows are actions the
 * system REFUSED; "breach" reads as something that got through, and had an
 * operator hunting for damage that does not exist.
 */

function SourceNotice({ label, snapshot }: { label: string; snapshot: PilotSnapshot<unknown> }) {
  if (snapshot.source === 'live') return null;
  return (
    <OpsAlert tone="warning" className="mb-3">
      {label}: these are the last figures taken, not current ones — the live feed did not answer
      {snapshot.error ? ` (${snapshot.error})` : ''}.
    </OpsAlert>
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

/** A reporting day an operator reads the way they say it, not `2026-08-14`. */
function formatReportingDay(iso: string): string {
  const at = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(at)) return iso;
  return new Date(at).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function KpiTable({ snapshots }: { snapshots: DailyKpiSnapshot[] }) {
  if (snapshots.length === 0) {
    return <OpsEmptyState>No corridors to report on yet.</OpsEmptyState>;
  }
  return (
    <OpsTableFrame>
      <table className={`${opsTableClass} min-w-[720px]`}>
        <thead>
          <tr className={opsTheadRowClass}>
            <th scope="col" className={opsThClass}>
              Corridor
            </th>
            <th scope="col" className={opsThClass}>
              {METRIC.excessWait.label}
            </th>
            <th scope="col" className={opsThClass}>
              {METRIC.cv.label}
            </th>
            <th scope="col" className={opsThClass}>
              Sorted out
            </th>
            <th scope="col" className={opsThClass}>
              {SAFETY_BLOCK_LABEL}
            </th>
            <th scope="col" className={opsThClass}>
              Drivers who followed it
            </th>
          </tr>
        </thead>
        <tbody>
          {snapshots.map((s) => (
            <tr key={s.routeDirectionId} className={opsTrClass}>
              <td className={opsTdClass}>
                {s.publicName}{' '}
                <span className="text-muted-foreground">({directionLabel(s.directionCode)})</span>
              </td>
              <td className={opsTdNumericClass}>{formatSeconds(s.ewtSeconds)}</td>
              <td className={opsTdNumericClass}>{s.cv === null ? '—' : s.cv.toFixed(2)}</td>
              <td className={opsTdNumericClass}>
                {formatPct(s.recoveryRate)}{' '}
                <span className="text-subtle">
                  ({s.recoveredIncidentCount} of {s.incidentCount})
                </span>
              </td>
              <td className={opsTdNumericClass}>
                <span className={s.guardrailBreachCount > 0 ? 'text-warning' : undefined}>
                  {s.guardrailBreachCount}
                </span>
              </td>
              <td className={opsTdNumericClass}>
                {formatPct(s.compliancePct)}{' '}
                <span className="text-subtle">
                  ({s.complianceSampleCount} {s.complianceSampleCount === 1 ? 'answer' : 'answers'})
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </OpsTableFrame>
  );
}

function SafetyBlockFeed({ breaches }: { breaches: GuardrailBreach[] }) {
  if (breaches.length === 0) {
    return <OpsEmptyState>No action has been blocked by a safety rule.</OpsEmptyState>;
  }
  return (
    <ul className="space-y-2">
      {breaches.slice(0, 20).map((b) => (
        <li key={b.id} className="ops-well px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <OpsBadge variant={b.severity === 'critical' ? 'critical' : 'neutral'}>
              {safetyBlockSeverityLabel(b.severity)}
            </OpsBadge>
            <span className="text-foreground">{safetyBlockTypeLabel(b.breachType)}</span>
            <span className="ml-auto text-subtle">{new Date(b.detectedAt).toLocaleString()}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function IncidentReviewList({
  incidents,
  viewerEmail,
}: {
  incidents: WarRoomIncident[];
  viewerEmail: string;
}) {
  if (incidents.length === 0) {
    return <OpsEmptyState>Nothing was recorded for this day.</OpsEmptyState>;
  }
  return (
    <ul className="space-y-4">
      {incidents.map((incident) => (
        <li key={incident.incidentId}>
          <OpsPanel>
            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="font-medium text-foreground">
                {incidentSeverityLabel(incident.severity)}
              </span>
              <span className="text-subtle">
                started {new Date(incident.startedAt).toLocaleString()}
              </span>
              <span className="text-subtle">{incidentStatusLabel(incident.status)}</span>
              {incident.measuredCompliance && (
                <span className="text-success">
                  Driver: {complianceLabel(incident.measuredCompliance).toLowerCase()}
                </span>
              )}
              {incident.measuredRecoverySeconds !== null && (
                <span className="text-success">
                  sorted out in {formatSeconds(incident.measuredRecoverySeconds)}
                </span>
              )}
            </div>
            <IncidentReviewForm incident={incident} viewerEmail={viewerEmail} />
          </OpsPanel>
        </li>
      ))}
    </ul>
  );
}

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
    <OpsStack>
      <p className="text-xs text-subtle">
        Reporting day: <span className="text-foreground">{formatReportingDay(shownDate)}</span>{' '}
        (UTC). What each corridor is allowed to do is set from{' '}
        <a href="/ops/admin/rollout-stages" className="text-primary hover:underline">
          Admin
        </a>
        .
      </p>

      <OpsSection
        title="Today's figures"
        description="One row per corridor: extra passenger wait, how even the gaps were, how many problems were sorted out, how often a safety rule blocked an action, and how often drivers followed the instruction."
      >
        <SourceNotice label="Today's figures" snapshot={kpi} />
        <KpiTable snapshots={kpi.data} />
      </OpsSection>

      <OpsSection title={`${SAFETY_BLOCK_LABEL} (live)`} description={`The ${SAFETY_BLOCK_HINT}.`}>
        <SourceNotice label={SAFETY_BLOCK_LABEL} snapshot={breaches} />
        <SafetyBlockFeed breaches={breaches.data} />
      </OpsSection>

      <OpsSection
        title="Reviewing today's incidents"
        description="Record what was done and how it turned out, for each one."
      >
        <SourceNotice label="Incident review" snapshot={warRoom} />
        <IncidentReviewList incidents={warRoom.data} viewerEmail={viewerEmail} />
      </OpsSection>
    </OpsStack>
  );
}
