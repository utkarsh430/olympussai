import { requireOpsRolePage } from '@/lib/auth/rbac/pageGuard';
import { OpsShell } from '@/components/ops/OpsShell';
import { OpsAlert, OpsStat, OpsStatGroup, OpsStatStrip } from '@/components/ops/ui';
import { SimulatorConsole } from '@/components/ops/control-room/simulator/SimulatorConsole';
import { readLatestFleetTrial } from '@/lib/controlService/fleetTrial';
import type { FleetTrialReport } from '@/models/fleetTrial';

export const dynamic = 'force-dynamic';

/**
 * The simulator: does the controller actually help?
 *
 * ─── WHY THIS PAGE EXISTS ────────────────────────────────────────────────
 *
 * Everything else in the control room is about a corridor that is running now.
 * This is the only surface that asks whether the control strategy is the right
 * one, and the only way to answer that honestly is to run the deployed laws
 * against a fleet large enough for the answer to mean something and show, beside
 * every result, what the same day would have done untouched.
 *
 * Nested under /ops/control-room so it inherits that segment's
 * `requireOpsRolePage('control_room', ...)` guard from layout.tsx, like the
 * alerts and observability pages beside it.
 *
 * ─── THE FIRST READ IS TAKEN ON THE SERVER ───────────────────────────────
 *
 * The last trial the service ran is fetched here, so an operator who has been
 * sent a link arrives at a page with results on it rather than a button. A
 * missing report is a REAL state and not an error - a freshly restarted service
 * has none - so it renders as an invitation to run one, not as a failure.
 */
export default async function SimulatorPage() {
  // The session comes from the guard itself rather than a second, independent
  // resolution of it - see the sibling alerts page for why that distinction
  // turned into an HTTP 500 when the two disagreed.
  const session = await requireOpsRolePage('control_room', '/ops/control-room/simulator');

  let report: FleetTrialReport | null = null;
  let readError: string | null = null;
  try {
    report = await readLatestFleetTrial();
  } catch (error) {
    // The console still mounts and can run a trial itself: a service that
    // cannot be READ may still be reachable for a POST, and an operator being
    // told "unavailable" when they could have simply run one is worse than a
    // banner they can ignore.
    readError = error instanceof Error ? error.message : 'unknown error';
  }

  return (
    <OpsShell
      title="Simulator"
      email={session.email}
      role="control_room"
      variant="wide"
      subtitle="A thousand buses, ten ways a corridor comes apart, and what would have happened without us"
      statusStrip={report ? <TrialStrip report={report} /> : undefined}
    >
      {readError ? (
        <OpsAlert tone="warning" title="The last trial could not be read">
          {readError}. You can still run a new one.
        </OpsAlert>
      ) : null}
      <SimulatorConsole initialReport={report} />
    </OpsShell>
  );
}

/**
 * The band an operator reads from across a room.
 *
 * Two groups, because these are readings about two different populations and
 * an unlabelled strip that mixed them would overstate what a single number
 * covers. The passenger-time figure leads: it is the only one on the page that
 * can say the controller made things worse while every other number improved.
 */
function TrialStrip({ report }: { report: FleetTrialReport }) {
  const totals = report.phases.reduce(
    (acc, phase) => ({
      detected: acc.detected + phase.controlled.incidents.detected,
      resolved: acc.resolved + phase.controlled.incidents.resolved,
      baselineDetected: acc.baselineDetected + phase.uncontrolled.incidents.detected,
      passengerSaved: acc.passengerSaved + phase.contrast.passengerSecondsSaved,
      passengerTotal: acc.passengerTotal + phase.uncontrolled.passengers.totalPassengerSeconds,
      waitSaved: acc.waitSaved + phase.contrast.waitSecondsSaved,
      // The NET in-vehicle change, not the hold bill: holding is the only
      // in-vehicle term control makes worse, and dwell and running time move
      // the other way. See `ArmContrast.inVehicleSecondsSaved`.
      inVehicleSaved: acc.inVehicleSaved + phase.contrast.inVehicleSecondsSaved,
    }),
    {
      detected: 0,
      resolved: 0,
      baselineDetected: 0,
      passengerSaved: 0,
      passengerTotal: 0,
      waitSaved: 0,
      inVehicleSaved: 0,
    },
  );
  const netPercent = totals.passengerTotal > 0 ? (totals.passengerSaved / totals.passengerTotal) * 100 : null;

  return (
    <OpsStatStrip>
      <OpsStatGroup label="The trial">
        <OpsStat label="Buses simulated" value={report.vehiclesSimulated.toLocaleString()} />
        <OpsStat
          label="Scenarios"
          value={String(report.phases[0]?.scenarios.length ?? 0)}
          hint="× 2 phases"
        />
        <OpsStat label="Ran in" value={`${(report.durationMs / 1000).toFixed(1)}`} unit="s" />
      </OpsStatGroup>
      <OpsStatGroup label="Incidents (deployed detector)">
        <OpsStat label="Detected" value={totals.detected.toLocaleString()} />
        <OpsStat
          label="Resolved"
          value={totals.resolved.toLocaleString()}
          hint={`${totals.baselineDetected.toLocaleString()} would have opened untouched`}
          tone="accent"
        />
      </OpsStatGroup>
      <OpsStatGroup label="Effect on passengers">
        <OpsStat
          label="Waiting removed"
          value={`${Math.round(totals.waitSaved / 3600).toLocaleString()}`}
          unit="h"
        />
        <OpsStat
          label={totals.inVehicleSaved >= 0 ? 'Time aboard given back' : 'Time aboard added'}
          value={`${Math.round(Math.abs(totals.inVehicleSaved) / 3600).toLocaleString()}`}
          unit="h"
        />
        <OpsStat
          label="Net passenger time"
          value={netPercent === null ? '—' : `${netPercent > 0 ? '+' : ''}${netPercent.toFixed(1)}%`}
          hint={netPercent !== null && netPercent < 0 ? 'the controller cost more than it saved' : 'saved overall'}
          tone={netPercent !== null && netPercent < 0 ? 'critical' : 'accent'}
        />
      </OpsStatGroup>
    </OpsStatStrip>
  );
}
