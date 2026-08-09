import 'server-only';

/**
 * Server-only data source for the dispatcher/depot "route operations
 * board" (this ticket's AC1: "departure order, headway countdown, bay/crew
 * conflicts, standby availability"). Mirrors observabilityData.ts's
 * contract (never throws, fresh -> stale-cache -> explicit-unavailable),
 * trimmed to what a dispatcher/depot view needs: live vehicle-states for
 * one route-direction (ordered along the route -- the closest real proxy
 * this service exposes for "departure order") and the headway pair metrics
 * that drive the headway countdown. Bay/crew assignment data does not
 * exist anywhere in this system yet (no bay/crew table in
 * control-service/db/migrations) -- see the RouteOperationsBoard component
 * for how that gap is surfaced rather than faked.
 */
import { ControlServiceConfigError, fetchControlService } from './client';
import {
  headwayComputeResultSchema,
  routeDirectionsResponseSchema,
  vehicleStatesResponseSchema,
  type HeadwayPairMetric,
  type RouteDirectionMeta,
  type VehicleState,
} from '@/models/control';
import { TtlCache } from '@/lib/upsrtc/cache';

const SNAPSHOT_CACHE_TTL_MS = 10_000;
const snapshotCache = new TtlCache<RouteOperationsBoardSnapshot>(SNAPSHOT_CACHE_TTL_MS);

export interface RouteOperationsBoardSnapshot {
  source: 'live' | 'unavailable';
  stale: boolean;
  error: string | null;
  fetchedAt: string;
  routeDirections: RouteDirectionMeta[];
  selectedRouteDirectionId: string | null;
  /** Vehicles on the selected route-direction, ordered furthest-along-route first — the closest real signal this service exposes to a "departure/running order". */
  vehicles: VehicleState[];
  headwayPairs: HeadwayPairMetric[];
}

function unavailableSnapshot(reason: string, now: number, cacheKey: string): RouteOperationsBoardSnapshot {
  const lastGood = snapshotCache.getLastGood(cacheKey);
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
    vehicles: [],
    headwayPairs: [],
  };
}

export async function getRouteOperationsBoardSnapshot(
  routeDirectionId?: string,
  now: number = Date.now(),
): Promise<RouteOperationsBoardSnapshot> {
  const cacheKey = `route-board:${routeDirectionId ?? '-'}`;
  try {
    const routeDirectionsRaw = await fetchControlService('/v1/route-directions');
    const { routeDirections } = routeDirectionsResponseSchema.parse(routeDirectionsRaw);

    const selected =
      (routeDirectionId && routeDirections.find((rd) => rd.routeDirectionId === routeDirectionId)?.routeDirectionId) ??
      routeDirections[0]?.routeDirectionId ??
      null;

    if (!selected) {
      const snapshot: RouteOperationsBoardSnapshot = {
        source: 'live',
        stale: false,
        error: null,
        fetchedAt: new Date(now).toISOString(),
        routeDirections,
        selectedRouteDirectionId: null,
        vehicles: [],
        headwayPairs: [],
      };
      snapshotCache.set(cacheKey, snapshot, now);
      return snapshot;
    }

    // Headway is READ (GET .../headway), never computed here — same rule as
    // getObservabilitySnapshot, and for the same reason. Every compute APPENDS
    // a row to headway_states, which is the exact history the reactive
    // bunching rule reads ("k consecutive samples over threshold"). A polling
    // dashboard that computed would be injecting off-cadence samples into the
    // evidence for its own alerts. The control service's scheduler owns that
    // sweep on a fixed cadence now. Reads read.
    const [vehiclesRaw, headwayRaw] = await Promise.all([
      fetchControlService('/v1/vehicle-states', { query: { routeDirectionId: selected } }),
      fetchControlService(`/v1/route-directions/${encodeURIComponent(selected)}/headway`),
    ]);

    const { vehicleStates } = vehicleStatesResponseSchema.parse(vehiclesRaw);
    const headway = headwayComputeResultSchema.parse(headwayRaw);

    const vehicles = [...vehicleStates].sort((a, b) => (b.distanceAlongRouteMeters ?? -1) - (a.distanceAlongRouteMeters ?? -1));

    const snapshot: RouteOperationsBoardSnapshot = {
      source: 'live',
      stale: false,
      error: null,
      fetchedAt: new Date(now).toISOString(),
      routeDirections,
      selectedRouteDirectionId: selected,
      vehicles,
      headwayPairs: headway.pairs,
    };
    snapshotCache.set(cacheKey, snapshot, now);
    return snapshot;
  } catch (cause) {
    const message =
      cause instanceof ControlServiceConfigError
        ? cause.message
        : cause instanceof Error
          ? cause.message
          : 'Unknown control service error';
    return unavailableSnapshot(message, now, cacheKey);
  }
}
