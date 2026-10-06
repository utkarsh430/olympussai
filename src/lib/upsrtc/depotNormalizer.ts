import {
  LAT_ALIASES,
  LNG_ALIASES,
  REG_ALIASES,
  ROUTE_ID_ALIASES,
  ROUTE_NAME_ALIASES,
  SPEED_ALIASES,
  TRIP_ALIASES,
  extractArray,
  isRecord,
  isValidCoordinate,
  parseTimestamp,
  pick,
  toBooleanOrNull,
  toNumber,
  toStringOrNull,
} from '@/lib/upsrtc/normalizer';
import { depotVehicleStatusSchema } from '@/models/depotLive';
import type { DepotBusRow, DepotVehicleStatus } from '@/models/depotLive';

/**
 * Depot projection of the live payload. Unlike `normalizeLivePayload` it keeps
 * buses with no GPS fix (a depot still owns them) and carries the fleet-health
 * fields the map projection discards. It is a pure function of the payload.
 */

type Rec = Record<string, unknown>;

export interface NormalizeDepotResult {
  rows: DepotBusRow[];
  recordCount: number;
  /** Non-records and rows without a registration. */
  rejectedRecordCount: number;
}

const DEPOT_ID_PATTERN = /^\d{1,6}$/;

function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function toDepotId(value: unknown): string | null {
  const text = toStringOrNull(value);
  return text !== null && DEPOT_ID_PATTERN.test(text) ? text : null;
}

/** `vehicle_status` only. The separate `status` field is a different vocabulary. */
function toVehicleStatus(value: unknown): DepotVehicleStatus {
  const text = toStringOrNull(value)?.toLowerCase();
  const parsed = depotVehicleStatusSchema.safeParse(text);
  return parsed.success ? parsed.data : 'unknown';
}

function toRoundedNumber(value: unknown): number | null {
  const parsed = toNumber(value);
  return parsed === null ? null : roundOneDecimal(parsed);
}

function toRow(raw: Rec, registrationNumber: string): DepotBusRow {
  const latitude = toNumber(pick(raw, LAT_ALIASES));
  const longitude = toNumber(pick(raw, LNG_ALIASES));
  const hasFix = isValidCoordinate(latitude, longitude);
  const speed = toNumber(pick(raw, SPEED_ALIASES));

  return {
    registrationNumber,
    latitude: hasFix ? latitude : null,
    longitude: hasFix ? longitude : null,
    speedKmph: speed === null ? null : Math.max(0, roundOneDecimal(speed)),
    ignitionOn: toBooleanOrNull(raw['ignition']),
    gpsTimestamp: parseTimestamp(pick(raw, ['timestamp'])),
    receivedAt: parseTimestamp(pick(raw, ['receivedTime'])),
    depotId: toDepotId(pick(raw, ['home_depot'])),
    depotName: toStringOrNull(pick(raw, ['depot_name'])),
    vehicleStatus: toVehicleStatus(pick(raw, ['vehicle_status'])),
    tripStatus: toStringOrNull(pick(raw, ['status'])),
    routeId: toStringOrNull(pick(raw, ROUTE_ID_ALIASES)),
    routeName: toStringOrNull(pick(raw, ROUTE_NAME_ALIASES)),
    routeDescription: toStringOrNull(pick(raw, ['route_description'])),
    journeyId: toStringOrNull(pick(raw, TRIP_ALIASES)),
    journeyCode: toStringOrNull(pick(raw, ['vehicle_journey_code'])),
    scheduledStart: parseTimestamp(pick(raw, ['scheduled_start_time'])),
    scheduledEnd: parseTimestamp(pick(raw, ['scheduled_end_time'])),
    actualStart: parseTimestamp(pick(raw, ['actual_start_time'])),
    delayMinutes: toRoundedNumber(pick(raw, ['delay'])),
    odometerRaw: toNumber(pick(raw, ['distance'])),
    mainPowerOn: toBooleanOrNull(raw['mainPowerStatus']),
    mainVoltage: toNumber(pick(raw, ['mainInputVoltage'])),
    tamperCode: toStringOrNull(pick(raw, ['tamperAlert'])),
    emergency: toBooleanOrNull(raw['emergencyStatus']),
  };
}

function gpsTime(row: DepotBusRow): number {
  return row.gpsTimestamp ? Date.parse(row.gpsTimestamp) : -Infinity;
}

export function normalizeDepotRows(payload: unknown): NormalizeDepotResult {
  const records = extractArray(payload);
  const byReg = new Map<string, DepotBusRow>();
  let rejected = 0;

  for (const record of records) {
    const registrationNumber = isRecord(record) ? toStringOrNull(pick(record, REG_ALIASES)) : null;
    if (!isRecord(record) || !registrationNumber) {
      rejected += 1;
      continue;
    }

    const row = toRow(record, registrationNumber);
    // Duplicate registrations: newest GPS timestamp wins, as in normalizeLivePayload.
    const existing = byReg.get(registrationNumber);
    if (!existing || gpsTime(row) > gpsTime(existing)) byReg.set(registrationNumber, row);
  }

  return {
    rows: [...byReg.values()],
    recordCount: records.length,
    rejectedRecordCount: rejected,
  };
}

/** Newest `receivedAt` across the rows, or null when none carries one. */
export function deriveFeedNow(rows: readonly DepotBusRow[]): string | null {
  let newest: string | null = null;
  let newestTime = -Infinity;
  for (const row of rows) {
    if (!row.receivedAt) continue;
    const time = Date.parse(row.receivedAt);
    if (time > newestTime) {
      newestTime = time;
      newest = row.receivedAt;
    }
  }
  return newest;
}
