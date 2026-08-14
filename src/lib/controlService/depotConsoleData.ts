import 'server-only';

/**
 * The depot console's own control-service read.
 *
 * ─── WHAT IT REPLACED, AND WHY ───────────────────────────────────────────
 *
 * `getRouteOperationsBoardSnapshot` serves the dispatcher, whose job is
 * statewide: it takes the whole 759-entry corridor list, picks
 * `routeDirections[0]` when nothing is selected, and loads that corridor's
 * vehicle states. On a depot that is wrong in three separate ways. The default
 * corridor is arbitrary and almost never one this depot runs, so the board
 * opens empty. The picker offers 759 roads to an operator who runs a handful.
 * And it asks for headway on corridors that carry no measured target headway,
 * which answers 404 `no_active_policy` — a real answer that the board then had
 * nowhere to say, so it rendered as a blank table.
 *
 * ─── THE ONE EXTRA CALL THAT FIXES ALL THREE ─────────────────────────────
 *
 * `GET /v1/vehicle-states` with NO `routeDirectionId` returns every vehicle
 * state the control service holds, each carrying its corridor. Intersected
 * against this depot's own scoped fleet it yields, for one call, exactly the
 * corridors this depot is running and how many buses it has on each. The
 * alternative the depot page's comment rightly rejected — a fetch per corridor
 * to find out which ones the depot touches — would be 759 calls per render.
 *
 * So this module makes at most three calls: the corridor list, the whole
 * vehicle-state list, and — only when the selected corridor can actually
 * detect — that corridor's headway. A corridor known not to have an active
 * policy is NOT asked for headway at all; the 404 is predictable from the flag
 * the list already carried, and provoking it would spend a request to learn
 * something already known and would log a service error for a healthy state.
 *
 * ─── THE BOUNDARY ────────────────────────────────────────────────────────
 *
 * Every vehicle list that leaves this module has been through
 * `filterVehicleStatesToScope` against the caller's own scoped fleet. The
 * unfiltered `/v1/vehicle-states` response exists inside this function and is
 * never returned, never serialised, and never counted into anything the
 * operator sees. `scopedFleet` is REQUIRED and has no default, for the same
 * reason `getOpsMapSnapshot`'s scope is: an omitted scope must never be able
 * to mean "statewide".
 *
 * Never throws — same fresh -> stale-cache -> explicitly-unavailable ladder as
 * routeBoardData.ts and mapData.ts, because an ops dashboard has to render
 * something.
 */
import { ControlServiceConfigError, fetchControlService } from './client';
import {
  headwayComputeResultSchema,
  routeDirectionsResponseSchema,
  vehicleStatesResponseSchema,
  type HeadwayPairMetric,
  type VehicleState,
} from '@/models/control';
import { TtlCache } from '@/lib/upsrtc/cache';
import type { CanonicalLiveBus } from '@/models/canonical';
import {
  deriveDepotCorridors,
  depotDetectionCoverage,
  selectDepotCorridor,
  corridorDetection,
  type DepotCorridor,
  type DepotDetectionCoverage,
} from '@/lib/ops/depotCorridors';
import { filterVehicleStatesToScope, type OpsFleetScope } from '@/lib/ops/depotScope';

/**
 * The unfiltered vehicle-state list is cached across callers, and that is safe
 * precisely because it is never returned: it is raw upstream input that every
 * caller narrows against its OWN fleet before use. Caching a SCOPED result
 * across callers would be the bug this comment exists to forbid — 143 depot
 * operators share this process.
 *
 * Ten seconds matches routeBoardData's snapshot TTL, and the list is ~7,750
 * rows: without it, every depot render would pull the whole thing.
 */
const FLEET_STATE_CACHE_TTL_MS = 10_000;
const fleetStateCache = new TtlCache<VehicleState[]>(FLEET_STATE_CACHE_TTL_MS);
const FLEET_STATE_CACHE_KEY = 'control-service:all-vehicle-states';

const CORRIDOR_CACHE_TTL_MS = 60_000;
const corridorCache = new TtlCache<RouteDirectionList>(CORRIDOR_CACHE_TTL_MS);
const CORRIDOR_CACHE_KEY = 'control-service:route-directions';

type RouteDirectionList = Awaited<ReturnType<typeof parseRouteDirections>>;

async function parseRouteDirections(raw: unknown) {
  return routeDirectionsResponseSchema.parse(raw).routeDirections;
}

export interface DepotConsoleSnapshot {
  source: 'live' | 'unavailable';
  /** True when any reading here came from a last-known-good cache after a failed refresh. */
  stale: boolean;
  /** Non-null whenever the control service could not be read; the readings are then the last good ones, or empty. */
  error: string | null;
  fetchedAt: string;

  /** Corridors this depot's vehicles are on right now, busiest first. Measured, never configured. */
  corridors: DepotCorridor[];
  coverage: DepotDetectionCoverage;
  /**
   * How many corridors the control service has mapped in total. The honest
   * denominator: this depot's corridor list is a slice of a route network only
   * partly surveyed, and a console that showed only the slice would imply the
   * slice was the whole.
   */
  mappedCorridorCount: number;

  selectedCorridor: DepotCorridor | null;
  /**
   * This depot's vehicles on the selected corridor, furthest along the route
   * first — the closest real signal the control service exposes to a running
   * order. Already scoped.
   */
  vehicles: VehicleState[];
  /**
   * Headway pairs on the selected corridor, or empty when the corridor cannot
   * detect. `headwayRead` says which of the two it is, so an empty table is
   * never ambiguous.
   */
  headwayPairs: HeadwayPairMetric[];
  /**
   * Whether headway was actually asked for and answered. False on an
   * observation-only corridor (not asked, by design) and on a failed read.
   */
  headwayRead: boolean;
  /**
   * Pairs whose members are not all this depot's. Reported as a count only —
   * the pairs themselves are narrowed away, because a leader from another
   * depot is another depot's registration.
   */
  crossDepotPairCount: number;
}

function emptySnapshot(): Omit<DepotConsoleSnapshot, 'source' | 'stale' | 'error' | 'fetchedAt'> {
  return {
    corridors: [],
    coverage: { running: 0, detecting: 0, observationOnly: 0, unknown: 0 },
    mappedCorridorCount: 0,
    selectedCorridor: null,
    vehicles: [],
    headwayPairs: [],
    headwayRead: false,
    crossDepotPairCount: 0,
  };
}

/**
 * Everything the depot console reads from the control service, for one depot.
 *
 * `scopedFleet` is this depot's own live-feed vehicles — the only thing in
 * either datastore that knows which depot a vehicle belongs to. The caller has
 * already resolved it from the operator's own `ops_users` row.
 */
export async function getDepotConsoleSnapshot({
  scope,
  scopedFleet,
  requestedRouteDirectionId,
  now = Date.now(),
}: {
  scope: OpsFleetScope;
  scopedFleet: readonly Pick<CanonicalLiveBus, 'id'>[];
  requestedRouteDirectionId?: string;
  now?: number;
}): Promise<DepotConsoleSnapshot> {
  const [corridorRead, stateRead] = await Promise.all([
    readRouteDirections(now),
    readAllVehicleStates(now),
  ]);

  // Explicitly unavailable is the bottom rung, and it is reached only when a
  // read failed AND no last-known-good exists. A stale list is still a real
  // list that was really observed, so it is shown and labelled rather than
  // withheld — withholding it would replace old vehicles with no vehicles,
  // which reads as a depot with nothing running.
  if (corridorRead.value === null || stateRead.value === null) {
    return {
      source: 'unavailable',
      stale: true,
      error: corridorRead.error ?? stateRead.error ?? 'The control service could not be read.',
      fetchedAt: new Date(now).toISOString(),
      ...emptySnapshot(),
    };
  }

  const routeDirections = corridorRead.value;
  const allVehicleStates = stateRead.value;
  const readStale = corridorRead.stale || stateRead.stale;
  const readError = corridorRead.error ?? stateRead.error;

  // THE BOUNDARY. Everything downstream is derived from this narrowed list;
  // `allVehicleStates` is not referenced again.
  const scopedStates = filterVehicleStatesToScope(allVehicleStates, scope, scopedFleet);

  const corridors = deriveDepotCorridors(routeDirections, scopedStates);
  const coverage = depotDetectionCoverage(corridors);
  const selectedCorridor = selectDepotCorridor(corridors, requestedRouteDirectionId);

  const vehicles = selectedCorridor
    ? scopedStates
        .filter((state) => state.routeDirectionId === selectedCorridor.routeDirectionId)
        .sort((a, b) => (b.distanceAlongRouteMeters ?? -1) - (a.distanceAlongRouteMeters ?? -1))
    : [];

  let headwayPairs: HeadwayPairMetric[] = [];
  let headwayRead = false;
  let crossDepotPairCount = 0;
  let headwayError: string | null = null;

  // Asked for ONLY when the corridor's own policy flag says a reading exists.
  // `unknown` (an older control service that does not report the flag) is
  // asked, because refusing to ask would turn "we do not know" into "there is
  // nothing" — the exact substitution this console exists to avoid.
  if (selectedCorridor !== null && corridorDetection(selectedCorridor) !== 'observation-only') {
    try {
      const raw = await fetchControlService(
        `/v1/route-directions/${encodeURIComponent(selectedCorridor.routeDirectionId)}/headway`,
      );
      const parsed = headwayComputeResultSchema.parse(raw);
      headwayRead = true;

      // A headway pair names a leader AND a follower, and on a shared corridor
      // the leader is routinely another depot's bus. Keeping a pair because its
      // follower is ours would print that registration on this operator's
      // screen — the same leak narrowIncidentsToScope closes for incidents. The
      // pairs that are wholly ours are kept; the rest are counted, so the
      // operator learns their bus is in a pair without learning whose bus it is
      // paired with.
      const visible = new Set(scopedFleet.map((bus) => bus.id));
      for (const pair of parsed.pairs) {
        if (visible.has(pair.leaderVehicleId) && visible.has(pair.followerVehicleId)) {
          headwayPairs.push(pair);
        } else if (visible.has(pair.leaderVehicleId) || visible.has(pair.followerVehicleId)) {
          crossDepotPairCount += 1;
        }
      }
    } catch (cause) {
      headwayError = describeError(cause);
      headwayPairs = [];
      headwayRead = false;
    }
  }

  return {
    // Matches routeBoardData/observabilityData: a snapshot built from a
    // last-known-good cache after a failed refresh is reported as
    // 'unavailable' + stale, not as 'live'. The readings in it are real, and
    // the operator is told they are old.
    source: readStale ? 'unavailable' : 'live',
    stale: readStale,
    error: readError ?? headwayError,
    fetchedAt: new Date(now).toISOString(),
    corridors,
    coverage,
    mappedCorridorCount: routeDirections.length,
    selectedCorridor,
    vehicles,
    headwayPairs,
    headwayRead,
    crossDepotPairCount,
  };
}

/** One rung of the ladder: fresh, or last-known-good and stale, or nothing at all. */
interface CachedRead<T> {
  value: T | null;
  stale: boolean;
  error: string | null;
}

async function readThrough<T>(
  cache: TtlCache<T>,
  key: string,
  now: number,
  load: () => Promise<T>,
): Promise<CachedRead<T>> {
  const fresh = cache.get(key, now);
  if (fresh !== null) return { value: fresh, stale: false, error: null };
  try {
    const loaded = await load();
    cache.set(key, loaded, now);
    return { value: loaded, stale: false, error: null };
  } catch (cause) {
    const lastGood = cache.getLastGood(key);
    return { value: lastGood?.value ?? null, stale: true, error: describeError(cause) };
  }
}

function readRouteDirections(now: number): Promise<CachedRead<RouteDirectionList>> {
  return readThrough(corridorCache, CORRIDOR_CACHE_KEY, now, async () =>
    parseRouteDirections(await fetchControlService('/v1/route-directions')),
  );
}

/**
 * Every vehicle state the control service holds, unscoped.
 *
 * NEVER returned to a caller and never serialised. It exists so the corridor
 * derivation can be done in one call instead of 759, and the only thing done
 * with it is an immediate intersection against the caller's own fleet.
 */
function readAllVehicleStates(now: number): Promise<CachedRead<VehicleState[]>> {
  return readThrough(fleetStateCache, FLEET_STATE_CACHE_KEY, now, async () => {
    const raw = await fetchControlService('/v1/vehicle-states');
    return vehicleStatesResponseSchema.parse(raw).vehicleStates;
  });
}

function describeError(cause: unknown): string {
  if (cause instanceof ControlServiceConfigError) return cause.message;
  return cause instanceof Error ? cause.message : 'Unknown control service error';
}
