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
    corridors: corridorCoverageFrom(observability),
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
      noActivePolicy: noActivePolicyFrom(observability),
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
 * The control service's `no_active_policy`, promoted from an error to a fact.
 *
 * ─── WHY THIS IS NOT AN OUTAGE ───────────────────────────────────────────
 *
 * `GET /v1/route-directions/{id}/headway` answers 404 `no_active_policy` for a
 * corridor whose timetable produced no usable headway target
 * (control-service/src/headway/repository.ts#loadActiveRoutePolicy, which
 * excludes `calibration_source = 'none'` rows precisely so that this happens).
 * The control service is being deliberately loud there — its own comment says
 * "Detection is off, and saying so out loud is the entire point ... the failure
 * being fixed is that it used to be off silently, on two thirds of the
 * network."
 *
 * On this side that 404 rejected the `Promise.all` and the whole snapshot fell
 * to `source: 'unavailable'`, so the status band reported "the control service
 * did not answer" — an outage claim — about a service that had just answered
 * three times, twice with 200s. On a console whose entire premise is honest
 * readouts, inventing an outage is the worst available failure, and it
 * happened to be the DEFAULT view: with no corridor chosen the console selects
 * the first active route-direction, which on the live network has no policy.
 *
 * `no_active_policy` is therefore a real, benign, reportable state of a
 * corridor, and the strip words it as one. The distinction survives on the
 * structured `error.code`, never on the message prose.
 */
function noActivePolicyFrom(observability: { source: string; errorCode: string | null }): boolean {
  return observability.source === 'unavailable' && observability.errorCode === 'no_active_policy';
}

/**
 * How much of the network this console can actually see, counted from the
 * corridor list it was just handed.
 *
 * ─── WHY THERE IS NO DENOMINATOR HERE ────────────────────────────────────
 *
 * The obvious "N of M corridors" needs an M, and the control database does not
 * have one. `route_directions` holds what the seeder has harvested so far, not
 * what UPSRTC runs: at the time of writing every one of its 47 real
 * route-directions also had geometry, so a ratio drawn from that table would
 * have printed a confident "47 of 47" — a claim of total coverage, on a
 * network the same repository documents as roughly 650 route-directions
 * (docs/HANDOVER.md). That is worse than the unlabelled number it
 * replaced, and it is worse precisely because it looks measured.
 *
 * The live vehicle feed was the other candidate, since it is the one runtime
 * source that sees the whole state, and it was rejected on evidence rather
 * than on taste. Its route ids are drawn from the same UPSRTC namespace as
 * `routes.id`, so a cross-source ratio looks reasonable — but measured against
 * a real feed snapshot, none of the 45 seeded route ids appeared among the 934
 * the feed was reporting at that moment, and only 1,449 of its 9,189 vehicles
 * carried a route at all (zero of them overnight, per the same doc). A ratio
 * built on that would have rendered "0 of 934", inventing a second, louder
 * falsehood in the name of fixing the first.
 *
 * So the honest report is the two numbers that ARE measured — corridors with
 * geometry, and the subset of those that can detect — plus a caption saying in
 * words that the network total is not known here. See `coverageNoticeFor` in
 * src/lib/ops/controlRoomOverviewModel.ts.
 */
function corridorCoverageFrom(observability: {
  source: string;
  errorCode: string | null;
  routeDirections: { hasActivePolicy?: boolean }[];
}): ControlRoomOverview['corridors'] {
  // The corridor list is trustworthy when THIS cycle fetched it. A
  // `no_active_policy` snapshot is included deliberately: that path fetches
  // the list successfully and only then fails the per-corridor read, and it
  // keeps the fresh list rather than a cached one. Anything else is a stale
  // copy or an empty fallback, and counting either would report coverage the
  // console did not observe.
  const ok = observability.source === 'live' || noActivePolicyFrom(observability);
  const mapped = observability.routeDirections.length;

  // `undefined` is a control service that predates the flag, NOT a corridor
  // without a policy. Counting it as false would report detection coverage of
  // zero against a network that may be fully policied — so it collapses to
  // "not reported" and the tile says so instead of printing a number.
  const reportsPolicy = observability.routeDirections.some((rd) => rd.hasActivePolicy !== undefined);

  return {
    ok,
    mapped,
    detecting: mapped === 0 ? 0 : reportsPolicy ? observability.routeDirections.filter((rd) => rd.hasActivePolicy === true).length : null,
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
