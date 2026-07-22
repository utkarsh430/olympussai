import type {
  CanonicalLiveBus,
  CanonicalSchedule,
  CanonicalStop,
  DataQuality,
} from '@/models/canonical';

/**
 * Alias-tolerant normalization for the undocumented UPSRTC upstream feeds.
 *
 * The upstream schema was discovered empirically (see docs/API_DISCOVERY.md).
 * We deliberately accept a broad set of aliases so that an upstream rename does
 * not black out the control room.
 */

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
const SPEED_ALIASES = ['speed', 'Speed', 'speed_kmph', 'speedKmph', 'gps_speed'] as const;
const HEADING_ALIASES = ['heading', 'Heading', 'bearing', 'course', 'direction_deg'] as const;
const DEPOT_ALIASES = ['depot_name', 'depotName', 'depot', 'home_depot_name'] as const;
const ROUTE_ID_ALIASES = ['route', 'route_id', 'routeId', 'line_id'] as const;
const ROUTE_NAME_ALIASES = ['routename', 'route_name', 'routeName', 'RouteName'] as const;
const SERVICE_ALIASES = ['vehicle_journey_code', 'service_number', 'serviceNumber', 'line_name'] as const;
const TRIP_ALIASES = ['vehicle_journey_id', 'trip_id', 'tripId', 'vj_id'] as const;
const TIMESTAMP_ALIASES = ['timestamp', 'receivedTime', 'gps_timestamp', 'gpsTimestamp', 'time'] as const;
const STATUS_ALIASES = ['status', 'vehicle_status', 'vehicleStatus', 'packetStatus'] as const;
const VEHICLE_TYPE_ALIASES = ['vehicle_type', 'vehicleType', 'service_type', 'bus_type'] as const;
const TRIP_START_ALIASES = [
  'scheduled_start_time',
  'scheduledStartTime',
  'trip_start_time',
] as const;

type Rec = Record<string, unknown>;

export function isRecord(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Pick the first alias present with a meaningful (non-empty, non-"None") value. */
function pick(rec: Rec, aliases: readonly string[]): unknown {
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

function toStringOrNull(value: unknown): string | null {
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
  // Reject exact zero-zero (null island) - a common GPS "no fix" sentinel.
  if (lat === 0 && lng === 0) return false;
  return true;
}

function parseTimestamp(value: unknown): string | null {
  const raw = toStringOrNull(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

/** Age-based data quality classification. */
export function classifyDataQuality(gpsTimestamp: string | null, now: number = Date.now()): DataQuality {
  if (!gpsTimestamp) return 'stale';
  const ts = new Date(gpsTimestamp).getTime();
  if (Number.isNaN(ts)) return 'stale';
  const ageMinutes = (now - ts) / 60_000;
  if (ageMinutes <= 5) return 'good';
  if (ageMinutes <= 30) return 'degraded';
  return 'stale';
}

/**
 * Operating date of the vehicle's current assignment, as YYYY-MM-DD.
 *
 * Upstream stamps scheduled_start_time with a Z suffix but the value is already
 * IST, so the date part is taken literally rather than through Date — parsing
 * it would slide an early-morning departure back onto the previous day.
 */
export function extractTripDate(value: unknown): string | null {
  const raw = toStringOrNull(value);
  if (!raw) return null;
  return /^(\d{4}-\d{2}-\d{2})/.exec(raw)?.[1] ?? null;
}

function toBooleanOrNull(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (['1', 'true', 'on', 'yes'].includes(v)) return true;
    if (['0', 'false', 'off', 'no'].includes(v)) return false;
  }
  return null;
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
    const wrapperKeys = ['data', 'result', 'results', 'vehicles', 'buses', 'records', 'rows', 'items'];
    for (const key of wrapperKeys) {
      if (key in payload) {
        const found = extractArray(payload[key], depth + 1);
        if (found.length > 0) return found;
      }
    }
    // Single object that looks like a record
    if (pick(payload, REG_ALIASES) !== undefined) return [payload];
  }

  return [];
}

export interface NormalizeLiveResult {
  buses: CanonicalLiveBus[];
  recordCount: number;
  rejectedRecordCount: number;
}

/** Normalize the live GPS payload into canonical buses. */
export function normalizeLivePayload(payload: unknown, now: number = Date.now()): NormalizeLiveResult {
  const rows = extractArray(payload);
  const byReg = new Map<string, CanonicalLiveBus>();
  let rejected = 0;

  for (const row of rows) {
    if (!isRecord(row)) {
      rejected += 1;
      continue;
    }

    const registrationNumber = toStringOrNull(pick(row, REG_ALIASES));
    const latitude = toNumber(pick(row, LAT_ALIASES));
    const longitude = toNumber(pick(row, LNG_ALIASES));

    if (!registrationNumber || !isValidCoordinate(latitude, longitude)) {
      rejected += 1;
      continue;
    }

    const gpsTimestamp = parseTimestamp(pick(row, TIMESTAMP_ALIASES));
    const speed = toNumber(pick(row, SPEED_ALIASES));

    const bus: CanonicalLiveBus = {
      id: registrationNumber,
      registrationNumber,
      latitude: latitude as number,
      longitude: longitude as number,
      speedKmph: speed === null ? null : Math.max(0, Math.round(speed * 10) / 10),
      headingDegrees: (() => {
        const h = toNumber(pick(row, HEADING_ALIASES));
        if (h === null) return null;
        return ((h % 360) + 360) % 360;
      })(),
      depotName: toStringOrNull(pick(row, DEPOT_ALIASES)),
      routeId: toStringOrNull(pick(row, ROUTE_ID_ALIASES)),
      routeName: toStringOrNull(pick(row, ROUTE_NAME_ALIASES)),
      serviceNumber: toStringOrNull(pick(row, SERVICE_ALIASES)),
      tripId: toStringOrNull(pick(row, TRIP_ALIASES)),
      vehicleType: toStringOrNull(pick(row, VEHICLE_TYPE_ALIASES)),
      gpsTimestamp,
      lastUpdatedAt: new Date(now).toISOString(),
      // A vehicle reporting road speed is running, whatever the ignition line
      // says: a good number of VLT units report ignition 0 while the bus is
      // plainly in motion, and showing OFF beside a live speed reads as a bug
      // to the control room. Speed is only allowed to force ON, never OFF —
      // a stationary bus idling at a stand still reports ignition honestly.
      ignitionOn: speed !== null && speed > 0 ? true : toBooleanOrNull(row['ignition']),
      rawStatus: toStringOrNull(pick(row, STATUS_ALIASES)),
      tripDate: extractTripDate(pick(row, TRIP_START_ALIASES)),
      dataQuality: classifyDataQuality(gpsTimestamp, now),
    };

    // Merge duplicate registrations, keeping the most recent GPS timestamp.
    const existing = byReg.get(registrationNumber);
    if (existing) {
      const existingTs = existing.gpsTimestamp ? Date.parse(existing.gpsTimestamp) : -Infinity;
      const incomingTs = bus.gpsTimestamp ? Date.parse(bus.gpsTimestamp) : -Infinity;
      if (incomingTs > existingTs) byReg.set(registrationNumber, bus);
    } else {
      byReg.set(registrationNumber, bus);
    }
  }

  return {
    buses: [...byReg.values()],
    recordCount: rows.length,
    rejectedRecordCount: rejected,
  };
}

const STOP_NAME_ALIASES = ['stop_name', 'stopName', 'platform_name', 'name'] as const;
const STOP_SEQ_ALIASES = ['stop_sequence', 'sequence', 'seq', 'stopSequence'] as const;
const STOP_ID_ALIASES = ['atco_code', 'stop_id', 'stopId', 'code'] as const;
const STOP_TIME_ALIASES = ['scheduled_time', 'scheduledTime', 'arrival_time', 'eta'] as const;

/**
 * Group rows by vehicle journey.
 *
 * The endpoint answers with every journey the bus runs that day, not the one it
 * is currently on — nine trips in a single response is normal — and each trip
 * restarts stop_sequence at 1.
 */
function groupByTrip(rows: Rec[]): Map<string, Rec[]> {
  const trips = new Map<string, Rec[]>();
  for (const row of rows) {
    const key = toStringOrNull(pick(row, TRIP_ALIASES)) ?? 'unknown';
    const bucket = trips.get(key);
    if (bucket) bucket.push(row);
    else trips.set(key, [row]);
  }
  return trips;
}

/** Earliest scheduled time in a trip. HH:MM:SS strings order correctly as text. */
function firstScheduledTime(rows: Rec[]): string {
  let earliest = '99:99:99';
  for (const row of rows) {
    const time = toStringOrNull(pick(row, STOP_TIME_ALIASES));
    if (time && time < earliest) earliest = time;
  }
  return earliest;
}

/**
 * Pick the journey the bus is actually running.
 *
 * The live feed's vehicle_journey_id identifies it exactly and joins to vj_id
 * here. Without that hint the earliest-departing trip is used, which is at
 * least stable rather than dependent on upstream row order.
 */
function selectTrip(trips: Map<string, Rec[]>, preferredTripId?: string | null): Rec[] | null {
  if (preferredTripId) {
    const match = trips.get(preferredTripId);
    if (match) return match;
  }

  let earliest: { rows: Rec[]; time: string } | null = null;
  for (const rows of trips.values()) {
    const time = firstScheduledTime(rows);
    if (!earliest || time < earliest.time) earliest = { rows, time };
  }
  return earliest?.rows ?? null;
}

/**
 * Normalize the schedule payload down to the single journey being run.
 *
 * IMPORTANT upstream quirk: when a bus has no assignment for the requested
 * date the endpoint returns a bare JSON *string* (e.g. `" Bus Not Assigned!!! "`)
 * with HTTP 200 rather than an error. extractArray yields [] for that shape,
 * so we surface it as "no schedule found" rather than a crash.
 *
 * The second quirk is the multi-trip response described on groupByTrip. Merging
 * those trips yields a fictitious journey whose origin and destination come
 * from two unrelated services — often reversed — so exactly one trip is kept.
 */
export function normalizeSchedulePayload(
  payload: unknown,
  registrationNumber: string,
  date: string,
  preferredTripId?: string | null,
): CanonicalSchedule | null {
  const allRows = extractArray(payload).filter(isRecord);
  if (allRows.length === 0) return null;

  const trips = groupByTrip(allRows);
  const rows = selectTrip(trips, preferredTripId);
  if (!rows || rows.length === 0) return null;

  const stops: CanonicalStop[] = rows
    .map((row, index) => {
      const lat = toNumber(pick(row, LAT_ALIASES));
      const lng = toNumber(pick(row, LNG_ALIASES));
      const coordsValid = isValidCoordinate(lat, lng);
      const sequence = toNumber(pick(row, STOP_SEQ_ALIASES)) ?? index + 1;
      const scheduled = toStringOrNull(pick(row, STOP_TIME_ALIASES));
      const id = toStringOrNull(pick(row, STOP_ID_ALIASES)) ?? `stop-${sequence}`;

      return {
        id: `${id}-${sequence}`,
        name: toStringOrNull(pick(row, STOP_NAME_ALIASES)) ?? `Stop ${sequence}`,
        sequence,
        // Upstream emits 0.0/0.0 for stops with no surveyed position.
        latitude: coordsValid ? lat : null,
        longitude: coordsValid ? lng : null,
        scheduledArrival: scheduled,
        scheduledDeparture: scheduled,
      };
    })
    .sort((a, b) => a.sequence - b.sequence);

  // Upstream can still repeat an (atco_code, stop_sequence) pair inside a single
  // journey. These ids are used as React keys, so any collision has to be broken.
  const idCounts = new Map<string, number>();
  for (const stop of stops) {
    const seen = idCounts.get(stop.id) ?? 0;
    idCounts.set(stop.id, seen + 1);
    if (seen > 0) stop.id = `${stop.id}#${seen + 1}`;
  }

  const first = rows[0] as Rec;
  const firstStop = stops[0];
  const lastStop = stops[stops.length - 1];

  const routeDescription = toStringOrNull(first['route_description']);
  let originName = firstStop?.name ?? null;
  let destinationName = lastStop?.name ?? null;

  // "A TO B VIA C" descriptions give better origin/destination labels.
  if (routeDescription && / TO /i.test(routeDescription)) {
    const [origin, rest] = routeDescription.split(/ TO /i);
    if (origin) originName = origin.trim();
    if (rest) destinationName = rest.split(/ VIA /i)[0]?.trim() ?? destinationName;
  }

  const routeName = toStringOrNull(pick(first, ROUTE_NAME_ALIASES));

  return {
    registrationNumber,
    date,
    routeId: toStringOrNull(pick(first, ROUTE_ID_ALIASES)),
    routeName,
    originName,
    destinationName,
    tripId: toStringOrNull(pick(first, TRIP_ALIASES)),
    scheduledDeparture: firstStop?.scheduledDeparture ?? null,
    scheduledArrival: lastStop?.scheduledArrival ?? null,
    // Upstream encodes direction as the _IN / _OUT suffix on the route name.
    direction: routeName?.endsWith('_IN') ? 'IN' : routeName?.endsWith('_OUT') ? 'OUT' : null,
    tripCount: trips.size,
    stops,
  };
}
