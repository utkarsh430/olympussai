// getBusBetweenStops.php — the STATEWIDE origin-destination schedule, and the
// second published source of how often a route is served.
//
// WHY THIS MODULE EXISTS.
//
// getStaticData.php is the better source and remains authoritative (see
// src/seed/timetable.ts): it publishes a DEPARTURE BOARD at a stop, so gaps
// between successive departures of one line-direction AT ONE POINT are headway
// in the strict sense. It is also scoped to a single instrumented corridor —
// MEASURED by probing stop_code 1..400 with zero errors, it serves 22 stops,
// all of them on Lucknow -> Raebareli -> Prayagraj. It calibrated 74 of 666
// seeded route-directions and cannot be widened.
//
// This endpoint covers the whole state. It answers "what runs from city A to
// city B on date D", so sweeping the ordered pairs of the 16 published cities
// (src/ingestion/upsrtc/stopAreaGroup.ts) returns the network's published
// workings. MEASURED over all 210 ordered pairs: 53,898 rows, 3,768 distinct
// routes, 2,783 with a derivable headway (median 30 min, p10 5 min, p90
// 136 min).
//
// It is a WEAKER source, and the weakness is structural rather than
// incidental — which is why 'od_timetable' is its own calibration_source and
// ranks BELOW 'timetable' rather than being merged into it. A row here is one
// trip between a pair of cities, listing its departure from a stop inside the
// origin city. That is a real published departure, but the set of them for one
// route is assembled from queries about many destinations rather than read off
// one board, so it is a coarser view of the same timetable. Precedence is
// enforced in src/seed/recalibrate.ts; the derivation is in
// src/seed/odTimetable.ts.
//
// ---------------------------------------------------------------------------
// THE REQUEST (measured; this exact shape is the only one observed to work)
// ---------------------------------------------------------------------------
//   POST .../php/getBusBetweenStops.php
//   Content-Type: application/x-www-form-urlencoded; charset=UTF-8
//   X-Requested-With: XMLHttpRequest
//   Origin / Referer: the site's own
//
//   origin_id=8&origin_classification=GROUP
//   &destination_id=12&destination_classification=GROUP
//   &req_date=2026-08-11&service_type=All+Bus+Types
//
// `origin_id` under `origin_classification=GROUP` IS A CITY ID (8 = LUCKNOW),
// not a stop area id. getStaticData's `stop_code` is a STOP_AREA id (1 =
// ALAMBAGH). The two spaces collide numerically and mean different things — see
// stopAreaGroup.ts's header for the full three-way collision. Nothing here
// joins on a place id; OD rows reach the seeded network via `line_name`.
//
// ---------------------------------------------------------------------------
// THE ROW (measured)
// ---------------------------------------------------------------------------
//   {"vj_id":19237,"trip_id":"MZP0120","depot_name":"MIRZAPUR",
//    "service_type_name":"ORDINARY","route_origin":"LKM","route_destination":"MZP",
//    "route_name":"MZP_1310_ORD_OUT","route_id":4335,
//    "route_desc":"LAKHIMPUR TO MIRZAPUR","line_name":"1310",
//    "line_desc":"LAKHIMPUR-MIRZAPUR","line_directional_desc":"LAKHIMPUR TO MIRZAPUR",
//    "region_name":"PRAYAGRAJ","from_stop_name":"KAISERBAGH",
//    "to_stop_name":"PRAYAGRAJ CIVIL LINES","from_arrival_time":"10:53:44",
//    "to_arrival_time":"18:23:29","reg_num":null}
//
// FOUR THINGS ABOUT IT THAT DECIDE THE CODE BELOW:
//
// 1. `line_name` IS THE JOIN, AND `route_id` IS NOT. routes.id in this database
//    came from getScheduledBusInfo's `line_id`, and `line_name` ("1310") is a
//    string of that same space. `route_id` (4335) is a different identifier
//    entirely and joining on it would match nothing — or worse, match the wrong
//    line. MEASURED against the live database: keying OD headways by
//    `route_name` yields 2,783, by `line_name` 1,608, and 157 of the 666 seeded
//    route-directions match via `line_name`. The larger `route_name` keyspace is
//    NOT the better join; it just fails to line up with what was seeded.
//
// 2. `from_arrival_time` IS A BARE `HH:MM:SS` CLOCK — no date, no `Z`. It is
//    the departure at the origin stop. It is parsed by the SAME
//    wallClockSecondsOfDay the timetable uses, which reads clock components and
//    applies no timezone conversion. Reusing it is not tidiness: that function
//    encodes the measured fact that upstream's `Z`-stamped times are really IST
//    wall clock, and a second parser would be a second place to get that wrong.
//
// 3. HOURS >= 24 ARE REAL. `to_arrival_time` carries values like `28:37:51`,
//    meaning 04:37:51 the next day on a working that started the day before.
//    wallClockSecondsOfDay folds them rather than throwing or rejecting. Left
//    unhandled this is a crash on a perfectly normal row.
//
// 4. ONE JOURNEY APPEARS MANY TIMES, ACROSS AND WITHIN QUERIES. Within a single
//    Lucknow->Prayagraj response, vj_id 19237 appears once per boarding stop in
//    Lucknow (KAISERBAGH at 10:53:44, ALAMBAGH at 11:08:52). Across the sweep it
//    appears again in every city pair its route spans. So the sweep's output is
//    heavily redundant BY DESIGN, and the derivation in src/seed/odTimetable.ts
//    both buckets by `from_stop_name` and dedupes departure times — pooling the
//    boarding stops of one journey would manufacture a fake 15-minute "headway"
//    out of one bus's run across a city.

import { fetchUpstream, type UpstreamFetchResult } from './client.js';
import { extractArray, isRecord, pick, toStringOrNull } from './normalize.js';
import { wallClockSecondsOfDay } from './staticData.js';

export const UPSRTC_BUS_BETWEEN_STOPS_URL =
  process.env.UPSRTC_BUS_BETWEEN_STOPS_URL ??
  'https://margdarshi.upsrtcvlt.com/php/getBusBetweenStops.php';

/**
 * A busy city pair returns ~20 KB and answers in a couple of seconds; the
 * largest take noticeably longer. Generous enough for those, tight enough that
 * a hung pair does not stall a 210-request sweep.
 */
export const BUS_BETWEEN_STOPS_REQUEST_TIMEOUT_MS = 90_000;

/** The site's own "no filter" value for the service-type dropdown. */
export const ALL_BUS_TYPES = 'All Bus Types';

export type OdClassification = 'GROUP' | 'STOP_AREA';

export interface BusBetweenStopsQuery {
  originId: number;
  destinationId: number;
  /** GROUP for a city-to-city sweep. See the header on the id collision. */
  originClassification?: OdClassification;
  destinationClassification?: OdClassification;
  /** YYYY-MM-DD, the service date being asked about. */
  date: string;
  serviceType?: string;
}

/**
 * One OD trip row, normalized.
 *
 * `departureSecondsOfDay` / `arrivalSecondsOfDay` are SECONDS SINCE MIDNIGHT in
 * the upstream's own (IST) frame — deliberately not instants, exactly as
 * TimetableRow's are, and for the reason in staticData.ts's header.
 */
export interface OdScheduleRow {
  journeyId: string | null;
  tripId: string | null;
  depotName: string | null;
  serviceTypeName: string | null;
  routeName: string | null;
  routeOrigin: string | null;
  routeDestination: string | null;
  routeDescription: string | null;
  /** The LINE id as a string — the join key to routes.id. See header, 1. */
  lineName: string | null;
  lineDescription: string | null;
  lineDirectionalDescription: string | null;
  regionName: string | null;
  /** The boarding stop inside the ORIGIN city. The observation point. */
  fromStopName: string | null;
  toStopName: string | null;
  departureSecondsOfDay: number;
  /** May be null: an alighting time is not needed and is not always parseable. */
  arrivalSecondsOfDay: number | null;
  registrationNumber: string | null;
}

export interface NormalizeOdResult {
  rows: OdScheduleRow[];
  /** Rows in the payload, before any rejection. */
  rowCount: number;
  /** Rows dropped for having no line, no boarding stop or no departure time. */
  rejectedRowCount: number;
}

const JOURNEY_ID_ALIASES = ['vj_id', 'vehicle_journey_id', 'tripId'] as const;
const TRIP_ID_ALIASES = ['trip_id'] as const;
const DEPOT_ALIASES = ['depot_name', 'depotName', 'garage_name'] as const;
const SERVICE_TYPE_NAME_ALIASES = ['service_type_name', 'serviceTypeName'] as const;
const ROUTE_NAME_ALIASES = ['route_name', 'routeName', 'RouteName'] as const;
const ROUTE_ORIGIN_ALIASES = ['route_origin', 'routeOrigin'] as const;
const ROUTE_DESTINATION_ALIASES = ['route_destination', 'routeDestination'] as const;
const ROUTE_DESC_ALIASES = ['route_desc', 'route_description', 'routeDescription'] as const;
const LINE_NAME_ALIASES = ['line_name', 'lineName'] as const;
const LINE_DESC_ALIASES = ['line_desc', 'lineDesc'] as const;
const LINE_DIRECTIONAL_DESC_ALIASES = ['line_directional_desc', 'lineDirectionalDesc'] as const;
const REGION_ALIASES = ['region_name', 'regionName'] as const;
const FROM_STOP_ALIASES = ['from_stop_name', 'fromStopName'] as const;
const TO_STOP_ALIASES = ['to_stop_name', 'toStopName'] as const;
const FROM_TIME_ALIASES = ['from_arrival_time', 'fromArrivalTime'] as const;
const TO_TIME_ALIASES = ['to_arrival_time', 'toArrivalTime'] as const;
const REG_ALIASES = ['reg_num', 'regNum', 'registration_number'] as const;

/**
 * One raw payload -> OD rows.
 *
 * A row is REJECTED when it cannot contribute to a headway: it needs a
 * `line_name` to join to a route, a `from_stop_name` to say WHERE the departure
 * was observed, and a parseable `from_arrival_time`. Rejections are counted
 * rather than silently dropped — a jump in the count is upstream changing shape.
 *
 * Note this endpoint publishes no explicit direction word. Direction comes from
 * the `_IN` / `_OUT` suffix on `route_name`, which is read in
 * src/seed/odTimetable.ts using the harvester's existing `directionSuffix`.
 */
export function normalizeOdRows(payload: unknown): NormalizeOdResult {
  const raw = extractArray(payload);
  const rows: OdScheduleRow[] = [];
  let rejected = 0;

  for (const entry of raw) {
    if (!isRecord(entry)) {
      rejected += 1;
      continue;
    }

    const lineName = toStringOrNull(pick(entry, LINE_NAME_ALIASES));
    const fromStopName = toStringOrNull(pick(entry, FROM_STOP_ALIASES));
    const departureSecondsOfDay = wallClockSecondsOfDay(
      toStringOrNull(pick(entry, FROM_TIME_ALIASES)),
    );

    if (lineName === null || fromStopName === null || departureSecondsOfDay === null) {
      rejected += 1;
      continue;
    }

    rows.push({
      journeyId: toStringOrNull(pick(entry, JOURNEY_ID_ALIASES)),
      tripId: toStringOrNull(pick(entry, TRIP_ID_ALIASES)),
      depotName: toStringOrNull(pick(entry, DEPOT_ALIASES)),
      serviceTypeName: toStringOrNull(pick(entry, SERVICE_TYPE_NAME_ALIASES)),
      routeName: toStringOrNull(pick(entry, ROUTE_NAME_ALIASES)),
      routeOrigin: toStringOrNull(pick(entry, ROUTE_ORIGIN_ALIASES)),
      routeDestination: toStringOrNull(pick(entry, ROUTE_DESTINATION_ALIASES)),
      routeDescription: toStringOrNull(pick(entry, ROUTE_DESC_ALIASES)),
      lineName,
      lineDescription: toStringOrNull(pick(entry, LINE_DESC_ALIASES)),
      lineDirectionalDescription: toStringOrNull(pick(entry, LINE_DIRECTIONAL_DESC_ALIASES)),
      regionName: toStringOrNull(pick(entry, REGION_ALIASES)),
      fromStopName,
      toStopName: toStringOrNull(pick(entry, TO_STOP_ALIASES)),
      departureSecondsOfDay,
      // Parsed with the same folding parser, which is what keeps `28:37:51`
      // from being an exception on an otherwise ordinary row.
      arrivalSecondsOfDay: wallClockSecondsOfDay(toStringOrNull(pick(entry, TO_TIME_ALIASES))),
      registrationNumber: toStringOrNull(pick(entry, REG_ALIASES)),
    });
  }

  return { rows, rowCount: raw.length, rejectedRowCount: rejected };
}

/** Several OD payloads -> one row list, folding the per-payload counters. */
export function normalizeOdPayloads(payloads: readonly unknown[]): NormalizeOdResult {
  const rows: OdScheduleRow[] = [];
  let rowCount = 0;
  let rejectedRowCount = 0;

  for (const payload of payloads) {
    const result = normalizeOdRows(payload);
    rows.push(...result.rows);
    rowCount += result.rowCount;
    rejectedRowCount += result.rejectedRowCount;
  }

  return { rows, rowCount, rejectedRowCount };
}

/**
 * Flatten a captured corpus into the per-pair payloads normalizeOdPayloads
 * expects. Same three shapes splitTimetableCorpus accepts, and for the same
 * reason: a captured file carries no metadata saying which it is, so the
 * row/array distinction is decided by looking at the elements.
 */
export function splitOdCorpus(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload.some((entry) => Array.isArray(entry)) ? payload : [payload];
  }
  if (isRecord(payload)) return Object.values(payload);
  return [payload];
}

/**
 * The form body, encoded exactly as the site's own client sends it.
 *
 * URLSearchParams renders a space as `+`, which is what
 * `service_type=All+Bus+Types` needs — the only encoding observed to work.
 */
export function buildBusBetweenStopsBody(query: BusBetweenStopsQuery): string {
  const params = new URLSearchParams();
  params.set('origin_id', String(query.originId));
  params.set('origin_classification', query.originClassification ?? 'GROUP');
  params.set('destination_id', String(query.destinationId));
  params.set('destination_classification', query.destinationClassification ?? 'GROUP');
  params.set('req_date', query.date);
  params.set('service_type', query.serviceType ?? ALL_BUS_TYPES);
  return params.toString();
}

/**
 * The headers the site sends. Origin/Referer are included because this is the
 * request shape that was verified end to end, and an endpoint that checks
 * `X-Requested-With` may well check these too — dropping them would be an
 * untested deviation from the only thing known to work.
 */
export function busBetweenStopsHeaders(): Record<string, string> {
  const origin = new URL(UPSRTC_BUS_BETWEEN_STOPS_URL).origin;
  return {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest',
    Origin: origin,
    Referer: `${origin}/`,
  };
}

export interface OdFetchResult {
  originId: number;
  destinationId: number;
  /** Raw upstream payload, or null when the fetch itself failed. */
  payload: unknown;
  /** Transport-level failure message; null on success (including an empty `[]`). */
  error: string | null;
}

/**
 * Fetch one ordered city pair.
 *
 * An empty `[]` is a SUCCESS with no rows — most of the 210 pairs have some
 * service but a few genuinely have none, and treating that as a failure would
 * put permanent fake errors in every sweep report.
 */
export async function fetchBusBetweenStops(
  query: BusBetweenStopsQuery,
  timeoutMs: number = BUS_BETWEEN_STOPS_REQUEST_TIMEOUT_MS,
  fetcher: (
    url: string,
    timeout: number,
    request: { method: 'POST'; body: string; headers: Record<string, string> },
  ) => Promise<UpstreamFetchResult> = fetchUpstream,
): Promise<OdFetchResult> {
  const response = await fetcher(UPSRTC_BUS_BETWEEN_STOPS_URL, timeoutMs, {
    method: 'POST',
    body: buildBusBetweenStopsBody(query),
    headers: busBetweenStopsHeaders(),
  });
  return {
    originId: query.originId,
    destinationId: query.destinationId,
    payload: response.ok ? response.payload : null,
    error: response.ok ? null : (response.error ?? 'upstream error'),
  };
}

/** Every ORDERED pair of distinct ids, stable order. n*(n-1) requests. */
export function orderedCityPairs(
  cityIds: readonly number[],
): { originId: number; destinationId: number }[] {
  const sorted = [...new Set(cityIds)].sort((a, b) => a - b);
  const pairs: { originId: number; destinationId: number }[] = [];
  for (const originId of sorted) {
    for (const destinationId of sorted) {
      if (originId === destinationId) continue;
      pairs.push({ originId, destinationId });
    }
  }
  return pairs;
}
