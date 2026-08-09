// In-process GPS poller: the fleet's actual sensory input.
//
// Runs IN-PROCESS rather than POSTing to this service's own
// /v1/positions. Looping back through HTTP would serialise ~665 fixes
// through the Express stack, the JSON body parser and the auth middleware
// for no benefit - the pipeline in ingestion/pipeline.ts is the shared
// entrypoint, and both the route and this job call it directly. Anything
// this poller learns about failure classification is therefore identical
// to what an external caller sees.
//
// Gated on GPS_POLL_ENABLED (default false) so exactly one instance of a
// multi-instance deploy polls: the upstream feed is global, so N replicas
// would ingest the same 665 fixes N times, N-fold the write load, and race
// each other on the vehicle_states out-of-order guard.
//
// Only status === 'Live' rows are ingested (~665 of ~9,261). Ingesting the
// parked remainder would 9x the per-cycle cost AND actively damage state:
// a bus sitting in a depot is nowhere near a route shape, so every one of
// those fixes map-matches to `off_route`, which is a real stop_state the
// rest of the system reads.

import { loadEnv, type Env } from '../config/env.js';
import { ingestPositionEvents, type IngestBatchResult } from '../ingestion/pipeline.js';
import { logger } from '../lib/logger.js';
import type { PositionEvent } from '../state-estimation/types.js';

// ---------------------------------------------------------------------------
// Upstream client contract
// ---------------------------------------------------------------------------
// The real tolerant fetch + normalizer lives in
// `src/ingestion/upsrtc/client.ts`, which is owned by a different work
// stream. This module is written against the narrow interface below so
// adopting it is a one-line import swap (replace the `fetchLiveFeed`
// binding at the bottom of this section), and so this job stays unit
// testable without a network.

/** One normalized live fix. Field names match PositionEvent deliberately - the mapping below should stay boring. */
export interface LiveVehiclePosition {
  /** Upstream `regNum`. The registration number IS the vehicle id in this system (vehicles.id === vehicles.registration_number for auto-registered buses). */
  vehicleId: string;
  lat: number;
  lon: number;
  speedKmph: number | null;
  headingDegrees: number | null;
  /** ISO-8601, or null when upstream sent no parseable timestamp. */
  observedAt: string | null;
  /**
   * Raw upstream `status`. NULL means the client already applied the
   * liveness filter and dropped the field - see isLive() for why that is
   * treated as "live" rather than "unknown".
   */
  status?: string | null;
}

export interface LiveFeedSnapshot {
  /** Records in the raw payload BEFORE any filtering - the denominator in the poll log line. */
  fetched: number;
  vehicles: LiveVehiclePosition[];
}

export type FetchLiveFeed = (options: { url: string; timeoutMs?: number }) => Promise<LiveFeedSnapshot>;

const DEFAULT_TIMEOUT_MS = 20_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pick(row: Record<string, unknown>, aliases: readonly string[]): unknown {
  for (const key of aliases) {
    if (!(key in row)) continue;
    const value = row[key];
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

function toNumber(value: unknown): number | null {
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
  if (typeof value === 'string') return value.trim() === '' ? null : value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

/**
 * Placeholder implementation of FetchLiveFeed, kept deliberately minimal
 * and alias-tolerant (the upstream schema is undocumented - see
 * docs/API_DISCOVERY.md). Two upstream quirks it has to survive:
 *
 *  - The endpoint advertises `Content-Type: text/html` while returning
 *    JSON, so the body is read as text and parsed by hand rather than via
 *    response.json().
 *  - The array is sometimes wrapped in an object, and sometimes double
 *    encoded as a JSON string inside JSON.
 *
 * Replace with the shared client when it lands; see the header note.
 */
export const fetchLiveFeedOverHttp: FetchLiveFeed = async ({ url, timeoutMs = DEFAULT_TIMEOUT_MS }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let text: string;
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json, text/plain, */*' },
    });
    if (!response.ok) throw new Error(`upstream GPS feed responded ${response.status}`);
    text = await response.text();
  } finally {
    clearTimeout(timer);
  }

  const trimmed = text.trimStart();
  if (trimmed.startsWith('<')) {
    // An HTML document where data was expected is an upstream outage page,
    // not a payload. Throwing here keeps a 0-vehicle "successful" poll from
    // looking like a quiet night on the network.
    throw new Error('upstream GPS feed returned an HTML document instead of data');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(trimmed);
  } catch {
    throw new Error('upstream GPS feed returned malformed JSON');
  }
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      /* leave as-is; extraction below will yield an empty array */
    }
  }

  let rows: unknown[] = [];
  if (Array.isArray(payload)) {
    rows = payload;
  } else if (isRecord(payload)) {
    for (const key of ['data', 'result', 'results', 'vehicles', 'buses', 'records', 'rows', 'items']) {
      const candidate = payload[key];
      if (Array.isArray(candidate) && candidate.length > 0) {
        rows = candidate;
        break;
      }
    }
  }

  const vehicles: LiveVehiclePosition[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const vehicleId = toStringOrNull(
      pick(row, ['regNum', 'reg_num', 'registration_number', 'registrationNo', 'vehicle_no', 'bus_no']),
    );
    const lat = toNumber(pick(row, ['latitude', 'lat', 'Latitude']));
    const lon = toNumber(pick(row, ['longitude', 'lng', 'lon', 'long', 'Longitude']));
    if (!vehicleId || lat === null || lon === null) continue;
    // Null island is the standard "no fix" sentinel on these units.
    if (lat === 0 && lon === 0) continue;

    vehicles.push({
      vehicleId,
      lat,
      lon,
      speedKmph: toNumber(pick(row, ['speed', 'Speed', 'speed_kmph', 'speedKmph'])),
      headingDegrees: toNumber(pick(row, ['heading', 'Heading', 'bearing', 'course'])),
      observedAt: toStringOrNull(pick(row, ['timestamp', 'receivedTime', 'gps_timestamp', 'time'])),
      status: toStringOrNull(pick(row, ['status', 'vehicle_status', 'vehicleStatus'])),
    });
  }

  return { fetched: rows.length, vehicles };
};

/** The binding to swap when the shared upstream client lands. */
const fetchLiveFeed: FetchLiveFeed = fetchLiveFeedOverHttp;

// ---------------------------------------------------------------------------
// Poll
// ---------------------------------------------------------------------------

/**
 * A row counts as live when upstream says so, OR when the client stripped
 * `status` entirely - the latter means the client already applied the
 * liveness filter, and re-rejecting on a field it deliberately dropped
 * would silently ingest nothing at all.
 */
function isLive(vehicle: LiveVehiclePosition): boolean {
  if (vehicle.status === undefined || vehicle.status === null) return true;
  return vehicle.status.trim().toLowerCase() === 'live';
}

export interface GpsPollResult {
  fetched: number;
  live: number;
  ingested: number;
  rejected: number;
  /** Live rows dropped locally (older than GPS_MAX_AGE_SECONDS, or missing/unparseable timestamp). */
  stale: number;
  durationMs: number;
}

export interface GpsPollDeps {
  fetchLiveFeed?: FetchLiveFeed;
  ingest?: (
    events: readonly PositionEvent[],
    options: { autoRegisterVehicles: boolean },
  ) => Promise<IngestBatchResult>;
  now?: () => number;
}

/**
 * One poll cycle: fetch, filter to live, drop stale fixes, ingest.
 *
 * `autoRegisterVehicles: true` is correct HERE and nowhere else: the live
 * feed is this system's vehicle master, so a registration number appearing
 * for the first time is a new bus, not a typo. The HTTP route defaults it
 * off for exactly the opposite reason.
 */
export async function runGpsPoll(env: Env = loadEnv(), deps: GpsPollDeps = {}): Promise<GpsPollResult> {
  const now = deps.now ?? Date.now;
  const fetchFeed = deps.fetchLiveFeed ?? fetchLiveFeed;
  const ingest = deps.ingest ?? ingestPositionEvents;

  const startedAt = now();
  const snapshot = await fetchFeed({ url: env.GPS_POLL_URL });
  const live = snapshot.vehicles.filter(isLive);

  const maxAgeMs = env.GPS_MAX_AGE_SECONDS * 1000;
  const events: PositionEvent[] = [];
  let stale = 0;

  for (const vehicle of live) {
    // A fix with no usable timestamp is dropped rather than stamped with
    // "now": inventing an observed_at would let an arbitrarily old fix win
    // the vehicle_states out-of-order guard against a genuinely current one.
    const observedMs = vehicle.observedAt === null ? NaN : Date.parse(vehicle.observedAt);
    if (Number.isNaN(observedMs) || now() - observedMs > maxAgeMs) {
      stale += 1;
      continue;
    }
    events.push({
      vehicleId: vehicle.vehicleId,
      lat: vehicle.lat,
      lon: vehicle.lon,
      speedKmph: vehicle.speedKmph,
      // Wrapped, not rejected: vehicle_states.heading_degrees carries a
      // `>= 0 and < 360` CHECK and several units report a bare 360.
      headingDegrees:
        vehicle.headingDegrees === null ? null : ((vehicle.headingDegrees % 360) + 360) % 360,
      observedAt: new Date(observedMs).toISOString(),
    });
  }

  const { accepted, rejected } =
    events.length > 0
      ? await ingest(events, { autoRegisterVehicles: true })
      : { accepted: 0, rejected: [] as IngestBatchResult['rejected'] };

  const result: GpsPollResult = {
    fetched: snapshot.fetched,
    live: live.length,
    ingested: accepted,
    rejected: rejected.length,
    stale,
    durationMs: now() - startedAt,
  };

  logger.info(result, 'gps poll cycle complete');
  return result;
}
