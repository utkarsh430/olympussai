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
 * How far a receive time may lie past the fetch time (read in Indian time)
 * and still set the feed clock: the server's own clock may be a little slow.
 */
export const FEED_CLOCK_MAX_LEAD_MIN = 5;
/** Upstream writes Indian-time digits and stamps them `Z`. */
const FEED_IST_OFFSET_MIN = 330;
const MS_PER_MINUTE = 60_000;

/** The feed clock, and how many rows were stamped too far ahead of the fetch to set it. */
export interface FeedClock {
  readonly feedNow: string | null;
  /** Rows whose receive time is later than the fetch allows: ignored for the clock. */
  readonly aheadRows: number;
}

/**
 * The feed's own clock (ruling S56a): the newest `receivedAt` not later than
 * the fetch time read in Indian time plus FEED_CLOCK_MAX_LEAD_MIN. A future
 * stamp (an Indian time converted twice, a garbage year) is the only way one
 * row can move the clock, and the fetch bounds the future without looking at
 * how many buses report, so a night feed with a few buses still advances.
 * Later rows are ignored for the clock only (their own age is measured against
 * it as before) and counted in `aheadRows`. Rows older than the fetch are never
 * rejected, so a recorded fixture keeps its own clock. Unparseable times are
 * skipped; null when no row carries one. Pure: the fetch time is passed in.
 * The frame assumes every stamp carries `Z` (all do today): `parseTimestamp` reads one
 * without it in the server's local zone, which would silently shift the comparison.
 */
export function deriveFeedClock(rows: readonly DepotBusRow[], fetchedAtMs: number): FeedClock {
  const ceilingMs = fetchedAtMs + (FEED_IST_OFFSET_MIN + FEED_CLOCK_MAX_LEAD_MIN) * MS_PER_MINUTE;
  let newest: { readonly iso: string; readonly ms: number } | null = null;
  let aheadRows = 0;
  for (const { receivedAt } of rows) {
    const ms = receivedAt === null ? Number.NaN : Date.parse(receivedAt);
    if (receivedAt === null || Number.isNaN(ms)) continue;
    if (ms > ceilingMs) aheadRows += 1;
    else if (newest === null || ms > newest.ms) newest = { iso: receivedAt, ms };
  }
  return { feedNow: newest?.iso ?? null, aheadRows };
}

/**
 * `deriveFeedClock(...).feedNow`. Every server caller passes its fetch time;
 * only recorded rows with no fetch (tests) omit it, and then nothing can be
 * later than the fetch, so the newest receive time is the clock.
 */
export function deriveFeedNow(rows: readonly DepotBusRow[], fetchedAtMs?: number): string | null {
  return deriveFeedClock(rows, fetchedAtMs ?? Number.POSITIVE_INFINITY).feedNow;
}
