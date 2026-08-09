// Pure harvest: UPSRTC live + schedule payloads -> a NetworkSeed structure.
//
// NO I/O. Every function here is a deterministic transformation of its
// arguments, so the same payloads always produce a byte-identical seed
// (tests/seed/harvest.test.ts asserts exactly that). src/seed/index.ts does
// the fetching, src/seed/persist.ts does the writing; this module is the only
// place that decides what the network actually IS.
//
// ---------------------------------------------------------------------------
// WHAT THE UPSTREAM ACTUALLY PUBLISHES (measured 2026-08-09, not assumed)
// ---------------------------------------------------------------------------
// getGpsLiveData.php: 9,262 records, one per vehicle. 664 carry
// status === 'Live'; 1,602 carry a routename at all. Among the Live subset
// there are 517 distinct routenames, and routename -> `route` is 1:1 (zero
// conflicts observed), so the live feed is a usable routename index.
//
// getScheduledBusInfo.php?date&reg_num: 42-136 rows per vehicle-day, covering
// EVERY journey that vehicle runs that day (2-6 is typical), each restarting
// stop_sequence at 1. ~20% of stop rows carry 0/0 coordinates.
//
// ---------------------------------------------------------------------------
// WHY routes.id IS line_id AND NOT THE LIVE FEED'S `route`
// ---------------------------------------------------------------------------
// These are two different identifier spaces and they collide numerically:
// routename BRH_949_ORD_OUT has live `route` 3098, while the schedule feed
// calls the same line line_id 949. Measured facts that settle the choice:
//
//   * The live `route` is PER DIRECTION: CHL_585_ORD_IN -> 743 but
//     CHL_585_ORD_OUT -> 732. Using it as routes.id would give every route
//     exactly one direction and defeat the point of route_directions.
//   * line_id is SHARED by a line's two directions: RKD_635_ORD_IN and
//     RKD_635_ORD_OUT are both line_id 635, and their stop lists are exact
//     reverses of each other. That is precisely what
//     `unique (route_id, direction_code)` is shaped for.
//   * The depot prefix in RouteName is the OPERATING DEPOT, not part of the
//     route's identity: BBK_828_ORD_OUT and BRH_828_ORD_OUT are both line_id
//     828 and have byte-identical 27-stop lists. Keying on the routename
//     would duplicate that route once per depot.
//
// Nothing downstream is harmed by routes.id not equalling the live `route`:
// src/state-estimation/estimator.ts assigns a fix to a route-direction by
// GEOMETRY (map-matching against route_shapes.geom), never by route id.
//
// ---------------------------------------------------------------------------
// DIRECTION DERIVATION, AND THE ONE PLACE REALITY FORCED A REFINEMENT
// ---------------------------------------------------------------------------
// (a) RouteName ends _OUT / _IN -> that direction. Note _ORD / _JRT / _VPL /
//     _ACX / _RDN / _PNK are SERVICE CLASSES, not directions - a name ending
//     in _ORD is an unsuffixed name.
// (b) unsuffixed with several journeys -> ordered by first scheduled_time.
// (c) unsuffixed, one journey -> 'SINGLE'.
//
// Refinement to (b): assigning OUT-then-IN purely by start time is wrong on
// real data. ALM_11_VPL returns two journeys (07:01 and 13:30) whose stop
// sequences are IDENTICAL, not reversed - it is one direction run twice, not
// an out-and-back. Blindly labelling the second one 'IN' would fabricate a
// phantom inbound direction carrying outbound geometry, and two identical
// LineStrings then compete for the same GPS fix in map-matching. So the
// start-time ordering is kept, but a journey is only called the opposite
// direction when its stop order is actually REVERSED (terminal-swap test in
// isReversedStopOrder). Same-direction repeats keep one direction code and
// their start-time span becomes the target headway, which is what those
// timestamps genuinely mean.

import {
  buildShape,
  findCoordinateSpikes,
  MAX_STOP_DETOUR_METERS,
  type LatLng,
  type ShapeRejectionReason,
} from './geometry.js';
import {
  isValidRegistrationNumber,
} from '../ingestion/upsrtc/client.js';
import {
  normalizeLiveRecords,
  normalizeScheduleJourneys,
  type LiveRecord,
  type ScheduleJourney,
} from '../ingestion/upsrtc/normalize.js';

// ============================================================================
// Defaults (all overridable from the CLI)
// ============================================================================

export const DEFAULT_HEADWAY_SECONDS = 1800;

/**
 * kf / kb / self_equalizing_k are NULLABLE with no column default, and
 * src/mpc/twoWayHold.ts returns [] when kf or kb is null - a route seeded
 * without gains silently degrades to self-equalizing control with no error
 * anywhere. The seeder therefore always writes all three.
 */
export const DEFAULT_GAINS = { kf: 0.4, kb: 0.2, selfEqualizingK: 0.35 } as const;

/**
 * Fail closed. src/pilot/rolloutStages.ts defaults a missing row to
 * 'observation' and src/pilot/gate.ts rejects every command in that stage, so
 * seeding at 'observation' matches the safest posture rather than quietly
 * opening a route up.
 */
export const DEFAULT_ROLLOUT_STAGE = 'observation';

/** Every Nth stop becomes a control point, in addition to first and last. */
export const DEFAULT_CONTROL_POINT_INTERVAL = 5;

/**
 * Journey start times are wall-clock with no date. Below this the "headway" is
 * an artefact (a residual duplicate, a midnight wrap) rather than a service
 * pattern, and the run falls back to the configured default. Deliberately the
 * same figure as DUPLICATE_JOURNEY_WINDOW_SECONDS: a gap small enough to look
 * like a duplicate cannot simultaneously be a credible headway.
 */
export const MIN_DERIVED_HEADWAY_SECONDS = 300;

/**
 * Two journeys on one route-direction that visit the same stops in the same
 * order and start within this window are ONE working published twice.
 *
 * MEASURED: line 2086 publishes vj 7283 at 17:00:00 and vj 54457 at 17:01:00
 * with identical 24-stop sequences. Line 2058 publishes its three daily
 * departures (08:30 / 13:30 / 18:30) a second time as 08:31 / 13:31 / 18:33.
 * Counted naively that turns a 5-hour headway into 7,236s and a single evening
 * departure into a 60-second one — and target_headway_seconds is H*, which
 * every detection threshold in src/headway/ is a ratio of, so a wrong H* makes
 * the whole route read as permanently bunched.
 */
export const DUPLICATE_JOURNEY_WINDOW_SECONDS = 300;

// ============================================================================
// Seed structure
// ============================================================================

export interface SeedVehicle {
  /** vehicles.id — the registration number, which is what every upstream feed keys on. */
  id: string;
  registrationNumber: string;
  vehicleType: string | null;
  depotName: string | null;
}

export interface SeedStop {
  /** stops.id — String(atco_code). Physical stop identity, never sequence-suffixed. */
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface SeedRouteDirectionStop {
  stopId: string;
  /** Dense from 0. Sequence 0 always exists — stateStore.getTerminalStopId needs it. */
  sequence: number;
  cumulativeDistanceMeters: number;
  isControlPoint: boolean;
  holdSuitable: boolean;
}

export interface SeedRoutePolicy {
  targetHeadwaySeconds: number;
  kf: number;
  kb: number;
  selfEqualizingK: number;
}

export interface SeedRouteDirection {
  routeId: string;
  directionCode: string;
  directionName: string | null;
  isLoop: boolean;
  /** Adjacent-deduped LineString vertices, lat/lon; lon goes first in WKT. */
  shapeVertices: LatLng[];
  totalDistanceMeters: number;
  stops: SeedRouteDirectionStop[];
  policy: SeedRoutePolicy;
  rolloutStage: string;
  /** Provenance for the report: which upstream journeys produced this direction. */
  journeyIds: string[];
  sourceRouteNames: string[];
}

export interface SeedRoute {
  id: string;
  publicName: string;
  directions: SeedRouteDirection[];
}

export interface NetworkSeed {
  vehicles: SeedVehicle[];
  stops: SeedStop[];
  routes: SeedRoute[];
  report: HarvestReport;
}

// ============================================================================
// Audit report — the ~20% coordinate loss must never be silent
// ============================================================================

export type SkipReason =
  | 'schedule_unassigned'
  | 'schedule_fetch_failed'
  | 'unresolved_route_id'
  | ShapeRejectionReason;

export interface SkippedRouteEntry {
  registrationNumber: string | null;
  routeName: string | null;
  routeId: string | null;
  directionCode: string | null;
  reason: SkipReason;
  detail: string;
}

export interface DroppedStopEntry {
  routeId: string;
  directionCode: string;
  stopId: string;
  name: string;
  upstreamSequence: number;
  reason:
    | 'no_coordinate_anywhere'
    | 'duplicate_stop_in_direction'
    | 'invalid_stop_id'
    | 'coordinate_outlier';
  /** Only for 'coordinate_outlier': how far off the corridor the point sat. */
  detourMeters?: number;
}

export interface RecoveredStopEntry {
  routeId: string;
  directionCode: string;
  stopId: string;
  /** The route whose rows supplied the coordinate this stop was missing. */
  sourceRouteId: string;
}

export interface DerivedDirectionEntry {
  routeId: string;
  routeName: string | null;
  journeyId: string;
  directionCode: string;
  basis:
    | 'route_name_suffix'
    | 'derived_from_start_time_order'
    | 'derived_from_suffixed_reference'
    | 'single_journey'
    | 'single_direction_repeat';
}

export interface LoopDirectionEntry {
  routeId: string;
  directionCode: string;
  repeatedStopIds: string[];
}

export interface DuplicateJourneyEntry {
  routeId: string;
  directionCode: string;
  /** Journeys collapsed into an earlier identical one before H* was derived. */
  droppedJourneyIds: string[];
}

export interface HarvestReport {
  liveRecordCount: number;
  /**
   * Vehicles the feed reports as live. MEASURED CAVEAT: `status` is the empty
   * string on 7,648 of 9,262 records, and the alias chain in normalize.ts then
   * resolves `vehicle_status` ('live' | 'stationary' | 'no_signal' |
   * 'under_maintenance') instead — so this counts 3,328, not the 664 that carry
   * a literal `status: 'Live'`. Probe planning is unaffected: the extra records
   * carry no routename, so both definitions yield the same 517 probes.
   */
  liveActiveCount: number;
  probesPlanned: number;
  probesAttempted: number;
  probesWithSchedule: number;
  probesUnassigned: number;
  probesFailed: number;
  journeysHarvested: number;
  routesAccepted: number;
  directionsAccepted: number;
  stopsAccepted: number;
  skippedRoutes: SkippedRouteEntry[];
  droppedStops: DroppedStopEntry[];
  recoveredStops: RecoveredStopEntry[];
  derivedDirections: DerivedDirectionEntry[];
  loopDirections: LoopDirectionEntry[];
  duplicateJourneys: DuplicateJourneyEntry[];
}

// ============================================================================
// Probe planning (live feed -> which vehicle to ask about which route)
// ============================================================================

export interface ProbeTarget {
  routeName: string;
  registrationNumber: string;
}

export interface LivePlan {
  /** Every distinct vehicle in the feed, not just the Live ones. */
  vehicles: SeedVehicle[];
  probes: ProbeTarget[];
  liveRecordCount: number;
  liveActiveCount: number;
}

function isLiveStatus(status: string | null): boolean {
  return status !== null && status.trim().toLowerCase() === 'live';
}

/**
 * Decide which vehicle to ask the schedule endpoint about, per live route.
 *
 * The vehicle list is deliberately the WHOLE feed, not the Live subset:
 * vehicle_states.vehicle_id and commands.vehicle_id both FK vehicles(id), and
 * a bus that is Offline right now goes Live later in the day.
 *
 * The probe vehicle is the lexicographically smallest valid registration in
 * each routename group, so a re-run at a different moment of the day picks the
 * same bus for any route whose Live set is unchanged, and the seed stays
 * reproducible.
 */
export function planProbes(livePayload: unknown): LivePlan {
  const { records, recordCount } = normalizeLiveRecords(livePayload);

  const sorted = [...records].sort((a, b) =>
    a.registrationNumber < b.registrationNumber ? -1 : a.registrationNumber > b.registrationNumber ? 1 : 0,
  );

  const vehicles: SeedVehicle[] = sorted.map((record: LiveRecord) => ({
    id: record.registrationNumber,
    registrationNumber: record.registrationNumber,
    vehicleType: record.vehicleType,
    depotName: record.depotName,
  }));

  const bestByRouteName = new Map<string, string>();
  let liveActiveCount = 0;
  for (const record of sorted) {
    if (!isLiveStatus(record.status)) continue;
    liveActiveCount += 1;
    if (!record.routeName) continue;
    if (!isValidRegistrationNumber(record.registrationNumber)) continue;
    const current = bestByRouteName.get(record.routeName);
    if (current === undefined || record.registrationNumber < current) {
      bestByRouteName.set(record.routeName, record.registrationNumber);
    }
  }

  const probes: ProbeTarget[] = [...bestByRouteName.entries()]
    .map(([routeName, registrationNumber]) => ({ routeName, registrationNumber }))
    .sort((a, b) => (a.routeName < b.routeName ? -1 : a.routeName > b.routeName ? 1 : 0));

  return { vehicles, probes, liveRecordCount: recordCount, liveActiveCount };
}

// ============================================================================
// Harvest
// ============================================================================

export interface ScheduleProbeResult {
  registrationNumber: string;
  /** The live routename this vehicle was chosen for. Provenance only. */
  routeName: string | null;
  /** Service date actually used (may be date-1 after a retry). */
  date: string;
  /** Raw upstream payload, or null when the fetch itself failed. */
  payload: unknown;
  /** Transport-level failure message; null/undefined on success. */
  error?: string | null;
}

export interface HarvestOptions {
  defaultHeadwaySeconds?: number;
  gains?: { kf: number; kb: number; selfEqualizingK: number };
  rolloutStage?: string;
  controlPointInterval?: number;
  /** 0 disables outlier pruning entirely. See geometry.findCoordinateSpikes. */
  maxStopDetourMeters?: number;
}

interface HarvestedJourney {
  journey: ScheduleJourney;
  routeId: string;
  registrationNumber: string;
}

/** `_ORD`, `_JRT`, `_VPL` etc. are service classes; only _IN/_OUT are directions. */
export function directionSuffix(routeName: string | null): 'IN' | 'OUT' | null {
  if (!routeName) return null;
  if (/_OUT$/i.test(routeName)) return 'OUT';
  if (/_IN$/i.test(routeName)) return 'IN';
  return null;
}

/** RouteName with any trailing _IN/_OUT removed. Service class is retained. */
export function stripDirectionSuffix(routeName: string): string {
  return routeName.replace(/_(IN|OUT)$/i, '');
}

/**
 * Terminal-swap test: B runs the reverse of A when A starts where B ends and
 * ends where B starts, on a route that is not a closed loop.
 *
 * Deliberately not a full sequence comparison — real IN/OUT pairs differ by a
 * stop or two (one-way loops around a terminal), and requiring exact reversal
 * would miss them, while comparing terminals alone is enough to tell an
 * out-and-back from a same-direction repeat (the case this exists for).
 */
export function isReversedStopOrder(a: readonly string[], b: readonly string[]): boolean {
  if (a.length < 2 || b.length < 2) return false;
  const aFirst = a[0]!;
  const aLast = a[a.length - 1]!;
  const bFirst = b[0]!;
  const bLast = b[b.length - 1]!;
  if (aFirst === aLast) return false; // closed loop: nothing to reverse
  return aFirst === bLast && aLast === bFirst;
}

function opposite(direction: string): string {
  if (direction === 'OUT') return 'IN';
  if (direction === 'IN') return 'OUT';
  return direction;
}

/** "HH:MM:SS" -> seconds since midnight. null for anything unparseable. */
export function scheduledTimeToSeconds(value: string | null): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? '0');
  if (hours > 47 || minutes > 59 || seconds > 59) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * routes.id. line_id first — see the module header for the measurements that
 * settle this. The remaining branches only fire on payloads that omit it.
 */
function resolveRouteId(journey: ScheduleJourney): string | null {
  if (journey.lineId) return journey.lineId;
  const embedded = journey.routeName ? /_(\d+)_/.exec(journey.routeName)?.[1] : undefined;
  if (embedded) return embedded;
  if (journey.routeName) return stripDirectionSuffix(journey.routeName);
  return null;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

interface GlobalCoordinate {
  lat: number;
  lon: number;
  name: string;
  sourceRouteId: string;
}

/**
 * SECOND PASS over the entire harvest: atco_code -> the first valid coordinate
 * seen for it ANYWHERE.
 *
 * ~20% of schedule stop rows carry 0/0. The same physical stop very often does
 * have a real coordinate on a different route that also serves it, so a stop
 * dropped route-by-route would throw away recoverable geometry. Only a stop
 * with no valid coordinate on any harvested route is genuinely unusable.
 *
 * Iteration order is the journey ordering the caller established (sorted), so
 * "first valid wins" is deterministic across re-runs.
 */
function buildGlobalCoordinateIndex(journeys: readonly HarvestedJourney[]): Map<string, GlobalCoordinate> {
  const index = new Map<string, GlobalCoordinate>();
  for (const { journey, routeId } of journeys) {
    for (const stop of journey.stops) {
      if (stop.coordinateMissing) continue;
      if (stop.latitude === null || stop.longitude === null) continue;
      if (index.has(stop.stopId)) continue;
      index.set(stop.stopId, {
        lat: stop.latitude,
        lon: stop.longitude,
        name: stop.name,
        sourceRouteId: routeId,
      });
    }
  }
  return index;
}

interface DirectionGroup {
  routeId: string;
  directionCode: string;
  journeys: HarvestedJourney[];
}

/**
 * Assign a direction_code to every journey of one route, and record the basis
 * so the report can show which routes got a derived (rather than declared)
 * direction. See the module header for why (b) checks stop order.
 */
function assignDirections(
  routeId: string,
  journeys: readonly HarvestedJourney[],
  derived: DerivedDirectionEntry[],
): Map<string, string> {
  const byJourneyId = new Map<string, string>();
  const record = (entry: HarvestedJourney, code: string, basis: DerivedDirectionEntry['basis']): void => {
    byJourneyId.set(entry.journey.journeyId, code);
    if (basis !== 'route_name_suffix') {
      derived.push({
        routeId,
        routeName: entry.journey.routeName,
        journeyId: entry.journey.journeyId,
        directionCode: code,
        basis,
      });
    }
  };

  const suffixed: HarvestedJourney[] = [];
  const unsuffixed: HarvestedJourney[] = [];
  for (const entry of journeys) {
    const suffix = directionSuffix(entry.journey.routeName);
    if (suffix) {
      record(entry, suffix, 'route_name_suffix');
      suffixed.push(entry);
    } else {
      unsuffixed.push(entry);
    }
  }

  if (unsuffixed.length === 0) return byJourneyId;

  const stopIds = (entry: HarvestedJourney): string[] => entry.journey.stops.map((s) => s.stopId);

  // A declared direction on the same route is a better reference than an
  // arbitrary unsuffixed journey — classify against it rather than inventing
  // a third direction code.
  const reference =
    suffixed.find((entry) => directionSuffix(entry.journey.routeName) === 'OUT') ?? suffixed[0];
  if (reference) {
    const referenceCode = directionSuffix(reference.journey.routeName) ?? 'OUT';
    const referenceIds = stopIds(reference);
    for (const entry of unsuffixed) {
      const code = isReversedStopOrder(referenceIds, stopIds(entry))
        ? opposite(referenceCode)
        : referenceCode;
      record(entry, code, 'derived_from_suffixed_reference');
    }
    return byJourneyId;
  }

  if (unsuffixed.length === 1) {
    record(unsuffixed[0]!, 'SINGLE', 'single_journey');
    return byJourneyId;
  }

  const ordered = [...unsuffixed].sort((a, b) => {
    const at = scheduledTimeToSeconds(a.journey.firstScheduledTime);
    const bt = scheduledTimeToSeconds(b.journey.firstScheduledTime);
    if (at !== bt) return (at ?? Number.MAX_SAFE_INTEGER) - (bt ?? Number.MAX_SAFE_INTEGER);
    return compareStrings(a.journey.journeyId, b.journey.journeyId);
  });

  const headIds = stopIds(ordered[0]!);
  const anyReversed = ordered.slice(1).some((entry) => isReversedStopOrder(headIds, stopIds(entry)));

  if (!anyReversed) {
    // Same road, run repeatedly. One direction; the start times are headway
    // data, not evidence of an inbound working.
    for (const entry of ordered) record(entry, 'SINGLE', 'single_direction_repeat');
    return byJourneyId;
  }

  for (const [index, entry] of ordered.entries()) {
    const code = index === 0 || !isReversedStopOrder(headIds, stopIds(entry)) ? 'OUT' : 'IN';
    record(entry, code, 'derived_from_start_time_order');
  }
  return byJourneyId;
}

/**
 * Collapse re-publications of the same working. See
 * DUPLICATE_JOURNEY_WINDOW_SECONDS for the measurements behind this.
 *
 * A duplicate must match on BOTH the stop sequence and the start time: two
 * departures an hour apart over the same road are a real headway pair and must
 * survive, while two records a minute apart over the same road are one bus.
 * The earliest start is kept, so the survivor is stable across re-runs.
 */
export function dedupeNearIdenticalJourneys(
  journeys: readonly HarvestedJourney[],
  windowSeconds: number = DUPLICATE_JOURNEY_WINDOW_SECONDS,
): { kept: HarvestedJourney[]; dropped: HarvestedJourney[] } {
  const ordered = [...journeys].sort((a, b) => {
    const at = scheduledTimeToSeconds(a.journey.firstScheduledTime) ?? Number.MAX_SAFE_INTEGER;
    const bt = scheduledTimeToSeconds(b.journey.firstScheduledTime) ?? Number.MAX_SAFE_INTEGER;
    if (at !== bt) return at - bt;
    return compareStrings(a.journey.journeyId, b.journey.journeyId);
  });

  const kept: HarvestedJourney[] = [];
  const dropped: HarvestedJourney[] = [];
  for (const entry of ordered) {
    const signature = entry.journey.stops.map((stop) => stop.stopId).join('>');
    const start = scheduledTimeToSeconds(entry.journey.firstScheduledTime);
    const duplicate = kept.some((other) => {
      if (other.journey.stops.map((stop) => stop.stopId).join('>') !== signature) return false;
      const otherStart = scheduledTimeToSeconds(other.journey.firstScheduledTime);
      if (start === null || otherStart === null) return true; // no times to tell them apart
      return Math.abs(start - otherStart) <= windowSeconds;
    });
    if (duplicate) dropped.push(entry);
    else kept.push(entry);
  }
  return { kept, dropped };
}

/** Journey start-time span / (N-1). Falls back to the configured default. */
function deriveTargetHeadwaySeconds(
  journeys: readonly HarvestedJourney[],
  fallbackSeconds: number,
): number {
  const starts = journeys
    .map((entry) => scheduledTimeToSeconds(entry.journey.firstScheduledTime))
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  if (starts.length < 2) return fallbackSeconds;
  const span = starts[starts.length - 1]! - starts[0]!;
  const headway = Math.round(span / Math.max(1, starts.length - 1));
  return headway >= MIN_DERIVED_HEADWAY_SECONDS ? headway : fallbackSeconds;
}

/**
 * Which journey supplies the geometry when several serve one route-direction
 * (two depots running the same line, or one bus running it twice).
 *
 * Most usable stops wins — a journey whose stops all resolve to a coordinate
 * makes a better shape than a longer one riddled with 0/0s. Every tie-break
 * after that is a total order on stable values, so the choice never depends on
 * which HTTP response happened to land first.
 */
function selectRepresentative(
  group: DirectionGroup,
  coordinates: Map<string, GlobalCoordinate>,
): HarvestedJourney {
  const usable = (entry: HarvestedJourney): number =>
    entry.journey.stops.filter((stop) => coordinates.has(stop.stopId)).length;

  return [...group.journeys].sort((a, b) => {
    const byUsable = usable(b) - usable(a);
    if (byUsable !== 0) return byUsable;
    const byLength = b.journey.stops.length - a.journey.stops.length;
    if (byLength !== 0) return byLength;
    const at = scheduledTimeToSeconds(a.journey.firstScheduledTime) ?? Number.MAX_SAFE_INTEGER;
    const bt = scheduledTimeToSeconds(b.journey.firstScheduledTime) ?? Number.MAX_SAFE_INTEGER;
    if (at !== bt) return at - bt;
    return compareStrings(a.journey.journeyId, b.journey.journeyId);
  })[0]!;
}

/**
 * Turn payloads into the seed.
 *
 * `livePayload` supplies the vehicle inventory and the probe plan;
 * `probeResults` are the schedule responses (already retried/failed by the
 * caller). Both are raw upstream shapes so a pinned fixture round-trips
 * through the exact same code path production uses.
 */
export function harvestNetwork(
  livePayload: unknown,
  probeResults: readonly ScheduleProbeResult[],
  options: HarvestOptions = {},
): NetworkSeed {
  const fallbackHeadway = options.defaultHeadwaySeconds ?? DEFAULT_HEADWAY_SECONDS;
  const gains = options.gains ?? DEFAULT_GAINS;
  const rolloutStage = options.rolloutStage ?? DEFAULT_ROLLOUT_STAGE;
  const controlPointInterval = Math.max(1, options.controlPointInterval ?? DEFAULT_CONTROL_POINT_INTERVAL);
  const maxStopDetourMeters = options.maxStopDetourMeters ?? MAX_STOP_DETOUR_METERS;

  const plan = planProbes(livePayload);

  const report: HarvestReport = {
    liveRecordCount: plan.liveRecordCount,
    liveActiveCount: plan.liveActiveCount,
    probesPlanned: plan.probes.length,
    probesAttempted: probeResults.length,
    probesWithSchedule: 0,
    probesUnassigned: 0,
    probesFailed: 0,
    journeysHarvested: 0,
    routesAccepted: 0,
    directionsAccepted: 0,
    stopsAccepted: 0,
    skippedRoutes: [],
    droppedStops: [],
    recoveredStops: [],
    derivedDirections: [],
    loopDirections: [],
    duplicateJourneys: [],
  };

  // ---- 1. Normalize every probe response into journeys -------------------
  // Sorted by registration so the global coordinate index and every
  // "first wins" tie-break below are independent of response arrival order.
  const orderedResults = [...probeResults].sort((a, b) =>
    compareStrings(a.registrationNumber, b.registrationNumber),
  );

  const journeysById = new Map<string, HarvestedJourney>();
  for (const result of orderedResults) {
    if (result.error) {
      report.probesFailed += 1;
      report.skippedRoutes.push({
        registrationNumber: result.registrationNumber,
        routeName: result.routeName,
        routeId: null,
        directionCode: null,
        reason: 'schedule_fetch_failed',
        detail: result.error,
      });
      continue;
    }

    const journeys = normalizeScheduleJourneys(result.payload);
    if (journeys.length === 0) {
      report.probesUnassigned += 1;
      report.skippedRoutes.push({
        registrationNumber: result.registrationNumber,
        routeName: result.routeName,
        routeId: null,
        directionCode: null,
        reason: 'schedule_unassigned',
        detail: `no journeys for ${result.registrationNumber} on ${result.date}`,
      });
      continue;
    }

    report.probesWithSchedule += 1;
    for (const journey of journeys) {
      const routeId = resolveRouteId(journey);
      if (!routeId) {
        report.skippedRoutes.push({
          registrationNumber: result.registrationNumber,
          routeName: journey.routeName,
          routeId: null,
          directionCode: null,
          reason: 'unresolved_route_id',
          detail: `journey ${journey.journeyId} carries no line_id and no RouteName`,
        });
        continue;
      }
      // The same journey can be reached through more than one probe; keep one.
      if (journeysById.has(journey.journeyId)) continue;
      journeysById.set(journey.journeyId, {
        journey,
        routeId,
        registrationNumber: result.registrationNumber,
      });
    }
  }

  const allJourneys = [...journeysById.values()].sort((a, b) =>
    compareStrings(a.journey.journeyId, b.journey.journeyId),
  );
  report.journeysHarvested = allJourneys.length;

  // ---- 2. Global coordinate recovery pass --------------------------------
  const coordinates = buildGlobalCoordinateIndex(allJourneys);

  // ---- 3. Group by route, then assign directions -------------------------
  const byRoute = new Map<string, HarvestedJourney[]>();
  for (const entry of allJourneys) {
    const bucket = byRoute.get(entry.routeId);
    if (bucket) bucket.push(entry);
    else byRoute.set(entry.routeId, [entry]);
  }

  const usedStopIds = new Set<string>();
  const routes: SeedRoute[] = [];

  for (const routeId of [...byRoute.keys()].sort(compareStrings)) {
    const routeJourneys = byRoute.get(routeId)!;
    const directionByJourneyId = assignDirections(routeId, routeJourneys, report.derivedDirections);

    const groups = new Map<string, DirectionGroup>();
    for (const entry of routeJourneys) {
      const directionCode = directionByJourneyId.get(entry.journey.journeyId);
      if (!directionCode) continue;
      const group = groups.get(directionCode);
      if (group) group.journeys.push(entry);
      else groups.set(directionCode, { routeId, directionCode, journeys: [entry] });
    }

    const directions: SeedRouteDirection[] = [];
    for (const directionCode of [...groups.keys()].sort(compareStrings)) {
      const group = groups.get(directionCode)!;
      const built = buildDirection(
        group,
        coordinates,
        { fallbackHeadway, gains, rolloutStage, controlPointInterval, maxStopDetourMeters },
        report,
      );
      if (built) {
        directions.push(built);
        for (const stop of built.stops) usedStopIds.add(stop.stopId);
      }
    }

    if (directions.length === 0) continue;

    // route_description is the human name ("BAHRAICH TO KAISERBAGH VIA
    // BARABANKI"); routename minus its direction suffix is the fallback.
    const named = routeJourneys.find((entry) => entry.journey.routeDescription !== null);
    const fallbackName = routeJourneys.find((entry) => entry.journey.routeName !== null);
    const publicName =
      named?.journey.routeDescription ??
      (fallbackName?.journey.routeName ? stripDirectionSuffix(fallbackName.journey.routeName) : routeId);

    routes.push({ id: routeId, publicName, directions });
  }

  const stops: SeedStop[] = [...usedStopIds]
    .sort(compareStrings)
    .map((stopId) => {
      const coordinate = coordinates.get(stopId)!;
      return { id: stopId, name: coordinate.name, lat: coordinate.lat, lon: coordinate.lon };
    });

  report.routesAccepted = routes.length;
  report.directionsAccepted = routes.reduce((sum, route) => sum + route.directions.length, 0);
  report.stopsAccepted = stops.length;

  return { vehicles: plan.vehicles, stops, routes, report };
}

interface BuildDirectionConfig {
  fallbackHeadway: number;
  gains: { kf: number; kb: number; selfEqualizingK: number };
  rolloutStage: string;
  controlPointInterval: number;
  maxStopDetourMeters: number;
}

function buildDirection(
  rawGroup: DirectionGroup,
  coordinates: Map<string, GlobalCoordinate>,
  config: BuildDirectionConfig,
  report: HarvestReport,
): SeedRouteDirection | null {
  const { routeId, directionCode } = rawGroup;

  // Collapse re-published workings BEFORE anything reads the journey count:
  // target_headway_seconds is H*, and every detection threshold in
  // src/headway/ is a ratio of it.
  const { kept: journeys, dropped } = dedupeNearIdenticalJourneys(rawGroup.journeys);
  if (dropped.length > 0) {
    report.duplicateJourneys.push({
      routeId,
      directionCode,
      droppedJourneyIds: dropped.map((entry) => entry.journey.journeyId).sort(compareStrings),
    });
  }
  const group: DirectionGroup = { routeId, directionCode, journeys };

  const representative = selectRepresentative(group, coordinates);

  const kept: {
    stopId: string;
    name: string;
    upstreamSequence: number;
    lat: number;
    lon: number;
  }[] = [];
  const seen = new Set<string>();
  const repeatedStopIds: string[] = [];

  for (const stop of representative.journey.stops) {
    if (!stop.stopId || stop.stopId === '0') {
      report.droppedStops.push({
        routeId,
        directionCode,
        stopId: stop.stopId,
        name: stop.name,
        upstreamSequence: stop.sequence,
        reason: 'invalid_stop_id',
      });
      continue;
    }

    const coordinate = coordinates.get(stop.stopId);
    if (!coordinate) {
      report.droppedStops.push({
        routeId,
        directionCode,
        stopId: stop.stopId,
        name: stop.name,
        upstreamSequence: stop.sequence,
        reason: 'no_coordinate_anywhere',
      });
      continue;
    }

    // A repeated atco_code inside one direction violates
    // unique (route_direction_id, stop_id). Keep the first visit, flag the
    // direction as a loop, and log the dropped repeat rather than letting the
    // whole insert fail.
    if (seen.has(stop.stopId)) {
      repeatedStopIds.push(stop.stopId);
      report.droppedStops.push({
        routeId,
        directionCode,
        stopId: stop.stopId,
        name: stop.name,
        upstreamSequence: stop.sequence,
        reason: 'duplicate_stop_in_direction',
      });
      continue;
    }
    seen.add(stop.stopId);

    if (stop.coordinateMissing) {
      report.recoveredStops.push({
        routeId,
        directionCode,
        stopId: stop.stopId,
        sourceRouteId: coordinate.sourceRouteId,
      });
    }

    kept.push({
      stopId: stop.stopId,
      name: stop.name,
      upstreamSequence: stop.sequence,
      lat: coordinate.lat,
      lon: coordinate.lon,
    });
  }

  if (repeatedStopIds.length > 0) {
    report.loopDirections.push({ routeId, directionCode, repeatedStopIds });
  }

  // Drop individually mis-surveyed coordinates before the shape is built, so
  // one bad point costs one stop instead of the whole direction (or, worse,
  // silently inflates total_distance_meters). Every removal is reported.
  const spikes = findCoordinateSpikes(
    kept.map((stop) => ({ lat: stop.lat, lon: stop.lon })),
    config.maxStopDetourMeters,
  );
  if (spikes.length > 0) {
    const spikeIndexes = new Set(spikes.map((spike) => spike.index));
    for (const spike of spikes) {
      const stop = kept[spike.index]!;
      report.droppedStops.push({
        routeId,
        directionCode,
        stopId: stop.stopId,
        name: stop.name,
        upstreamSequence: stop.upstreamSequence,
        reason: 'coordinate_outlier',
        detourMeters: Math.round(spike.detourMeters),
      });
    }
    for (let index = kept.length - 1; index >= 0; index -= 1) {
      if (spikeIndexes.has(index)) kept.splice(index, 1);
    }
  }

  const shape = buildShape(kept.map((stop) => ({ lat: stop.lat, lon: stop.lon })));
  if (!shape.ok) {
    report.skippedRoutes.push({
      registrationNumber: representative.registrationNumber,
      routeName: representative.journey.routeName,
      routeId,
      directionCode,
      reason: shape.reason,
      detail: shape.detail,
    });
    return null;
  }

  const lastIndex = kept.length - 1;
  const stops: SeedRouteDirectionStop[] = kept.map((stop, index) => {
    const isControlPoint =
      index === 0 || index === lastIndex || index % config.controlPointInterval === 0;
    return {
      stopId: stop.stopId,
      // Dense from 0: sequence 0 must exist or stateStore.getTerminalStopId
      // returns undefined and terminal dispatch can never fire.
      sequence: index,
      cumulativeDistanceMeters: shape.cumulativeDistancesMeters[index]!,
      isControlPoint,
      holdSuitable: isControlPoint,
    };
  });

  return {
    routeId,
    directionCode,
    directionName: representative.journey.routeDescription,
    isLoop: repeatedStopIds.length > 0,
    shapeVertices: shape.vertices,
    totalDistanceMeters: shape.totalDistanceMeters,
    stops,
    policy: {
      targetHeadwaySeconds: deriveTargetHeadwaySeconds(journeys, config.fallbackHeadway),
      kf: config.gains.kf,
      kb: config.gains.kb,
      selfEqualizingK: config.gains.selfEqualizingK,
    },
    rolloutStage: config.rolloutStage,
    journeyIds: group.journeys.map((entry) => entry.journey.journeyId).sort(compareStrings),
    sourceRouteNames: [
      ...new Set(
        group.journeys
          .map((entry) => entry.journey.routeName)
          .filter((name): name is string => name !== null),
      ),
    ].sort(compareStrings),
  };
}
