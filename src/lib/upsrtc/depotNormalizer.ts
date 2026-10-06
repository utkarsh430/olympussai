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
  readonly rows: readonly DepotBusRow[];
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

/**
 * How far the feed clock may run ahead of the snapshot's 99th-percentile
 * receive time. Upstream already sends IST values stamped Z (+5:30) and the
 * odd garbage year; one such row must not move the whole module's clock.
 */
export const FEED_CLOCK_MAX_LEAD_MIN = 10;
const FEED_CLOCK_PERCENTILE = 0.99;
const MS_PER_MINUTE = 60_000;

/**
 * The feed's own clock (ruling S50a): the newest `receivedAt` that is no more
 * than FEED_CLOCK_MAX_LEAD_MIN ahead of the 99th-percentile receive time
 * (nearest rank, so with fewer than 100 rows that is the newest row and the
 * clock is simply the newest time). Rows beyond the lead are ignored for the
 * clock only; their own age is still measured against it. Null when no row
 * carries a usable receive time. No wall clock is read.
 */
export function deriveFeedNow(rows: readonly DepotBusRow[], fetchedAtMs?: number): string | null {
  return deriveFeedClock(rows, fetchedAtMs ?? Number.POSITIVE_INFINITY).feedNow;
}

/** The feed clock, and how many rows were stamped too far ahead of the fetch to set it. */
export interface FeedClock {
  readonly feedNow: string | null;
  readonly aheadRows: number;
}

/** Stub: the S50a rule until S56a lands. */
export function deriveFeedClock(rows: readonly DepotBusRow[], fetchedAtMs: number): FeedClock {
  return { feedNow: Number.isNaN(fetchedAtMs) ? null : percentileClock(rows), aheadRows: 0 };
}

function percentileClock(rows: readonly DepotBusRow[]): string | null {
  const timed = rows
    .filter((row): row is DepotBusRow & { receivedAt: string } => Boolean(row.receivedAt))
    .map((row) => ({ iso: row.receivedAt, ms: Date.parse(row.receivedAt) }))
    .filter(({ ms }) => !Number.isNaN(ms))
    .sort((a, b) => a.ms - b.ms);
  const percentile = timed[Math.ceil(FEED_CLOCK_PERCENTILE * timed.length) - 1];
  if (percentile === undefined) return null;
  const ceilingMs = percentile.ms + FEED_CLOCK_MAX_LEAD_MIN * MS_PER_MINUTE;
  const accepted = timed.filter(({ ms }) => ms <= ceilingMs);
  return accepted[accepted.length - 1]?.iso ?? null;
}
