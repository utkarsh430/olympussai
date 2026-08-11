// getStaticData.php — the UPSRTC TIMETABLE endpoint, and the only upstream
// source that publishes how often a route is actually SERVED.
//
// WHY THIS MODULE EXISTS.
//
// Headway is a property of how frequently a route-direction is served. It
// cannot be inferred from one bus: a single vehicle running a line twice a day
// says nothing about how many vehicles serve it. Until this endpoint was found,
// the seeder had only getGpsLiveData (which buses are running right now) and
// getScheduledBusInfo (one vehicle's day), so target_headway_seconds (H*) —
// the denominator of every threshold in src/headway/ — was either estimated
// from one probed vehicle or, for 435 of 656 seeded route-directions, simply
// fabricated as 1,800s. A fabricated H* produces SILENCE, not an error: the
// route is quietly excluded from bunching detection forever.
//
// getStaticData publishes the departure board for a stop area: every vehicle
// journey calling there in roughly the next 24 hours, with its line, its
// EXPLICIT direction, and its scheduled arrival/departure. That is a timetable,
// and gaps between successive departures of one line-direction at one stop are
// a real measured headway.
//
// ---------------------------------------------------------------------------
// WHAT IT RETURNS (measured 2026-08-10 over all valid stop codes, not assumed)
// ---------------------------------------------------------------------------
//   GET .../libis_upsrtc/php/getStaticData.php?stop_code=N&plate_code=&lang_id=eng&_=<ms>
//
// 14,935 rows across the 22 populated stop codes; 1,886 distinct route_names,
// 1,174 distinct line_ids, 1,186 distinct (line_id, direction) pairs. One row =
// one journey calling at one stop area:
//
//   {"stop_area_code":8,"stop_area_name":"HARCHANDPUR","plate_code":"A",
//    "stop_sequence":8,"service_type":"ACX","service_type_name":"JANRATH 2X3",
//    "route_name":"CBG_327_ACX_OUT","route_origin":"CHB","route_destination":"CKT",
//    "route_desc":"CHARBAGH TO CHITRAKOOT VIA RAEBARELI","line_id":327,
//    "line_name":"327","line_direction":"Outbound",
//    "line_directional_desc":"CHARBAGH TO CHITRAKOOT VIA RAEBARELI","vj_id":1565,
//    "garage_name":"CHARBAGH","sta":"2026-08-10T09:13:20Z",
//    "std":"2026-08-10T09:13:20Z","reg_num":null}
//
// Upstream quirks it shares with its siblings, handled by reusing their code:
//   * Advertises `Content-Type: text/html` while returning JSON — so the body
//     is text-then-JSON.parse'd via fetchUpstream, never res.json()'d.
//   * A leading `<` is an HTML error page, not data.
//   * An unpopulated stop code answers HTTP 200 with a two-byte `[]`. That is a
//     normal answer, not a failure — codes 16 and 23 do it permanently.
//
// ---------------------------------------------------------------------------
// THREE THINGS THAT ARE NOT TRUE OF THIS ENDPOINT, AND COST REAL TIME TO LEARN
// ---------------------------------------------------------------------------
//
// 1. `sta` / `std` ARE `Z`-SUFFIXED BUT ARE IST WALL-CLOCK. Same defect as the
//    live feed (see normalize.ts#parseUpstreamInstant). Reading the `Z` at face
//    value shifts every departure by 5.5 hours.
//
//    parseUpstreamInstant CANNOT be reused here, and that is not an oversight.
//    It corrects the defect by detecting a value in the FUTURE and shifting it
//    back one IST offset, then returns null if it is still in the future. Every
//    timetable stamp is a scheduled departure in the next ~24 hours, i.e.
//    legitimately in the future — measured, it returns null for 100% of them.
//    So the correct conversion here is the one liveScheduledStartSeconds
//    already uses in src/seed/harvest.ts for exactly the same reason: read ONLY
//    the clock components and never apply an offset. A headway is a difference
//    between two times in one frame, so the frame's label is irrelevant as long
//    as it is never "corrected" into a different one.
//
// 2. THERE ARE NO COORDINATES. The full field list is above and there is no
//    lat/lon, so route_shapes.geom and stops.geom must still come from
//    getScheduledBusInfo. This endpoint replaces the seeder's source of route
//    IDENTITY, DIRECTION and HEADWAY only.
//
// 3. `stop_area_code` IS NOT `atco_code`, EVEN WHERE BOTH ARE SMALL INTEGERS.
//    MEASURED, and this is the trap: getScheduledBusInfo also emits low
//    integers for hub stops (atco_code 1 = ALAMBAGH), so the two spaces look
//    joinable and are not. stop_area_code 8 is HARCHANDPUR; atco_code 8 is
//    PRAYAGRAJ CIVIL LINES. Of the 22 stop areas, exactly ONE (code 1) has the
//    same name under both. A numeric join would silently mis-place 21 of 22 hub
//    stops and corrupt every shape that touches them.
//
//    Nothing in the seeder performs that join. The join that is actually needed
//    — timetable row to harvested route-direction — is on `line_id` and
//    `route_name`, which BOTH endpoints publish in the same form
//    (getScheduledBusInfo calls the latter `RouteName`). See
//    src/seed/timetable.ts.

import { fetchUpstream, type UpstreamFetchResult } from './client.js';
import { extractArray, isRecord, pick, toNumber, toStringOrNull } from './normalize.js';

export const UPSRTC_STATIC_DATA_URL =
  process.env.UPSRTC_STATIC_DATA_URL ??
  'https://margdarshi.upsrtcvlt.com/libis_upsrtc/php/getStaticData.php';

/**
 * Per-stop responses run to ~1.8 MB. Generous enough for the largest, far below
 * the live feed's budget because there are 24 of these rather than one.
 */
export const STATIC_DATA_REQUEST_TIMEOUT_MS = 60_000;

/**
 * The endpoint's entire valid `stop_code` domain.
 *
 * MEASURED by scanning: 1-24 inclusive is the whole populated range, of which
 * 22 return data (16 and 23 return a two-byte `[]`). 25, 26, 27, 28, 29, 30,
 * 32, 35, 41, 45, 60, 75, 100, 120, 150, 200 and 300 were all probed and all
 * come back empty, so there is nothing above 24 to find. Codes are enumerated
 * rather than discovered at runtime because the endpoint gives no index and an
 * open-ended scan would hammer a shared PHP host on every seed run.
 */
export const STATIC_DATA_STOP_CODES: readonly number[] = Array.from(
  { length: 24 },
  (_value, index) => index + 1,
);

const STOP_AREA_CODE_ALIASES = ['stop_area_code', 'stopAreaCode'] as const;
const STOP_AREA_NAME_ALIASES = ['stop_area_name', 'stopAreaName'] as const;
const STOP_SEQUENCE_ALIASES = ['stop_sequence', 'stopSequence', 'sequence'] as const;
const LINE_ID_ALIASES = ['line_id', 'lineId'] as const;
const LINE_NAME_ALIASES = ['line_name', 'lineName'] as const;
const LINE_DIRECTION_ALIASES = ['line_direction', 'lineDirection'] as const;
const LINE_DIRECTIONAL_DESC_ALIASES = ['line_directional_desc', 'lineDirectionalDesc'] as const;
// `RouteName` is getScheduledBusInfo's spelling of the same value; accepting it
// here is what lets a saved corpus from either endpoint round-trip.
const ROUTE_NAME_ALIASES = ['route_name', 'routeName', 'RouteName'] as const;
const ROUTE_DESC_ALIASES = ['route_desc', 'route_description', 'routeDescription'] as const;
const JOURNEY_ID_ALIASES = ['vj_id', 'vehicle_journey_id', 'tripId'] as const;
const SERVICE_TYPE_ALIASES = ['service_type', 'serviceType'] as const;
const SERVICE_TYPE_NAME_ALIASES = ['service_type_name', 'serviceTypeName'] as const;
const GARAGE_ALIASES = ['garage_name', 'garageName'] as const;
const DEPARTURE_ALIASES = ['std', 'scheduled_departure', 'departure_time'] as const;
const ARRIVAL_ALIASES = ['sta', 'scheduled_arrival', 'arrival_time'] as const;

/** Direction codes route_directions.direction_code is seeded with. */
export type TimetableDirectionCode = 'IN' | 'OUT';

/**
 * One journey calling at one stop area, normalized.
 *
 * `departureSecondsOfDay` / `arrivalSecondsOfDay` are SECONDS SINCE MIDNIGHT in
 * the upstream's own (IST) frame — deliberately not instants. See the module
 * header, point 1.
 */
export interface TimetableRow {
  stopAreaCode: number;
  stopAreaName: string | null;
  stopSequence: number | null;
  routeName: string | null;
  routeDescription: string | null;
  lineId: string | null;
  lineName: string | null;
  /** 'Outbound' / 'Inbound' verbatim, for provenance. */
  lineDirectionRaw: string | null;
  /** The EXPLICIT direction, mapped. Never parsed from a `_OUT` name suffix. */
  directionCode: TimetableDirectionCode | null;
  lineDirectionalDescription: string | null;
  journeyId: string | null;
  serviceType: string | null;
  serviceTypeName: string | null;
  garageName: string | null;
  arrivalSecondsOfDay: number | null;
  departureSecondsOfDay: number | null;
}

export interface NormalizeTimetableResult {
  rows: TimetableRow[];
  /** Rows in the payload, before any rejection. */
  rowCount: number;
  /** Rows dropped for having no stop area, no line, no direction or no departure. */
  rejectedRowCount: number;
}

/**
 * Map the endpoint's explicit direction word to a direction_code.
 *
 * This is the whole point of preferring this endpoint for direction: the old
 * path read a `_OUT` / `_IN` suffix off a route name and had to invent a
 * 'SINGLE' pseudo-direction whenever the name carried neither (118 of 656
 * seeded route-directions ended up 'SINGLE', and 10 more 'UP'). Here the
 * operator states the direction.
 */
export function toDirectionCode(raw: string | null): TimetableDirectionCode | null {
  if (raw === null) return null;
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'outbound' || normalized === 'out') return 'OUT';
  if (normalized === 'inbound' || normalized === 'in') return 'IN';
  return null;
}

/** 24 * 3600. */
const SECONDS_PER_DAY = 86_400;

/**
 * Read the clock components of an upstream time and return seconds since
 * midnight, or null when there are none to read.
 *
 * Accepts both shapes the UPSRTC endpoints use:
 *   * a stamped instant, `2026-08-10T09:13:20Z` (getStaticData's sta/std)
 *   * a bare wall clock, `09:13:20` (getScheduledBusInfo's scheduled_time)
 *
 * NO TIMEZONE CONVERSION IS APPLIED, AND THAT IS THE CORRECTION, not a
 * shortcut. The `Z` on the stamped form is a lie — the value is IST wall clock
 * — so honouring it would move every departure 5.5 hours. The date part is
 * discarded for the same reason the bare form omits one: a departure time is a
 * property of the timetable, not of the day it was last published on.
 *
 * HOURS >= 24 are a real upstream form for a post-midnight working (`28:37:51`
 * is observed on the sibling endpoint's to_arrival_time) and MUST NOT throw or
 * be rejected. They fold to the following day's time-of-day, which is the frame
 * every other departure is already in — 28:37:51 becomes 04:37:51. Up to 47:59
 * is accepted, matching the bound src/seed/harvest.ts#scheduledTimeToSeconds
 * already uses; beyond that the value is not a clock and null is returned.
 *
 * FOLDING IS NOT FREE and the trade is deliberate: a line whose last working of
 * the day crosses midnight has that departure land at the START of the sorted
 * day rather than the end, which inflates one gap and deflates another. That is
 * survivable only because H* is the MEDIAN gap, not the mean or the span — see
 * src/seed/timetable.ts#deriveTimetableHeadway. A line with so few departures
 * that one folded value dominates the median produces an out-of-bounds number
 * and is reported as uncalibrated, which is the honest outcome.
 */
export function wallClockSecondsOfDay(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const text = typeof raw === 'string' ? raw.trim() : String(raw);
  if (text === '') return null;

  const stamped = /[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(text);
  const bare = stamped ? null : /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  const match = stamped ?? bare;
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? '0');
  if (!Number.isFinite(hours) || hours > 47 || minutes > 59 || seconds > 59) return null;

  return (hours * 3600 + minutes * 60 + seconds) % SECONDS_PER_DAY;
}

/**
 * One raw payload -> timetable rows.
 *
 * A row is REJECTED when it cannot contribute to either of the two things this
 * endpoint is authoritative for: it needs a line id, an explicit direction and
 * a departure time for headway, and a stop area code to know which observation
 * point that departure was seen from. Rejections are counted rather than
 * silently dropped — a sudden jump in the count is upstream changing shape.
 */
export function normalizeTimetableRows(payload: unknown): NormalizeTimetableResult {
  const raw = extractArray(payload);
  const rows: TimetableRow[] = [];
  let rejected = 0;

  for (const entry of raw) {
    if (!isRecord(entry)) {
      rejected += 1;
      continue;
    }

    const stopAreaCode = toNumber(pick(entry, STOP_AREA_CODE_ALIASES));
    const lineId = toStringOrNull(pick(entry, LINE_ID_ALIASES));
    const lineDirectionRaw = toStringOrNull(pick(entry, LINE_DIRECTION_ALIASES));
    const directionCode = toDirectionCode(lineDirectionRaw);
    const departureSecondsOfDay = wallClockSecondsOfDay(
      toStringOrNull(pick(entry, DEPARTURE_ALIASES)),
    );

    if (stopAreaCode === null || lineId === null || directionCode === null || departureSecondsOfDay === null) {
      rejected += 1;
      continue;
    }

    rows.push({
      stopAreaCode,
      stopAreaName: toStringOrNull(pick(entry, STOP_AREA_NAME_ALIASES)),
      stopSequence: toNumber(pick(entry, STOP_SEQUENCE_ALIASES)),
      routeName: toStringOrNull(pick(entry, ROUTE_NAME_ALIASES)),
      routeDescription: toStringOrNull(pick(entry, ROUTE_DESC_ALIASES)),
      lineId,
      lineName: toStringOrNull(pick(entry, LINE_NAME_ALIASES)),
      lineDirectionRaw,
      directionCode,
      lineDirectionalDescription: toStringOrNull(pick(entry, LINE_DIRECTIONAL_DESC_ALIASES)),
      journeyId: toStringOrNull(pick(entry, JOURNEY_ID_ALIASES)),
      serviceType: toStringOrNull(pick(entry, SERVICE_TYPE_ALIASES)),
      serviceTypeName: toStringOrNull(pick(entry, SERVICE_TYPE_NAME_ALIASES)),
      garageName: toStringOrNull(pick(entry, GARAGE_ALIASES)),
      arrivalSecondsOfDay: wallClockSecondsOfDay(toStringOrNull(pick(entry, ARRIVAL_ALIASES))),
      departureSecondsOfDay,
    });
  }

  return { rows, rowCount: raw.length, rejectedRowCount: rejected };
}

/**
 * Several stop payloads -> one row list.
 *
 * A saved corpus can reasonably be any of: the array of rows from one stop, an
 * array of those arrays, or an object keyed by stop code. All three are folded
 * here so `--timetable-file` accepts whatever an operator captured without
 * requiring them to reshape it first.
 */
export function normalizeTimetablePayloads(payloads: readonly unknown[]): NormalizeTimetableResult {
  const rows: TimetableRow[] = [];
  let rowCount = 0;
  let rejectedRowCount = 0;

  for (const payload of payloads) {
    const result = normalizeTimetableRows(payload);
    rows.push(...result.rows);
    rowCount += result.rowCount;
    rejectedRowCount += result.rejectedRowCount;
  }

  return { rows, rowCount, rejectedRowCount };
}

/**
 * Flatten a captured corpus into the list of per-stop payloads
 * normalizeTimetablePayloads expects.
 *
 * A bare array of ROW objects is passed through as a single payload; an array
 * of ARRAYS is treated as one entry per stop; an object is treated as a
 * stop-code -> payload map. The row/array distinction is decided by looking at
 * the first element rather than by a flag, because a captured file carries no
 * metadata saying which it is.
 */
export function splitTimetableCorpus(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload.some((entry) => Array.isArray(entry)) ? payload : [payload];
  }
  if (isRecord(payload)) return Object.values(payload);
  return [payload];
}

export interface StaticDataFetchResult {
  stopCode: number;
  /** Raw upstream payload, or null when the fetch itself failed. */
  payload: unknown;
  /** Transport-level failure message; null on success (including an empty `[]`). */
  error: string | null;
}

export function buildStaticDataUrl(stopCode: number, nowMs: number = Date.now()): string {
  const url = new URL(UPSRTC_STATIC_DATA_URL);
  url.searchParams.set('stop_code', String(stopCode));
  // Sent empty, exactly as the operator's own client does: a plate code filters
  // the board down to one platform, and the seeder wants the whole board.
  url.searchParams.set('plate_code', '');
  url.searchParams.set('lang_id', 'eng');
  // The upstream's own cache-buster. Harmless, and omitting it is an untested
  // deviation from the only request shape observed to work.
  url.searchParams.set('_', String(nowMs));
  return url.toString();
}

/**
 * Fetch one stop area's departure board.
 *
 * An empty `[]` body is a SUCCESS with no rows, not an error: two of the 24
 * codes answer that way permanently, and treating it as a failure would put a
 * permanent fake error in every seed report.
 */
export async function fetchStaticData(
  stopCode: number,
  timeoutMs: number = STATIC_DATA_REQUEST_TIMEOUT_MS,
  fetcher: (url: string, timeout: number) => Promise<UpstreamFetchResult> = fetchUpstream,
): Promise<StaticDataFetchResult> {
  const response = await fetcher(buildStaticDataUrl(stopCode), timeoutMs);
  return {
    stopCode,
    payload: response.ok ? response.payload : null,
    error: response.ok ? null : (response.error ?? 'upstream error'),
  };
}
