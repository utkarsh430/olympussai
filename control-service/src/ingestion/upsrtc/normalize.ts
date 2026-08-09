// Alias-tolerant normalization of the undocumented UPSRTC upstream feeds, for
// the network seeder.
//
// SIBLING IMPLEMENTATION: src/lib/upsrtc/normalizer.ts in the Next.js app
// (repo root). The alias tables, the "None"/"null"/"NULL"/"" null sentinels,
// extractArray's wrapper unwrapping and isValidCoordinate's null-island reject
// are ported from there verbatim — that file paid for this knowledge
// empirically (docs/API_DISCOVERY.md). No import is possible: the root
// tsconfig excludes control-service/ and there is no pnpm workspace.
//
// WHAT IS DELIBERATELY DIFFERENT FROM THE SIBLING, and why
// `normalizeSchedulePayload` is NOT reused as-is for seeding:
//
//  1. Stop identity. The sibling emits `${atco_code}-${sequence}` as the stop
//     id because it feeds React keys. Here `stops.id` is PHYSICAL stop master
//     data and route_direction_stops FKs to it — one physical stop appearing
//     at sequence 3 outbound and sequence 19 inbound must be ONE row. So the
//     stop id is `String(atco_code)`, full stop, and sequence lives only on
//     route_direction_stops.
//  2. Journey selection. The sibling's selectTrip/groupByTrip keep exactly one
//     journey and are module-private. The seeder needs ALL journeys: that is
//     precisely how a route's _IN/_OUT directions (and a pile of bonus routes
//     the probed vehicle happens to also run) are discovered from a single
//     vehicle-day response.
//  3. Missing coordinates. The sibling keeps 0/0 stops in the array with
//     latitude: null so the UI can still list them. The seeder must be able to
//     exclude them from the LineString — geography(Point,4326) is NOT NULL —
//     so they are flagged here and dropped by src/seed/harvest.ts, which
//     re-sequences the survivors densely.

type Rec = Record<string, unknown>;

const REG_ALIASES = [
  'regNum',
  'reg_num',
  'registration_no',
  'registration_number',
  'registrationNo',
  'RegNo',
  'bus_id',
  'vehicle_no',
  'vehicleNumber',
  'veh_no',
  'bus_no',
  'busNumber',
] as const;

const LAT_ALIASES = ['latitude', 'lat', 'Latitude', 'gps_lat', 'gpsLatitude', 'Lat'] as const;
const LNG_ALIASES = [
  'longitude',
  'lng',
  'lon',
  'long',
  'Longitude',
  'gps_lng',
  'gpsLongitude',
  'Lng',
] as const;
const DEPOT_ALIASES = ['depot_name', 'depotName', 'depot', 'home_depot_name'] as const;
const VEHICLE_TYPE_ALIASES = ['vehicle_type', 'vehicleType', 'service_type', 'bus_type'] as const;
const STATUS_ALIASES = ['status', 'vehicle_status', 'vehicleStatus', 'packetStatus'] as const;

// The live feed's own route id. `route` first — that is exactly what
// src/models/canonical.ts CanonicalLiveBus.routeId resolves to in the web app,
// and routes.id is documented in the core migration as matching it.
const LIVE_ROUTE_ID_ALIASES = ['route', 'route_id', 'routeId'] as const;
// The SCHEDULE feed's route id. Kept separate from the live one on purpose:
// they are different identifier spaces — see normalizeScheduleJourneys.
const SCHEDULE_LINE_ID_ALIASES = ['line_id', 'lineId'] as const;
const ROUTE_NAME_ALIASES = ['routename', 'route_name', 'routeName', 'RouteName'] as const;
const ROUTE_DESCRIPTION_ALIASES = ['route_description', 'routeDescription'] as const;
const LINE_NAME_ALIASES = ['line_name', 'lineName'] as const;

const JOURNEY_ID_ALIASES = ['vj_id', 'vehicle_journey_id', 'trip_id', 'tripId'] as const;
const JOURNEY_CODE_ALIASES = ['vehicle_journey_code', 'service_number', 'serviceNumber'] as const;
const STOP_ID_ALIASES = ['atco_code', 'stop_id', 'stopId', 'code'] as const;
const STOP_NAME_ALIASES = ['stop_name', 'stopName', 'platform_name', 'name'] as const;
const STOP_SEQ_ALIASES = ['stop_sequence', 'sequence', 'seq', 'stopSequence'] as const;
const STOP_TIME_ALIASES = ['scheduled_time', 'scheduledTime', 'arrival_time'] as const;

export function isRecord(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Pick the first alias present with a meaningful (non-empty, non-"None") value. */
export function pick(rec: Rec, aliases: readonly string[]): unknown {
  for (const key of aliases) {
    if (!(key in rec)) continue;
    const value = rec[key];
    if (value === null || value === undefined) continue;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed === '' || trimmed === 'None' || trimmed === 'null' || trimmed === 'NULL') continue;
      return trimmed;
    }
    return value;
  }
  return undefined;
}

export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function toStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.trim() === '' ? null : value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

/** Latitude/longitude sanity gate. Rejects null island and out-of-range values. */
export function isValidCoordinate(lat: number | null, lng: number | null): boolean {
  if (lat === null || lng === null) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  // Reject exact zero-zero (null island) - a common GPS "no fix" sentinel, and
  // upstream's stand-in for "this stop was never surveyed". ~23% of schedule
  // stop rows carry it.
  if (lat === 0 && lng === 0) return false;
  return true;
}

/**
 * Unwrap the many shapes an upstream PHP endpoint might return:
 * a bare array, a wrapper object, or a JSON string nested inside JSON.
 */
export function extractArray(payload: unknown, depth = 0): unknown[] {
  if (depth > 4) return [];
  if (Array.isArray(payload)) return payload;

  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return [];
    try {
      return extractArray(JSON.parse(trimmed), depth + 1);
    } catch {
      return [];
    }
  }

  if (isRecord(payload)) {
    const wrapperKeys = [
      'data',
      'result',
      'results',
      'vehicles',
      'buses',
      'records',
      'rows',
      'items',
    ];
    for (const key of wrapperKeys) {
      if (key in payload) {
        const found = extractArray(payload[key], depth + 1);
        if (found.length > 0) return found;
      }
    }
    if (pick(payload, REG_ALIASES) !== undefined) return [payload];
  }

  return [];
}

/**
 * True for the `" Bus Not Assigned!!! "` answer (a bare JSON string, HTTP 200)
 * and any other non-array body. Distinguishing this from a transport failure is
 * what lets the seeder retry on the previous service date and then skip the
 * route cleanly instead of aborting the run.
 */
export function isUnassignedScheduleResponse(payload: unknown): boolean {
  if (Array.isArray(payload)) return false;
  return extractArray(payload).length === 0;
}

// ============================================================================
// Live feed
// ============================================================================

export interface LiveRecord {
  registrationNumber: string;
  /** The LIVE feed's own route id — CanonicalLiveBus.routeId in the web app. */
  routeId: string | null;
  routeName: string | null;
  routeDescription: string | null;
  status: string | null;
  depotName: string | null;
  vehicleType: string | null;
}

export interface NormalizeLiveResult {
  records: LiveRecord[];
  recordCount: number;
  rejectedRecordCount: number;
}

/**
 * Normalize the live GPS payload to the fields the seeder needs.
 *
 * Unlike the sibling normalizer this does NOT require a valid coordinate: a
 * parked bus with no GPS fix is still a `vehicles` row (vehicle_states.vehicle_id
 * and commands.vehicle_id both FK vehicles(id), and any bus can go Live later).
 * A record is rejected only when it has no usable registration number.
 *
 * Duplicate registrations are merged, preferring the record that actually
 * carries a route assignment — the seeder's only use for a live record beyond
 * the vehicle row is the routename -> route id mapping.
 */
export function normalizeLiveRecords(payload: unknown): NormalizeLiveResult {
  const rows = extractArray(payload);
  const byReg = new Map<string, LiveRecord>();
  let rejected = 0;

  for (const row of rows) {
    if (!isRecord(row)) {
      rejected += 1;
      continue;
    }

    const registrationNumber = toStringOrNull(pick(row, REG_ALIASES));
    if (!registrationNumber) {
      rejected += 1;
      continue;
    }

    const record: LiveRecord = {
      registrationNumber,
      routeId: toStringOrNull(pick(row, LIVE_ROUTE_ID_ALIASES)),
      routeName: toStringOrNull(pick(row, ROUTE_NAME_ALIASES)),
      routeDescription: toStringOrNull(pick(row, ROUTE_DESCRIPTION_ALIASES)),
      status: toStringOrNull(pick(row, STATUS_ALIASES)),
      depotName: toStringOrNull(pick(row, DEPOT_ALIASES)),
      vehicleType: toStringOrNull(pick(row, VEHICLE_TYPE_ALIASES)),
    };

    const existing = byReg.get(registrationNumber);
    if (!existing) {
      byReg.set(registrationNumber, record);
      continue;
    }
    const existingScore = (existing.routeId ? 2 : 0) + (existing.routeName ? 1 : 0);
    const incomingScore = (record.routeId ? 2 : 0) + (record.routeName ? 1 : 0);
    if (incomingScore > existingScore) byReg.set(registrationNumber, record);
  }

  return {
    records: [...byReg.values()],
    recordCount: rows.length,
    rejectedRecordCount: rejected,
  };
}

// ============================================================================
// Schedule feed
// ============================================================================

export interface ScheduleStopRow {
  /** PHYSICAL stop id: String(atco_code). Never suffixed with the sequence. */
  stopId: string;
  name: string;
  /** Upstream stop_sequence, 1-based. Re-sequenced densely from 0 by the harvester. */
  sequence: number;
  latitude: number | null;
  longitude: number | null;
  /** True when upstream gave 0/0 or an out-of-range coordinate. */
  coordinateMissing: boolean;
  /** Wall-clock "HH:MM:SS" — no date, no timezone. */
  scheduledTime: string | null;
}

export interface ScheduleJourney {
  /** vj_id, or a synthesized `seq-split-N` key when vj_id is a sentinel. */
  journeyId: string;
  routeName: string | null;
  routeDescription: string | null;
  /** The SCHEDULE feed's route id. NOT the same space as LiveRecord.routeId. */
  lineId: string | null;
  lineName: string | null;
  vehicleJourneyCode: string | null;
  /** Earliest scheduled_time in the journey; "HH:MM:SS" sorts correctly as text. */
  firstScheduledTime: string | null;
  stops: ScheduleStopRow[];
}

/**
 * Group schedule rows into ALL of the vehicle-day's journeys.
 *
 * Primary key is vj_id: the endpoint answers with every journey the bus runs
 * that day (three to nine is routine) and each journey restarts stop_sequence
 * at 1, so grouping by vj_id is exactly what stops two unrelated services being
 * merged into one fictitious route.
 *
 * Fallback when vj_id is a sentinel: split whenever stop_sequence stops
 * increasing. Same effect, no identifier required.
 *
 * OBSERVED UPSTREAM FACT worth knowing: `line_id` here is the number embedded
 * in RouteName (AKP_1745_ORD_OUT -> 1745), which is NOT the live feed's `route`
 * value for the same RouteName (1919). They are different identifier spaces and
 * they collide numerically. src/seed/harvest.ts resolves routes.id through
 * RouteName against the live inventory for that reason; lineId is carried here
 * only so the harvester can fall back and label the fallback.
 */
export function normalizeScheduleJourneys(payload: unknown): ScheduleJourney[] {
  const rows = extractArray(payload).filter(isRecord);
  if (rows.length === 0) return [];

  const groups = new Map<string, Rec[]>();
  let syntheticIndex = 0;
  let lastSequence = Number.NEGATIVE_INFINITY;
  let syntheticKey = 'seq-split-0';

  for (const row of rows) {
    const explicit = toStringOrNull(pick(row, JOURNEY_ID_ALIASES));
    let key: string;
    if (explicit) {
      key = explicit;
    } else {
      const sequence = toNumber(pick(row, STOP_SEQ_ALIASES));
      if (sequence !== null && sequence <= lastSequence) {
        syntheticIndex += 1;
        syntheticKey = `seq-split-${syntheticIndex}`;
      }
      lastSequence = sequence ?? lastSequence;
      key = syntheticKey;
    }
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  const journeys: ScheduleJourney[] = [];
  for (const [journeyId, journeyRows] of groups) {
    const stops: ScheduleStopRow[] = journeyRows
      .map((row, index) => {
        const lat = toNumber(pick(row, LAT_ALIASES));
        const lng = toNumber(pick(row, LNG_ALIASES));
        const valid = isValidCoordinate(lat, lng);
        const sequence = toNumber(pick(row, STOP_SEQ_ALIASES)) ?? index + 1;
        const stopId = toStringOrNull(pick(row, STOP_ID_ALIASES));
        return {
          stopId: stopId ?? `unknown-${journeyId}-${sequence}`,
          name: toStringOrNull(pick(row, STOP_NAME_ALIASES)) ?? `Stop ${sequence}`,
          sequence,
          latitude: valid ? lat : null,
          longitude: valid ? lng : null,
          coordinateMissing: !valid,
          scheduledTime: toStringOrNull(pick(row, STOP_TIME_ALIASES)),
        } satisfies ScheduleStopRow;
      })
      .sort((a, b) => a.sequence - b.sequence);

    let firstScheduledTime: string | null = null;
    for (const stop of stops) {
      if (stop.scheduledTime && (firstScheduledTime === null || stop.scheduledTime < firstScheduledTime)) {
        firstScheduledTime = stop.scheduledTime;
      }
    }

    const head = journeyRows[0] as Rec;
    journeys.push({
      journeyId,
      routeName: toStringOrNull(pick(head, ROUTE_NAME_ALIASES)),
      routeDescription: toStringOrNull(pick(head, ROUTE_DESCRIPTION_ALIASES)),
      lineId: toStringOrNull(pick(head, SCHEDULE_LINE_ID_ALIASES)),
      lineName: toStringOrNull(pick(head, LINE_NAME_ALIASES)),
      vehicleJourneyCode: toStringOrNull(pick(head, JOURNEY_CODE_ALIASES)),
      firstScheduledTime,
      stops,
    });
  }

  return journeys;
}

// ============================================================================
// Instant parsing
// ============================================================================

/** Asia/Kolkata is UTC+5:30 and has no DST, so a fixed offset is exact here. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Tolerance for a fix stamped slightly ahead of us: unit clock drift plus our
 * own. Anything beyond this is not skew, it is wrong.
 */
const FUTURE_SKEW_TOLERANCE_MS = 120_000;

/**
 * Parse an upstream instant to epoch millis, correcting a timezone defect in
 * the live feed, or return null when the value is unusable.
 *
 * The live feed stamps IST WALL-CLOCK time and labels it `Z`. Measured against
 * the production feed on 2026-08-09 at 06:47 UTC / 12:17 IST: the feed reported
 * `12:16:37Z`, the median record sat +5.44h ahead of real UTC, and 2982 of 9260
 * records landed within 60s of exactly +5h30m. Taking `Z` at face value puts
 * every fix ~5.5 hours in the future, which silently disables three separate
 * guards that all compare `observed_at` against `now()`:
 *
 *   1. mpc/safety.ts's hard staleness filter - `ageSeconds()` goes negative, so
 *      `> staleAfterSeconds` is never true and the controller will happily
 *      authorise a hold computed from arbitrarily old state. That filter is the
 *      blueprint's non-negotiable guardrail, so this is the serious one.
 *   2. GPS_MAX_AGE_SECONDS in the poller - every fix looks fresh, so a stale
 *      one can resurrect a vehicle that has gone dark.
 *   3. The `on conflict ... where observed_at <= excluded.observed_at` guard on
 *      vehicle_states - a badly future-dated row can never be superseded by a
 *      real one. Some units report decades ahead (one was +39 years), which
 *      would lock that vehicle out permanently.
 *
 * Correction: a value reading meaningfully in the future is almost certainly
 * IST mislabelled, so shift it back one IST offset. A genuinely-UTC recent or
 * past value is left untouched, since it never trips the future test. If it is
 * STILL in the future afterwards the unit's own clock is broken, and null is
 * returned so the caller drops the fix rather than poisoning the guards above.
 */
export function parseUpstreamInstant(
  raw: string | null | undefined,
  nowMs: number = Date.now(),
): number | null {
  if (raw === null || raw === undefined) return null;
  const text = typeof raw === 'string' ? raw.trim() : String(raw);
  if (text === '') return null;

  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) return null;

  const ceiling = nowMs + FUTURE_SKEW_TOLERANCE_MS;
  const corrected = parsed > ceiling ? parsed - IST_OFFSET_MS : parsed;

  return corrected > ceiling ? null : corrected;
}
