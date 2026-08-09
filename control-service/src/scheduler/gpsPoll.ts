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
import { fetchUpstream } from '../ingestion/upsrtc/client.js';
import {
  extractArray,
  isRecord,
  parseUpstreamInstant,
  pick,
  toNumber,
  toStringOrNull,
} from '../ingestion/upsrtc/normalize.js';
import { logger } from '../lib/logger.js';
import type { PositionEvent } from '../state-estimation/types.js';

// ---------------------------------------------------------------------------
// Upstream client contract
// ---------------------------------------------------------------------------
// The transport and the payload-shape quirks are now shared with the seeder
// via `src/ingestion/upsrtc/{client,normalize}.ts` - one implementation of
// "how does this undocumented endpoint misbehave", so the two consumers
// cannot drift apart on it.
//
// What is NOT shared is the field mapping below. The seeder's
// `normalizeLiveRecords()` deliberately DISCARDS coordinates: it only needs
// registration + route identity, and it keeps records with no GPS fix at all
// because a parked bus is still a `vehicles` row. This poller needs the exact
// opposite - a position or nothing. Reusing that normalizer here would
// silently drop every fix, so the mapping stays local and explicit.
//
// The `FetchLiveFeed` seam is retained: it is what keeps this job unit
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

// The live payload is ~11.7 MB. 20s was too tight to download it reliably on
// a slow link, and a timeout that always fires makes the poller useless. The
// scheduler's per-job overlap suppression is what makes a longer ceiling safe:
// a slow poll delays the next cycle, it never stacks concurrent downloads.
const DEFAULT_TIMEOUT_MS = 60_000;

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
  const result = await fetchUpstream(url, timeoutMs);

  // fetchUpstream reports failure structurally (HTML outage page, malformed
  // JSON, non-2xx, timeout) rather than throwing. Convert that to a throw
  // here on purpose: the scheduler counts a rejected job, whereas returning
  // an empty snapshot would log a successful 0-vehicle poll and make an
  // upstream outage look like a quiet night on the network.
  if (!result.ok) {
    throw new Error(`upstream GPS feed unavailable: ${result.error ?? `HTTP ${result.status}`}`);
  }

  // extractArray unwraps a bare array, a wrapper object, or JSON double
  // encoded as a string inside JSON - all three have been observed here.
  const rows = extractArray(result.payload);

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
    //
    // parseUpstreamInstant (not Date.parse) because the live feed stamps IST
    // wall-clock time and labels it `Z`, putting every fix ~5.5h in the
    // future. Read literally that defeats the max-age test immediately below,
    // AND mpc/safety.ts's hard staleness filter, AND the vehicle_states
    // out-of-order guard - see that function's comment for the measurements.
    // It also returns null for a unit whose own clock is broken beyond the
    // IST correction, so those are dropped here as unusable.
    const observedMs = parseUpstreamInstant(vehicle.observedAt, now()) ?? NaN;
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
