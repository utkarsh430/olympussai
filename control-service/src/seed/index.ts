// Network seeder CLI: `pnpm seed`.
//
// WHY THIS EXISTS. routes / route_directions / route_shapes / stops /
// route_direction_stops / route_policies / route_direction_rollout_stages are
// empty and nothing else populates them. route_shapes is INNER JOINed by every
// consumer (src/state-estimation/repository.ts, src/headway/repository.ts), so
// while it is empty every GPS fix map-matches against zero candidate shapes,
// short-circuits to stop_state 'off_route', and the entire
// detection -> headway -> MPC -> command chain is dead. This command is what
// turns it on.
//
//   pnpm seed --limit=8 --report=/tmp/seed-report.json
//   pnpm seed --dry-run --routes=BRH_828_ORD_OUT,RKD_635_ORD_IN
//
// The run is intentionally survivable end to end: an unassigned vehicle, a
// malformed route, a failed transaction — each is recorded and skipped, never
// fatal. The only fatal conditions are "the live feed did not load" and "the
// database is unreachable", because neither leaves anything to do.

import { readFile, writeFile } from 'node:fs/promises';
import { Pool } from 'pg';
import {
  buildLiveUrl,
  buildScheduleUrl,
  fetchUpstream,
  indiaDate,
  shiftDate,
  LIVE_REQUEST_TIMEOUT_MS,
  SCHEDULE_REQUEST_TIMEOUT_MS,
} from '../ingestion/upsrtc/client.js';
import { isUnassignedScheduleResponse } from '../ingestion/upsrtc/normalize.js';
import { loadEnv } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { MAX_STOP_DETOUR_METERS } from './geometry.js';
import {
  harvestNetwork,
  planProbes,
  DEFAULT_CONTROL_POINT_INTERVAL,
  DEFAULT_GAINS,
  DEFAULT_HEADWAY_SECONDS,
  DEFAULT_ROLLOUT_STAGE,
  type ProbeTarget,
  type ScheduleProbeResult,
} from './harvest.js';
import { persistNetworkSeed, type PersistResult } from './persist.js';

const ROLLOUT_STAGES = ['observation', 'shadow', 'advisory', 'limited_auto', 'expanded'] as const;

export interface SeedCliOptions {
  dryRun: boolean;
  routes: string[] | null;
  date: string | null;
  concurrency: number;
  rolloutStage: string;
  forceRolloutStage: boolean;
  defaultHeadwaySeconds: number;
  gains: { kf: number; kb: number; selfEqualizingK: number };
  reportPath: string | null;
  limit: number | null;
  maxStopDetourMeters: number;
  controlPointInterval: number;
  /**
   * Read the live-feed payload from a local JSON file instead of fetching
   * `getGpsLiveData.php`.
   *
   * The live endpoint is the seeder's single hard dependency — with no live
   * feed there is no vehicle inventory and no probe plan, so the run aborts.
   * That endpoint is also observably unreliable: it answers `HTTP 200` with a
   * one-byte body `F` during outages (sampled failing continuously for hours
   * on 2026-08-09), which is a normal-looking success to every layer above
   * the JSON parse. Being unable to seed at all whenever upstream sneezes is
   * not an acceptable property for the step that bootstraps the entire
   * network.
   *
   * A saved payload also makes a seed run reproducible — the same input
   * yields the same network — which is what lets the calibration and
   * geometry logic be verified against real-shaped data rather than against
   * whatever happened to be on the wire that minute.
   *
   * The SCHEDULE endpoint is still fetched live; this only substitutes the
   * live-feed fetch. Capture a payload with:
   *   curl -s https://margdarshi.upsrtcvlt.com/php/getGpsLiveData.php > live.json
   */
  liveFeedFile: string | null;
}

export const DEFAULT_CONCURRENCY = 5;
/** Upstream is a single shared PHP endpoint; more than this is impolite and no faster. */
const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 8;

function flagValue(argv: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  for (let index = argv.length - 1; index >= 0; index -= 1) {
    const arg = argv[index]!;
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

function hasFlag(argv: readonly string[], name: string): boolean {
  return argv.includes(`--${name}`);
}

function parsePositiveInt(raw: string | undefined, fallback: number, label: string): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${label} must be a positive number`);
  return Math.floor(value);
}

/** `--gains=kf,kb,selfEqualizingK`, e.g. `--gains=0.4,0.2,0.35`. */
export function parseGains(raw: string | undefined): { kf: number; kb: number; selfEqualizingK: number } {
  if (raw === undefined) return { ...DEFAULT_GAINS };
  const parts = raw.split(',').map((part) => Number(part.trim()));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    throw new Error('--gains must be three finite numbers: --gains=kf,kb,selfEqualizingK');
  }
  return { kf: parts[0]!, kb: parts[1]!, selfEqualizingK: parts[2]! };
}

export function parseArgs(argv: readonly string[]): SeedCliOptions {
  const rolloutStage = flagValue(argv, 'rollout-stage') ?? DEFAULT_ROLLOUT_STAGE;
  if (!(ROLLOUT_STAGES as readonly string[]).includes(rolloutStage)) {
    throw new Error(`--rollout-stage must be one of: ${ROLLOUT_STAGES.join(', ')}`);
  }

  const date = flagValue(argv, 'date') ?? null;
  if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('--date must be YYYY-MM-DD');
  }

  const requestedConcurrency = parsePositiveInt(
    flagValue(argv, 'concurrency'),
    DEFAULT_CONCURRENCY,
    'concurrency',
  );

  const routesRaw = flagValue(argv, 'routes');
  const detourRaw = flagValue(argv, 'max-stop-detour-meters');

  return {
    dryRun: hasFlag(argv, 'dry-run'),
    routes: routesRaw
      ? routesRaw
          .split(',')
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      : null,
    date,
    concurrency: Math.min(MAX_CONCURRENCY, Math.max(MIN_CONCURRENCY, requestedConcurrency)),
    rolloutStage,
    forceRolloutStage: hasFlag(argv, 'force-rollout-stage'),
    defaultHeadwaySeconds: parsePositiveInt(
      flagValue(argv, 'default-headway-seconds'),
      DEFAULT_HEADWAY_SECONDS,
      'default-headway-seconds',
    ),
    gains: parseGains(flagValue(argv, 'gains')),
    reportPath: flagValue(argv, 'report') ?? null,
    limit: flagValue(argv, 'limit') === undefined
      ? null
      : parsePositiveInt(flagValue(argv, 'limit'), 1, 'limit'),
    liveFeedFile: flagValue(argv, 'live-feed-file') ?? null,
    // Explicit 0 disables outlier pruning; absent means the default.
    maxStopDetourMeters:
      detourRaw === undefined ? MAX_STOP_DETOUR_METERS : Math.max(0, Number(detourRaw)),
    controlPointInterval: parsePositiveInt(
      flagValue(argv, 'control-point-interval'),
      DEFAULT_CONTROL_POINT_INTERVAL,
      'control-point-interval',
    ),
  };
}

/**
 * Hand-rolled bounded-concurrency map. No new dependency, and nothing here
 * needs more than "run at most N of these at a time, keep every result": N
 * workers pull from a shared cursor, so a slow response never idles the others
 * the way a fixed chunked Promise.all would.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const run = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!, index);
    }
  };

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, run));
  return results;
}

/**
 * Fetch one vehicle-day, retrying once on the previous service date.
 *
 * `" Bus Not Assigned!!! "` (a bare JSON string, HTTP 200) is the single most
 * common answer this endpoint gives: 9 of 10 probes on the current date get it,
 * versus 3 of 12 on date-1, because the day's duties are not published until
 * the day is under way. So the retry is not a nicety — it is the difference
 * between a ~10% and a ~75% harvest yield.
 */
export async function fetchScheduleWithRetry(
  probe: ProbeTarget,
  date: string,
): Promise<ScheduleProbeResult> {
  const attempt = async (attemptDate: string): Promise<ScheduleProbeResult> => {
    const response = await fetchUpstream(
      buildScheduleUrl(probe.registrationNumber, attemptDate),
      SCHEDULE_REQUEST_TIMEOUT_MS,
    );
    return {
      registrationNumber: probe.registrationNumber,
      routeName: probe.routeName,
      date: attemptDate,
      payload: response.ok ? response.payload : null,
      error: response.ok ? null : (response.error ?? 'upstream error'),
    };
  };

  const first = await attempt(date);
  if (!first.error && !isUnassignedScheduleResponse(first.payload)) return first;

  const second = await attempt(shiftDate(date, -1));
  if (!second.error && !isUnassignedScheduleResponse(second.payload)) return second;

  // Report the original date's outcome — the retry is an implementation
  // detail, and the operator asked about `date`.
  return first;
}

/**
 * Print the H* provenance breakdown, and say plainly what a fabricated target
 * costs.
 *
 * This is a `warn`, not another `info` line among twenty, because the situation
 * it describes is invisible everywhere else: a route-direction seeded with the
 * fallback raises no error, fails no constraint and never appears in
 * `failures` — it simply never triggers bunching detection again, and its CV
 * and EWT on the dashboard are ratios against a number nobody measured. The
 * only moment anyone is in a position to notice is the run that wrote it, so
 * the run has to say so rather than leaving it to be discovered by SQL.
 */
export function logHeadwayCalibration(
  report: ReturnType<typeof harvestNetwork>['report'],
  fallbackSeconds: number,
): void {
  const calibration = report.headwayCalibration;
  const total = calibration.journey_span + calibration.fleet_span + calibration.default;
  const share = (count: number): string =>
    total === 0 ? '0.0%' : `${((count / total) * 100).toFixed(1)}%`;

  logger.info(
    {
      journey_span: calibration.journey_span,
      fleet_span: calibration.fleet_span,
      default: calibration.default,
      derivedPct: share(calibration.journey_span + calibration.fleet_span),
      fabricatedPct: share(calibration.default),
      fleetRouteNames: report.fleetDepartures.routeNames,
      fleetRouteNamesWithMultipleDepartures: report.fleetDepartures.withMultipleDepartures,
      implausibleDerivationsRejected: report.implausibleHeadways.length,
    },
    'seed: target headway (H*) calibration by source',
  );

  if (calibration.default > 0) {
    logger.warn(
      {
        directions: calibration.default,
        share: share(calibration.default),
        fallbackSeconds,
      },
      'seed: these route-directions carry a FABRICATED target headway — every threshold in src/headway/ is a ratio of H*, so they are effectively excluded from bunching detection and their CV/EWT are meaningless. Find them with: select * from route_policies where effective_to is null and calibration_source = \'default\'',
    );
  }
}

interface SeedRunSummary {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  dryRun: boolean;
  serviceDate: string;
  options: Omit<SeedCliOptions, 'reportPath'>;
  harvest: ReturnType<typeof harvestNetwork>['report'];
  persist: PersistResult | null;
}

export async function runSeed(argv: readonly string[]): Promise<number> {
  const options = parseArgs(argv);
  const startedAt = new Date();
  const serviceDate = options.date ?? indiaDate(startedAt);

  logger.info(
    {
      dryRun: options.dryRun,
      serviceDate,
      concurrency: options.concurrency,
      rolloutStage: options.rolloutStage,
      limit: options.limit,
    },
    'seed: starting network harvest',
  );

  // ---- live feed ---------------------------------------------------------
  // Either read a saved payload (--live-feed-file) or fetch the live endpoint.
  // Both paths converge on the same `payload` so planProbes cannot tell them
  // apart; the file path is parsed with the same tolerance as the wire path
  // because a captured payload is byte-identical to what the wire returned.
  let livePayload: unknown;
  if (options.liveFeedFile) {
    let raw: string;
    try {
      raw = await readFile(options.liveFeedFile, 'utf8');
    } catch (error) {
      logger.error(
        { file: options.liveFeedFile, error: error instanceof Error ? error.message : String(error) },
        'seed: --live-feed-file could not be read',
      );
      return 1;
    }
    try {
      livePayload = JSON.parse(raw);
    } catch {
      // Same failure the wire path guards against: the upstream answers 200
      // with a one-byte `F` during outages, so a captured payload can easily
      // be that sentinel rather than data.
      logger.error(
        { file: options.liveFeedFile, bytes: raw.length, head: raw.slice(0, 32) },
        'seed: --live-feed-file is not valid JSON',
      );
      return 1;
    }
    logger.info({ file: options.liveFeedFile }, 'seed: using saved live feed (upstream not contacted)');
  } else {
    const live = await fetchUpstream(buildLiveUrl(), LIVE_REQUEST_TIMEOUT_MS);
    if (!live.ok) {
      // Fatal: with no live feed there is no vehicle inventory and no probe plan.
      logger.error(
        { error: live.error, status: live.status },
        'seed: live feed unavailable (pass --live-feed-file=<path> to seed from a saved payload)',
      );
      return 1;
    }
    livePayload = live.payload;
  }

  const plan = planProbes(livePayload);
  logger.info(
    { vehicles: plan.vehicles.length, probes: plan.probes.length },
    'seed: live feed parsed',
  );

  let probes = plan.probes;
  if (options.routes) {
    const wanted = new Set(options.routes);
    probes = probes.filter((probe) => wanted.has(probe.routeName));
    logger.info({ requested: options.routes.length, matched: probes.length }, 'seed: --routes filter applied');
  }
  if (options.limit !== null) probes = probes.slice(0, options.limit);

  // ---- schedule probes ---------------------------------------------------
  let completed = 0;
  const probeResults = await mapWithConcurrency(probes, options.concurrency, async (probe) => {
    const result = await fetchScheduleWithRetry(probe, serviceDate);
    completed += 1;
    if (completed % 25 === 0 || completed === probes.length) {
      logger.info({ completed, total: probes.length }, 'seed: schedule probes');
    }
    return result;
  });

  // ---- harvest -----------------------------------------------------------
  const seed = harvestNetwork(livePayload, probeResults, {
    defaultHeadwaySeconds: options.defaultHeadwaySeconds,
    gains: options.gains,
    rolloutStage: options.rolloutStage,
    controlPointInterval: options.controlPointInterval,
    maxStopDetourMeters: options.maxStopDetourMeters,
  });

  logger.info(
    {
      routes: seed.routes.length,
      directions: seed.report.directionsAccepted,
      stops: seed.stops.length,
      vehicles: seed.vehicles.length,
      skipped: seed.report.skippedRoutes.length,
      droppedStops: seed.report.droppedStops.length,
    },
    'seed: harvest complete',
  );

  logHeadwayCalibration(seed.report, options.defaultHeadwaySeconds);

  // ---- persist -----------------------------------------------------------
  const env = loadEnv();
  // A dedicated pool rather than db/pool.ts's: that one sets
  // statement_timeout to 10s for request handlers, which a ~9,300-row bulk
  // vehicle upsert can legitimately exceed. A batch job gets batch bounds.
  const pool = new Pool({
    connectionString: env.CONTROL_SERVICE_DATABASE_URL,
    max: 4,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 120_000,
  });

  let persist: PersistResult | null = null;
  let exitCode = 0;
  try {
    persist = await persistNetworkSeed(
      pool,
      seed,
      { dryRun: options.dryRun, forceRolloutStage: options.forceRolloutStage },
      (event) => {
        if (event.error) {
          logger.warn(
            { routeId: event.routeId, directionCode: event.directionCode, error: event.error },
            'seed: route-direction failed',
          );
        }
      },
    );

    logger.info(
      {
        dryRun: options.dryRun,
        vehicles: persist.vehiclesWritten,
        routes: persist.routesWritten,
        directions: persist.directionsWritten,
        shapes: persist.shapesWritten,
        stops: persist.stopsWritten,
        routeDirectionStops: persist.routeDirectionStopsWritten,
        policiesInserted: persist.policiesInserted,
        policiesUnchanged: persist.policiesUnchanged,
        rolloutStagesWritten: persist.rolloutStagesWritten,
        rolloutStagesPreserved: persist.rolloutStagesPreserved,
        failures: persist.failures.length,
        shapeDriftOverTolerance: persist.shapeDrift.length,
      },
      'seed: persist complete',
    );

    for (const drift of persist.shapeDrift) {
      logger.warn(drift, 'seed: stored total_distance_meters disagrees with ST_Length(geom)');
    }
    if (persist.failures.length > 0) exitCode = 2;
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'seed: persist failed');
    exitCode = 1;
  } finally {
    await pool.end();
  }

  // ---- report ------------------------------------------------------------
  if (options.reportPath) {
    const finishedAt = new Date();
    const { reportPath: _reportPath, ...reportedOptions } = options;
    const summary: SeedRunSummary = {
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      dryRun: options.dryRun,
      serviceDate,
      options: reportedOptions,
      harvest: seed.report,
      persist,
    };
    await writeFile(options.reportPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    logger.info({ path: options.reportPath }, 'seed: report written');
  }

  return exitCode;
}

// Only self-executes when run as a script, so tests can import the helpers
// above without kicking off a live harvest.
const invokedDirectly =
  process.argv[1] !== undefined && /[\\/]seed[\\/]index\.(ts|js)$/.test(process.argv[1]);

if (invokedDirectly) {
  runSeed(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'seed: unhandled failure',
      );
      process.exitCode = 1;
    });
}
