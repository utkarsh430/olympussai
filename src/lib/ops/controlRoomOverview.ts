import 'server-only';

/**
 * The control-room console's status band, composed from the sources that
 * already exist.
 *
 * It adds no new upstream: the fleet snapshot, the observability snapshot, the
 * daily KPI roll-up, the guardrail-breach list and this app's kill-switch table
 * are all read exactly as their own dashboards read them. What this module
 * contributes is provenance bookkeeping — for each of those five it records
 * whether the source actually answered, so
 * src/lib/ops/controlRoomOverviewModel.ts can refuse to print a number the
 * console did not observe.
 *
 * WHY THE `ok` FLAGS ARE DERIVED HERE AND NOT IN THE COMPONENT. Every one of
 * these readers is built to never throw: on failure they return an empty array
 * and a `source: 'unavailable'` flag, so the dashboard renders instead of
 * exploding. That is right, and it is also exactly what makes an outage look
 * like a calm zero two layers up. The flag has to be carried forward with the
 * data, at the point where it is still known, or it is lost.
 *
 * SCOPE. Statewide, always. The control room is not depot-scoped
 * (src/lib/ops/depotAccess.ts resolves `control_room` to OPS_FLEET_SCOPE_ALL),
 * and the route that calls this refuses every other role. It accepts no depot
 * parameter of any kind, so it cannot be the hole in the depot boundary that
 * db/migrations/20260812150000__ops_depot_ownership.sql closed.
 */
import { getOpsFleetSnapshot } from './fleetData';
import { OPS_FLEET_SCOPE_ALL } from './depotScope';
import { getObservabilitySnapshot } from '@/lib/controlService/observabilityData';
import { getDailyKpiSnapshots, getGuardrailBreaches } from '@/lib/controlService/pilotData';
import { getOpsRepo } from '@/lib/auth/rbac/repo';
import type { ControlRoomOverview } from './controlRoomOverviewModel';

/**
 * One coherent read of everything the status band shows.
 *
 * The five sources are fetched CONCURRENTLY and stamped with a single
 * `fetchedAt`. On a console where an operator correlates a bunching incident on
 * the map with the headway number above it, five sequential reads would mean
 * five different moments presented as one instant — and the numbers would
 * disagree in a way that looks like a bug in the data rather than in the
 * fetching.
 *
 * `routeDirectionId` selects the corridor the headway, incident, KPI and
 * guardrail readings describe. It is not an authorization parameter: the fleet
 * half is statewide regardless, and control_room may see all of it.
 */
export async function getControlRoomOverview(
  routeDirectionId?: string,
  now: number = Date.now(),
): Promise<ControlRoomOverview> {
  const observabilityPromise = getObservabilitySnapshot(routeDirectionId, now);

  // The corridor the rest of the reads are keyed on can only be known after
  // the control service has listed its active corridors, because an absent or
  // unknown `routeDirectionId` resolves to the first active one. Awaiting it
  // first costs one round trip and is what keeps every reading below on the
  // SAME corridor as the incidents and headway above them.
  const observability = await observabilityPromise;
  const corridor = observability.selectedRouteDirectionId ?? undefined;

  const [fleet, kpi, guardrails, killSwitches] = await Promise.all([
    getOpsFleetSnapshot(OPS_FLEET_SCOPE_ALL),
    getDailyKpiSnapshots(undefined, corridor, now),
    getGuardrailBreaches(corridor, now),
    readKillSwitches(),
  ]);

  const observabilityOk = observability.source === 'live' && !observability.stale;

  return {
    fetchedAt: new Date(now).toISOString(),
    routeDirections: observability.routeDirections,
    selectedRouteDirectionId: observability.selectedRouteDirectionId,
    fleet: {
      reporting: fleet.buses.length,
      source: fleet.source,
      stale: fleet.stale,
      error: fleet.error,
    },
    observability: {
      ok: observabilityOk,
      stale: observability.stale,
      error: observability.error,
    },
    headway: observability.headway?.aggregate ?? null,
    incidents: observability.incidents,
    dailyKpi: {
      ok: kpi.source === 'live' && !kpi.stale,
      // The roll-up is per corridor; the console shows the selected one or
      // nothing. Picking "the first row" when the corridor has no row would
      // attribute another corridor's recovery rate to this one.
      row: corridor ? (kpi.data.find((row) => row.routeDirectionId === corridor) ?? null) : null,
    },
    guardrails: {
      ok: guardrails.source === 'live' && !guardrails.stale,
      total: guardrails.data.length,
      critical: guardrails.data.filter((breach) => breach.severity === 'critical').length,
    },
    killSwitches,
  };
}

/**
 * Kill switches, with an explicit unreadable state.
 *
 * Every other read here degrades to `ok: false` rather than throwing, and this
 * one has to match — but the consequence is sharper. An empty list means "no
 * commands are halted", which is a claim about whether the console's controls
 * will work. Returning `{ ok: false, active: [] }` on a database failure lets
 * the strip say the state is UNKNOWN instead of quietly promising the network
 * is open.
 */
async function readKillSwitches(): Promise<ControlRoomOverview['killSwitches']> {
  try {
    return { ok: true, active: await getOpsRepo().listKillSwitches(true) };
  } catch {
    return { ok: false, active: [] };
  }
}
