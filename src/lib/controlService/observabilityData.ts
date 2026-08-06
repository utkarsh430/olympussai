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
  fetchedAt: string;
  routeDirections: RouteDirectionMeta[];
  selectedRouteDirectionId: string | null;
  positions: VehicleState[];
  headway: HeadwayComputeResult | null;
  incidents: BunchingIncident[];
}

function unavailableSnapshot(reason: string, now: number): ObservabilitySnapshot {
  const lastGood = snapshotCache.getLastGood('observability');
  if (lastGood) {
    return { ...lastGood.value, source: 'unavailable', stale: true, error: reason, fetchedAt: new Date(now).toISOString() };
  }
  return {
    source: 'unavailable',
    stale: true,
    error: reason,
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
 * The headway compute call (POST .../headway/compute) is what actually
 * produces the sample this ticket's reactive bunching rule looks back
 * over — there is no separate ingestion-triggered scheduler yet (see the
 * Crewban-5 handoff note on this ticket), so each dashboard load/refresh
 * is itself the compute trigger. This is intentionally idempotent-safe:
 * every call appends one more real sample from current vehicle_states,
 * never fabricates one.
 */
export async function getObservabilitySnapshot(
  routeDirectionId?: string,
  now: number = Date.now(),
): Promise<ObservabilitySnapshot> {
  try {
    const routeDirectionsRaw = await fetchControlService('/v1/route-directions');
    const { routeDirections } = routeDirectionsResponseSchema.parse(routeDirectionsRaw);

    const selected =
      (routeDirectionId && routeDirections.find((rd) => rd.routeDirectionId === routeDirectionId)?.routeDirectionId) ??
      routeDirections[0]?.routeDirectionId ??
      null;

    if (!selected) {
      const snapshot: ObservabilitySnapshot = {
        source: 'live',
        stale: false,
        error: null,
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

    const [positionsRaw, headwayRaw, incidentsRaw] = await Promise.all([
      fetchControlService('/v1/vehicle-states', { query: { routeDirectionId: selected } }),
      fetchControlService(`/v1/route-directions/${encodeURIComponent(selected)}/headway/compute`, { method: 'POST' }),
      fetchControlService('/v1/incidents', { query: { routeDirectionId: selected } }),
    ]);

    const { vehicleStates: positions } = vehicleStatesResponseSchema.parse(positionsRaw);
    const headway = headwayComputeResultSchema.parse(headwayRaw);
    const { incidents } = incidentsResponseSchema.parse(incidentsRaw);

    const snapshot: ObservabilitySnapshot = {
      source: 'live',
      stale: false,
      error: null,
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
    return unavailableSnapshot(message, now);
  }
}
