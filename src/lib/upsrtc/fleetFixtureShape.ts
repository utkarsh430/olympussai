import { deriveFeedNow, normalizeDepotRows } from '@/lib/upsrtc/depotNormalizer';
import { extractArray, isRecord } from '@/lib/upsrtc/normalizer';

/**
 * Pure parts of the full-fleet fixture builder, shared by the build script and
 * its tests so the allowlist exists in exactly one place.
 */

type Rec = Record<string, unknown>;

/**
 * The raw keys `normalizeLivePayload` and `normalizeDepotRows` read (their alias
 * lists plus the keys they read directly). Nothing else is kept, so the fixture
 * carries no field the app does not use. A test fails if a key that suggests a
 * person is ever added here.
 */
export const FLEET_FIXTURE_KEYS: readonly string[] = [
  // registration
  'regNum', 'reg_num', 'registration_no', 'registration_number', 'registrationNo', 'RegNo',
  'bus_id', 'vehicle_no', 'vehicleNumber', 'veh_no', 'bus_no', 'busNumber',
  // position and motion
  'latitude', 'lat', 'Latitude', 'gps_lat', 'gpsLatitude', 'Lat',
  'longitude', 'lng', 'lon', 'long', 'Longitude', 'gps_lng', 'gpsLongitude', 'Lng',
  'speed', 'Speed', 'speed_kmph', 'speedKmph', 'gps_speed',
  'heading', 'Heading', 'bearing', 'course', 'direction_deg',
  // depot, route, service, trip
  'depot_name', 'depotName', 'depot', 'home_depot_name', 'home_depot',
  'route', 'route_id', 'routeId', 'line_id',
  'routename', 'route_name', 'routeName', 'RouteName', 'route_description',
  'vehicle_journey_code', 'service_number', 'serviceNumber', 'line_name',
  'vehicle_journey_id', 'trip_id', 'tripId', 'vj_id',
  'vehicle_type', 'vehicleType', 'service_type', 'bus_type',
  // times
  'timestamp', 'receivedTime', 'gps_timestamp', 'gpsTimestamp', 'time',
  'scheduled_start_time', 'scheduledStartTime', 'trip_start_time',
  'scheduled_end_time', 'actual_start_time', 'delay',
  // device and vehicle status
  'status', 'vehicle_status', 'vehicleStatus', 'packetStatus',
  'ignition', 'mainPowerStatus', 'mainInputVoltage', 'tamperAlert', 'emergencyStatus',
  'distance',
];

const ALLOWED: ReadonlySet<string> = new Set(FLEET_FIXTURE_KEYS);

/** Mirrors the inspector's redaction list: keys that must never reach disk. */
const SENSITIVE_KEYS: readonly string[] = [
  'phone', 'mobile', 'contact', 'driver', 'conductor', 'imei', 'sim', 'password', 'token',
  'apikey', 'api_key', 'systemCodeNumber', 'system_code_number', 'vendorId', 'firmwareVersion',
];

function isSensitive(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEYS.some((sensitive) => lower.includes(sensitive.toLowerCase()));
}

export function stripSensitive(record: Readonly<Rec>): Rec {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !isSensitive(key)));
}

/** Empty values are what `pick` already ignores, so dropping them changes nothing downstream. */
function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || value === '' || value === 'None';
}

export function filterRecord(record: Readonly<Rec>): Rec {
  return Object.fromEntries(
    Object.entries(stripSensitive(record)).filter(
      ([key, value]) => ALLOWED.has(key) && !isEmptyValue(value),
    ),
  );
}

export interface FleetFixtureCounts {
  readonly records: number;
  readonly depots: number;
  readonly routes: number;
  /** The feed time the fixture freezes. */
  readonly feedNow: string | null;
}

export interface FleetFixture {
  readonly records: readonly Rec[];
  readonly counts: FleetFixtureCounts;
}

export function buildFleetFixture(payload: unknown): FleetFixture {
  const records = extractArray(payload).filter(isRecord).map(filterRecord);
  if (records.length === 0) throw new Error('The payload held no usable records');
  const { rows } = normalizeDepotRows(records);
  const distinct = (values: readonly (string | null)[]): number =>
    new Set(values.filter((value): value is string => value !== null)).size;
  return {
    records,
    counts: {
      records: records.length,
      depots: distinct(rows.map((row) => row.depotName)),
      routes: distinct(rows.map((row) => row.routeName)),
      feedNow: deriveFeedNow(rows),
    },
  };
}
