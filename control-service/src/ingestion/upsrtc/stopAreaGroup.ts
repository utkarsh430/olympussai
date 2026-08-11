// getStopAreaAndGroup.php — the UPSRTC GEOGRAPHY INDEX, and the only upstream
// endpoint that will enumerate places rather than answer about one.
//
// WHY THIS MODULE EXISTS.
//
// getStaticData.php (src/ingestion/upsrtc/staticData.ts) is the authoritative
// timetable, and it is authoritative for exactly 22 stop areas. MEASURED by
// probing stop_code 1..400 densely with zero errors: it serves 22 stops, and
// their names in order are ALAMBAGH, TELIBAGH, SGPGI, MOHANLAL GANJ, NIGOHA,
// BACHHRAWAN, HARCHANDPUR, RAEBARELI, UNCHAHAR, NAWABGANJ, PHAPHAMAU,
// PRAYAGRAJ. That is ONE instrumented corridor — Lucknow to Raebareli to
// Prayagraj — not the state. It cannot be widened; there is nothing above 24 to
// find. So 74 of 666 seeded route-directions could be calibrated from it and
// 592 could not, and the rest of the network needs a DIFFERENT published
// source.
//
// The statewide source is getBusBetweenStops.php (see busBetweenStops.ts),
// which answers "what runs from A to B" — an ORIGIN-DESTINATION query. It needs
// place ids to ask about, and nothing publishes a list of them. This endpoint
// is that list, obtained by asking it enough questions.
//
// ---------------------------------------------------------------------------
// WHAT IT RETURNS (measured 2026-08-11, not assumed)
// ---------------------------------------------------------------------------
//   GET .../php/getStopAreaAndGroup.php?query=<text>
//
//   [{"id":8,"code":"","name":"LUCKNOW","classification":"GROUP"},
//    {"id":1,"code":"ALM","name":"ALAMBAGH","classification":"STOP_AREA"}, ...]
//
// It is the autocomplete behind the operator's journey planner: a substring
// match over place names, in two classifications.
//
//   GROUP      a city. 16 of them, and the id space is NOT contiguous —
//              AGRA(1) .. PRAYAGRAJ(12) then BARABANKI(11001),
//              BULANDSHAHR(11002), VARANASI(11004). Anything that assumes a
//              range misses three cities and invents several that do not exist.
//   STOP_AREA  an individual stop. 1,523 found by the bounded drill below.
//
// ---------------------------------------------------------------------------
// THREE PROPERTIES THAT DECIDE HOW THIS FILE IS WRITTEN
// ---------------------------------------------------------------------------
//
// 1. SERVER-SIDE `LIMIT 10`, WITH NO PAGINATION AND NO TOTAL COUNT. A query
//    matching 400 places returns 10 of them and says nothing about the other
//    390. So enumeration cannot be a single wildcard call; it has to be a
//    PREFIX DRILL, and the only signal that a prefix is truncated is that it
//    returned EXACTLY the limit. See enumerateStopAreaGroups.
//
// 2. NO MATCH ANSWERS JSON `null`, NOT `[]`. A bare `null` body, HTTP 200. That
//    is a normal, extremely common answer during a drill — most two-letter
//    prefixes match nothing — so it must be an empty result and never an error.
//    extractArray already folds it to `[]`; the guard is asserted by a test
//    rather than left implicit, because a future "tighten the parser" change
//    could easily make `null` throw and would break enumeration silently.
//
// 3. `UNKNOWN(11000)` IS IN THE GROUP LIST AND IS NOT A PLACE. It is the
//    operator's own catch-all bucket. Left in, it becomes an origin and a
//    destination in the OD sweep — 30 extra POSTs to a shared PHP host for a
//    city that does not exist, and any rows it returned would be attributed to
//    a fictional place. It is filtered here, at the point the name is read,
//    rather than in the sweep, so no caller can forget.
//
// ---------------------------------------------------------------------------
// THE ID-SPACE COLLISION. READ THIS BEFORE JOINING ANYTHING.
// ---------------------------------------------------------------------------
// Three small-integer identifier spaces are in play and two of them collide
// numerically while meaning different things. VERIFIED, and each of these was
// checked by name:
//
//   * getStaticData's `stop_code` is a STOP_AREA id.   1 = ALAMBAGH.
//   * getBusBetweenStops' `origin_id` under
//     `origin_classification=GROUP` is a CITY id.      8 = LUCKNOW.
//   * getScheduledBusInfo's `atco_code` is a THIRD
//     space again (staticData.ts point 3).             8 = PRAYAGRAJ CIVIL LINES.
//
// So `8` is simultaneously a valid city, a valid stop area and a valid atco
// code, denoting three different things. `classification` is not decoration —
// it is the discriminator, and StopAreaGroupEntry keeps it attached to the id
// for exactly that reason. Nothing in this codebase joins the spaces; the OD
// sweep uses GROUP ids only, and the OD rows join to the seeded network on
// `line_name` (a line id), never on a place id.

import { fetchUpstream, type UpstreamFetchResult } from './client.js';
import { extractArray, isRecord, pick, toNumber, toStringOrNull } from './normalize.js';

export const UPSRTC_STOP_AREA_GROUP_URL =
  process.env.UPSRTC_STOP_AREA_GROUP_URL ??
  'https://margdarshi.upsrtcvlt.com/php/getStopAreaAndGroup.php';

/** Autocomplete-sized responses; nothing here is ever more than 10 rows. */
export const STOP_AREA_GROUP_REQUEST_TIMEOUT_MS = 30_000;

/**
 * The server-side row cap. Not configurable and not advertised — MEASURED, by
 * finding prefixes whose true match count is far above 10 and observing that
 * every one of them returns precisely 10.
 *
 * A response of exactly this length is the ONLY evidence available that a
 * prefix is truncated, which is what makes it a drill trigger below.
 */
export const STOP_AREA_GROUP_RESULT_LIMIT = 10;

/**
 * Names that are buckets rather than places. Compared case-insensitively after
 * trimming, because upstream names carry trailing spaces ("LUDHIANA ").
 */
export const NON_PLACE_GROUP_NAMES: readonly string[] = ['UNKNOWN'];

export type StopAreaGroupClassification = 'GROUP' | 'STOP_AREA';

export interface StopAreaGroupEntry {
  id: number;
  /** Short operator code, e.g. `ALM`. Empty string upstream for GROUPs. */
  code: string | null;
  name: string;
  /** GROUP = city, STOP_AREA = stop. The discriminator for the id — see header. */
  classification: StopAreaGroupClassification;
}

export interface NormalizeStopAreaGroupResult {
  entries: StopAreaGroupEntry[];
  /** Rows in the payload, before any rejection. */
  rowCount: number;
  /** Rows dropped for having no id, no name or an unknown classification. */
  rejectedRowCount: number;
  /** Rows dropped for naming a bucket rather than a place (`UNKNOWN`). */
  nonPlaceRowCount: number;
}

const ID_ALIASES = ['id', 'stop_area_id', 'group_id'] as const;
const CODE_ALIASES = ['code', 'stop_code', 'short_code'] as const;
const NAME_ALIASES = ['name', 'stop_area_name', 'group_name'] as const;
const CLASSIFICATION_ALIASES = ['classification', 'type', 'category'] as const;

export function toClassification(raw: string | null): StopAreaGroupClassification | null {
  if (raw === null) return null;
  const normalized = raw.trim().toUpperCase();
  if (normalized === 'GROUP') return 'GROUP';
  if (normalized === 'STOP_AREA' || normalized === 'STOPAREA') return 'STOP_AREA';
  return null;
}

/** True for a bucket name like `UNKNOWN`, which is not a place. See header, 3. */
export function isNonPlaceName(name: string): boolean {
  const normalized = name.trim().toUpperCase();
  return NON_PLACE_GROUP_NAMES.includes(normalized);
}

/**
 * One raw payload -> entries.
 *
 * `null` (the no-match answer) and any other non-array body fold to zero
 * entries via extractArray, with rowCount 0. That is a result, not a failure.
 */
export function normalizeStopAreaGroupRows(payload: unknown): NormalizeStopAreaGroupResult {
  const raw = extractArray(payload);
  const entries: StopAreaGroupEntry[] = [];
  let rejected = 0;
  let nonPlace = 0;

  for (const row of raw) {
    if (!isRecord(row)) {
      rejected += 1;
      continue;
    }
    const id = toNumber(pick(row, ID_ALIASES));
    const name = toStringOrNull(pick(row, NAME_ALIASES));
    const classification = toClassification(toStringOrNull(pick(row, CLASSIFICATION_ALIASES)));

    if (id === null || !Number.isInteger(id) || name === null || classification === null) {
      rejected += 1;
      continue;
    }
    if (isNonPlaceName(name)) {
      nonPlace += 1;
      continue;
    }

    entries.push({
      id,
      // `code` is an empty string on every GROUP, and pick() already treats ''
      // as absent, so this is null rather than '' for a city.
      code: toStringOrNull(pick(row, CODE_ALIASES)),
      name: name.trim(),
      classification,
    });
  }

  return {
    entries,
    rowCount: raw.length,
    rejectedRowCount: rejected,
    nonPlaceRowCount: nonPlace,
  };
}

export function buildStopAreaGroupUrl(query: string): string {
  const url = new URL(UPSRTC_STOP_AREA_GROUP_URL);
  url.searchParams.set('query', query);
  return url.toString();
}

export interface StopAreaGroupFetchResult {
  query: string;
  /** Raw upstream payload, or null when the fetch itself failed. */
  payload: unknown;
  /** Transport-level failure message; null on success (including a `null` body). */
  error: string | null;
}

export async function fetchStopAreaGroup(
  query: string,
  timeoutMs: number = STOP_AREA_GROUP_REQUEST_TIMEOUT_MS,
  fetcher: (url: string, timeout: number) => Promise<UpstreamFetchResult> = fetchUpstream,
): Promise<StopAreaGroupFetchResult> {
  const response = await fetcher(buildStopAreaGroupUrl(query), timeoutMs);
  return {
    query,
    payload: response.ok ? response.payload : null,
    error: response.ok ? null : (response.error ?? 'upstream error'),
  };
}

export const DEFAULT_PREFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

/**
 * How many characters deep the drill is allowed to go.
 *
 * 2 by default, and that bound is a measurement rather than a guess. The a-z +
 * two-letter drill is 650 calls (26 at depth 1; 24 of those hit the limit and
 * expand to 26 each) and finds 16 GROUPs and 1,523 STOP_AREAs. Depth 3 would be
 * ~16,000 calls against a shared PHP host to chase the tail of a list that only
 * the 16 GROUPs are actually consumed from — and all 16 are already found at
 * depth 1, because a city name is short and common enough to surface above the
 * limit on its first letter.
 */
export const DEFAULT_PREFIX_MAX_DEPTH = 2;

export interface EnumerateStopAreaGroupsOptions {
  /** Letters used to seed the drill and to extend a truncated prefix. */
  alphabet?: string;
  maxDepth?: number;
  /** Hard ceiling on requests, so a pathological drill cannot run away. */
  maxQueries?: number;
  /** Injected for tests and for a delay/backoff wrapper. */
  fetch?: (query: string) => Promise<StopAreaGroupFetchResult>;
}

export interface EnumerateStopAreaGroupsResult {
  /** Cities. Deduped by id, ascending. `UNKNOWN` is already gone. */
  groups: StopAreaGroupEntry[];
  /** Stops. Deduped by id, ascending. */
  stopAreas: StopAreaGroupEntry[];
  queriesIssued: number;
  /** Prefixes that came back at exactly the limit, i.e. known-truncated. */
  truncatedPrefixes: string[];
  /**
   * Truncated prefixes the drill did NOT expand because it hit maxDepth or
   * maxQueries. Non-empty means the enumeration is knowingly incomplete, and it
   * is reported rather than inferred so nobody reads the result as exhaustive.
   */
  unexpandedPrefixes: string[];
  failures: { query: string; error: string }[];
}

/**
 * Enumerate the geography index by prefix, drilling only where the response
 * proves it is truncated.
 *
 * THE TERMINATION RULE, which is the whole algorithm: a prefix whose response
 * is SHORTER than STOP_AREA_GROUP_RESULT_LIMIT is complete — the server had
 * nothing more to give — so it is never extended. A prefix at exactly the limit
 * is truncated, so it is extended by one character for every letter of the
 * alphabet. Depth and total-query ceilings bound the worst case, and whatever
 * they cut off is REPORTED in `unexpandedPrefixes` rather than silently
 * dropped.
 *
 * Sequential by construction. There are hundreds of these against the same
 * shared PHP host that the OD sweep is about to POST to; the whole drill costs
 * about a minute and is run once per capture.
 */
export async function enumerateStopAreaGroups(
  options: EnumerateStopAreaGroupsOptions = {},
): Promise<EnumerateStopAreaGroupsResult> {
  const alphabet = options.alphabet ?? DEFAULT_PREFIX_ALPHABET;
  const maxDepth = options.maxDepth ?? DEFAULT_PREFIX_MAX_DEPTH;
  const maxQueries = options.maxQueries ?? 4_000;
  const fetcher = options.fetch ?? ((query: string) => fetchStopAreaGroup(query));

  const byId = new Map<string, StopAreaGroupEntry>();
  const truncated: string[] = [];
  const unexpanded: string[] = [];
  const failures: { query: string; error: string }[] = [];
  let queriesIssued = 0;

  // Breadth-first over prefixes so the shallow, high-yield queries all run
  // before any deep one does: if maxQueries cuts the drill short, what survives
  // is the most productive part of it rather than an arbitrary alphabetical
  // slice.
  let frontier = [...alphabet];

  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth += 1) {
    const next: string[] = [];

    for (const prefix of frontier) {
      if (queriesIssued >= maxQueries) {
        unexpanded.push(prefix);
        continue;
      }

      const response = await fetcher(prefix);
      queriesIssued += 1;

      if (response.error !== null) {
        failures.push({ query: prefix, error: response.error });
        continue;
      }

      const { entries, rowCount } = normalizeStopAreaGroupRows(response.payload);
      for (const entry of entries) {
        // Classification is part of the key: `8` is both LUCKNOW the city and a
        // stop area, and collapsing them would lose one. See the header.
        byId.set(`${entry.classification}|${entry.id}`, entry);
      }

      // Truncation is judged on the RAW row count, not on `entries`: a payload
      // of 10 rows one of which was UNKNOWN is still a truncated response, and
      // measuring the filtered length would under-drill exactly the prefixes
      // that contain the bucket row.
      if (rowCount < STOP_AREA_GROUP_RESULT_LIMIT) continue;

      truncated.push(prefix);
      if (depth === maxDepth) {
        unexpanded.push(prefix);
        continue;
      }
      for (const letter of alphabet) next.push(prefix + letter);
    }

    frontier = next;
  }

  // Anything still queued when the loop ended was never asked about.
  unexpanded.push(...frontier);

  const all = [...byId.values()].sort((a, b) => a.id - b.id);
  return {
    groups: all.filter((entry) => entry.classification === 'GROUP'),
    stopAreas: all.filter((entry) => entry.classification === 'STOP_AREA'),
    queriesIssued,
    truncatedPrefixes: truncated,
    unexpandedPrefixes: unexpanded,
    failures,
  };
}
