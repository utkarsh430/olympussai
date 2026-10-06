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
  /** Non-records and rows without a usable registration. */
  rejectedRecordCount: number;
}

const DEPOT_ID_PATTERN = /^\d{1,6}$/;

/**
 * The longest text a row's field may carry. The feed's longest real field (a route
 * description) is well under half of it; a longer value is garbage, and would be carried
 * into every map key, list and response that names the bus, so the field is dropped (the
 * row is refused when it is the registration) rather than cut to a value nobody sent.
 */
export const MAX_ROW_TEXT_CHARS = 128;

function toText(value: unknown): string | null {
  const text = toStringOrNull(value);
  return text !== null && text.length <= MAX_ROW_TEXT_CHARS ? text : null;
}

/** One spelling per bus: `up77an2509` and `UP77AN2509` are the same registration. */
function toRegistration(value: unknown): string | null {
  return toText(value)?.toUpperCase() ?? null;
}

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
    depotName: toText(pick(raw, ['depot_name'])),
    vehicleStatus: toVehicleStatus(pick(raw, ['vehicle_status'])),
    tripStatus: toText(pick(raw, ['status'])),
    routeId: toText(pick(raw, ROUTE_ID_ALIASES)),
    routeName: toText(pick(raw, ROUTE_NAME_ALIASES)),
    routeDescription: toText(pick(raw, ['route_description'])),
    journeyId: toText(pick(raw, TRIP_ALIASES)),
    journeyCode: toText(pick(raw, ['vehicle_journey_code'])),
    scheduledStart: parseTimestamp(pick(raw, ['scheduled_start_time'])),
    scheduledEnd: parseTimestamp(pick(raw, ['scheduled_end_time'])),
    actualStart: parseTimestamp(pick(raw, ['actual_start_time'])),
    delayMinutes: toRoundedNumber(pick(raw, ['delay'])),
    odometerRaw: toNumber(pick(raw, ['distance'])),
    mainPowerOn: toBooleanOrNull(raw['mainPowerStatus']),
    mainVoltage: toNumber(pick(raw, ['mainInputVoltage'])),
    tamperCode: toText(pick(raw, ['tamperAlert'])),
    emergency: toBooleanOrNull(raw['emergencyStatus']),
  };
}

/**
 * The time fields the map projection (`normalizeLivePayload`) reads, in its order. Repeated
 * registrations are decided by the same time, so both projections keep the same row.
 */
const MAP_TIME_ALIASES = ['timestamp', 'receivedTime', 'gps_timestamp', 'gpsTimestamp', 'time'];

interface Candidate {
  readonly row: DepotBusRow;
  readonly hasFix: boolean;
  readonly timeMs: number;
}

function toCandidate(raw: Rec, row: DepotBusRow): Candidate {
  const time = parseTimestamp(pick(raw, MAP_TIME_ALIASES));
  return {
    row,
    hasFix: row.latitude !== null && row.longitude !== null,
    timeMs: time === null ? -Infinity : Date.parse(time),
  };
}

/**
 * The map keeps, among a registration's rows with a fix, the newest by its time, and the
 * first on a tie; it never shows a row without a fix. So a row with a fix always beats
 * one without, and otherwise only a strictly newer row replaces the one kept: the depot
 * pages count the bus under the depot of the row whose pin the map shows. A bus with no
 * fix in any row keeps its newest row in the same way.
 */
function replaces(incoming: Candidate, kept: Candidate): boolean {
  if (incoming.hasFix !== kept.hasFix) return incoming.hasFix;
  return incoming.timeMs > kept.timeMs;
}

export function normalizeDepotRows(payload: unknown): NormalizeDepotResult {
  const records = extractArray(payload);
  const byReg = new Map<string, Candidate>();
  let rejected = 0;

  for (const record of records) {
    const registrationNumber = isRecord(record) ? toRegistration(pick(record, REG_ALIASES)) : null;
    if (!isRecord(record) || !registrationNumber) {
      rejected += 1;
      continue;
    }

    const candidate = toCandidate(record, toRow(record, registrationNumber));
    const kept = byReg.get(registrationNumber);
    if (!kept || replaces(candidate, kept)) byReg.set(registrationNumber, candidate);
  }

  return {
    rows: [...byReg.values()].map((candidate) => candidate.row),
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
 * The feed's own clock: the newest `receivedAt` not later than
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
