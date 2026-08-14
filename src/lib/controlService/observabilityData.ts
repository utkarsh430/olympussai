import 'server-only';

/**
 * Server-only data source for the control-room live observability
 * dashboard (headway/EWT/CV metrics + reactive bunching incidents).
 * Mirrors src/lib/ops/fleetData.ts's contract: never throws, never
 * returns a shape that would leave the dashboard blank — fresh control-
 * service response -> last-known-good cached response (flagged stale) ->
 * an explicit "control service unavailable" state
 * (docs/CONTROL_SERVICE_INTEGRATION.md §2 fallback ladder).
 *
 * Detection-and-display only: this module never calls POST /v1/commands
 * and never constructs a dispatcherActionId — out of this ticket's scope
 * by design (AC: "No commands sent from this ticket's scope").
 */
import {
  ControlServiceConfigError,
  ControlServiceRequestError,
  fetchControlService,
} from './client';
import {
  headwayComputeResultSchema,
  incidentsResponseSchema,
  routeDirectionsResponseSchema,
  vehicleStatesResponseSchema,
  type BunchingIncident,
  type HeadwayComputeResult,
  type RouteDirectionMeta,
  type VehicleState,
} from '@/models/control';
import { TtlCache } from '@/lib/upsrtc/cache';

const SNAPSHOT_CACHE_TTL_MS = 10_000;
const snapshotCache = new TtlCache<ObservabilitySnapshot>(SNAPSHOT_CACHE_TTL_MS);

export interface ObservabilitySnapshot {
  /** 'live' = every call this cycle succeeded fresh. 'unavailable' = control service unreachable/misconfigured (positions/headway/incidents may still be a stale cached copy, or empty). */
  source: 'live' | 'unavailable';
  stale: boolean;
  error: string | null;
  /**
   * The control service's own `error.code` when it ANSWERED with a per-request
   * error, and null when the failure was transport-level (unreachable, timed
   * out, circuit open, misconfigured).
   *
   * Carried because `error` alone cannot tell those two apart, and a caller
   * that cannot tell them apart has to describe both as an outage. It is not
   * one: `no_active_policy` is a 404 the control service raises DELIBERATELY,
   * to say out loud that bunching detection is off for a corridor whose
   * timetable had no calibration answer (control-service/src/headway/
   * repository.ts#loadActiveRoutePolicy — "Detection is off, and saying so out
   * loud is the entire point"). Collapsing that into "the service did not
   * answer" throws away the one signal it went out of its way to send.
   *
   * A code, not a parsed message: the message is prose and will change.
   */
  errorCode: string | null;
  fetchedAt: string;
  routeDirections: RouteDirectionMeta[];
  selectedRouteDirectionId: string | null;
  positions: VehicleState[];
  headway: HeadwayComputeResult | null;
  incidents: BunchingIncident[];
}

function unavailableSnapshot(
  reason: string,
  now: number,
  code: string | null = null,
): ObservabilitySnapshot {
  const lastGood = snapshotCache.getLastGood('observability');
  if (lastGood) {
    return {
      ...lastGood.value,
      source: 'unavailable',
      stale: true,
      error: reason,
      errorCode: code,
      fetchedAt: new Date(now).toISOString(),
    };
  }
  return {
    source: 'unavailable',
    stale: true,
    error: reason,
    errorCode: code,
    fetchedAt: new Date(now).toISOString(),
    routeDirections: [],
    selectedRouteDirectionId: null,
    positions: [],
    headway: null,
    incidents: [],
  };
}

/**
 * Full snapshot for the observability dashboard: active route-directions
 * (for the picker), live vehicle positions, a freshly computed headway/
 * EWT/CV snapshot, and currently open bunching incidents — all scoped to
 * `routeDirectionId` when given, else the first active route-direction
 * control-service reports.
 *
 * Headway is READ (GET .../headway), never computed here.
 *
 * This used to POST .../headway/compute, on the reasoning that no
 * scheduler existed so the dashboard had to be the compute trigger. The
 * control service now runs that sweep on a fixed cadence, and reading is
 * not merely tidier — POSTing from here was actively wrong. Every compute
 * APPENDS a row to headway_states, which is the exact history the
 * reactive bunching rule reads ("k consecutive samples over threshold").
 * A dashboard on a poll therefore injected off-cadence samples into the
 * evidence for its own alerts: two open dashboards would have halved the
 * effective detection window, and a page refresh could manufacture an
 * incident. Reads read.
 */
/**
 * Which corridor a console opens on when the operator has not named one.
 *
 * ─── THE FIRST IMPRESSION THIS FIXES ─────────────────────────────────────
 *
 * This used to be `routeDirections[0]`. The control service returns the list
 * `order by route_id, direction_code`, so on the live network position zero is
 * corridor 1000 outbound — which has no planned gap set. Every corridor-scoped
 * tile therefore rendered `—`, the incident list rendered an explanation
 * instead of incidents, and the engine panel rendered "no control policy is
 * configured". Measured against the live control database: 198 of the 759
 * mapped corridors can report bunching, and the default landed on one of the
 * 561 that cannot. A new operator's first sight of the control room was a
 * screen of dashes under a paragraph explaining why.
 *
 * Every one of those messages was individually correct. The defect was the
 * DEFAULT, not the honesty.
 *
 * ─── WHY "FIRST THAT CAN DETECT" AND NOT "BUSIEST" ───────────────────────
 *
 * The obvious improvement is to open on the corridor with the most buses on
 * it. That is a better default and it is not available here: this call has the
 * corridor LIST and nothing else, and finding the busiest would mean a
 * vehicle-state read per corridor — 759 round trips on every page open — to
 * pick a starting view the operator changes in one click anyway. So the rule
 * is the cheapest one that removes the blank screen: the first corridor in the
 * service's own stable order that can actually report something.
 *
 * ─── WHAT IT DOES NOT DO ─────────────────────────────────────────────────
 *
 * Hide the corridors that cannot detect. They stay in the list, still marked
 * before selection, and if NONE of them can detect this falls back to the
 * first corridor rather than selecting nothing — a console with no corridor
 * chosen is a worse answer than one that opens on a corridor and says plainly
 * that it has nothing to report. `hasActivePolicy: undefined` is a control
 * service that predates the flag, which is unknown and not false, so it is
 * never preferred and never rejected.
 */
export function defaultRouteDirectionId(
  routeDirections: readonly RouteDirectionMeta[],
): string | null {
  const detecting = routeDirections.find((rd) => rd.hasActivePolicy === true);
  return (detecting ?? routeDirections[0])?.routeDirectionId ?? null;
}

export async function getObservabilitySnapshot(
  routeDirectionId?: string,
  now: number = Date.now(),
): Promise<ObservabilitySnapshot> {
  try {
    const routeDirectionsRaw = await fetchControlService('/v1/route-directions');
    const { routeDirections } = routeDirectionsResponseSchema.parse(routeDirectionsRaw);

    const selected =
      (routeDirectionId &&
        routeDirections.find((rd) => rd.routeDirectionId === routeDirectionId)?.routeDirectionId) ??
      defaultRouteDirectionId(routeDirections);

    if (!selected) {
      const snapshot: ObservabilitySnapshot = {
        source: 'live',
        stale: false,
        error: null,
        errorCode: null,
        fetchedAt: new Date(now).toISOString(),
        routeDirections,
        selectedRouteDirectionId: null,
        positions: [],
        headway: null,
        incidents: [],
      };
      snapshotCache.set('observability', snapshot, now);
      return snapshot;
    }

    let positionsRaw: unknown;
    let headwayRaw: unknown;
    let incidentsRaw: unknown;
    try {
      [positionsRaw, headwayRaw, incidentsRaw] = await Promise.all([
        fetchControlService('/v1/vehicle-states', { query: { routeDirectionId: selected } }),
        fetchControlService(`/v1/route-directions/${encodeURIComponent(selected)}/headway`),
        fetchControlService('/v1/incidents', { query: { routeDirectionId: selected } }),
      ]);
    } catch (cause) {
      // `no_active_policy` is the ONE failure here that is a fact about the
      // corridor rather than about the service, and the corridor list has
      // already been fetched successfully by this point. Rethrowing it into
      // the outer handler discarded that list, so the console lost its picker
      // and reported "no corridor selected" while simultaneously explaining
      // that THIS corridor has no policy - two contradictory statements about
      // a corridor it could no longer name. The ladder, cache and contract are
      // unchanged; this only stops known-good facts being thrown away with the
      // error that did not concern them.
      if (!(cause instanceof ControlServiceRequestError) || cause.code !== 'no_active_policy')
        throw cause;
      // Built explicitly rather than through `unavailableSnapshot`, which
      // falls back to the last good snapshot: that copy holds ANOTHER
      // corridor's positions and incidents, and carrying them here would
      // attribute them to this one. Empty is the honest answer - with no
      // active policy the detector never runs, so this corridor has no
      // incidents of its own to report.
      return {
        source: 'unavailable',
        stale: true,
        error: cause.message,
        errorCode: cause.code,
        fetchedAt: new Date(now).toISOString(),
        routeDirections,
        selectedRouteDirectionId: selected,
        positions: [],
        headway: null,
        incidents: [],
      };
    }

    const { vehicleStates: positions } = vehicleStatesResponseSchema.parse(positionsRaw);
    const headway = headwayComputeResultSchema.parse(headwayRaw);
    const { incidents } = incidentsResponseSchema.parse(incidentsRaw);

    const snapshot: ObservabilitySnapshot = {
      source: 'live',
      stale: false,
      error: null,
      errorCode: null,
      fetchedAt: new Date(now).toISOString(),
      routeDirections,
      selectedRouteDirectionId: selected,
      positions,
      headway,
      incidents,
    };
    snapshotCache.set('observability', snapshot, now);
    return snapshot;
  } catch (cause) {
    const message =
      cause instanceof ControlServiceConfigError
        ? cause.message
        : cause instanceof Error
          ? cause.message
          : 'Unknown control service error';
    // A ControlServiceRequestError means the service ANSWERED and the answer
    // was an error for this request. Every other cause — a config error, a
    // timeout, an open circuit, a socket failure — means it did not answer at
    // all, and leaves the code null. The ladder above is unchanged; this only
    // stops the two being indistinguishable to the caller.
    const code = cause instanceof ControlServiceRequestError ? cause.code : null;
    return unavailableSnapshot(message, now, code);
  }
}
