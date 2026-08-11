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
// H* (target_headway_seconds) comes from the PUBLISHED TIMETABLE
// (getStaticData.php, src/seed/timetable.ts), which is fetched by default and
// is the only source that can say how often a route is SERVED. A run that
// cannot get one ABORTS rather than quietly reverting to the fabricated
// fallback; --no-timetable is how an operator asks for that fallback out loud.
//
//   pnpm seed --recalibrate-only            # fix H* on the existing network
//   pnpm seed --timetable-out=/tmp/tt.json  # capture the corpus
//   pnpm seed --recalibrate-only --timetable-file=/tmp/tt.json --dry-run
//
// --recalibrate-only exists because the harvest depends on the live feed
// publishing a `routename` per vehicle and the feed does not always do so
// (MEASURED 2026-08-10: zero of 9,155 records carried one, so a full harvest
// yields an empty network). Geometry does not go stale on the timescale a
// headway does.
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
import {
  fetchStaticData,
  normalizeTimetablePayloads,
  splitTimetableCorpus,
  STATIC_DATA_STOP_CODES,
} from '../ingestion/upsrtc/staticData.js';
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
  HEADWAY_CALIBRATION_SOURCES,
  type ProbeTarget,
  type ScheduleProbeResult,
} from './harvest.js';
import { persistNetworkSeed, type PersistResult } from './persist.js';
import { recalibrateHeadways, summarizeRecalibration, type RecalibrateResult } from './recalibrate.js';
import { buildTimetableIndex, type TimetableIndex } from './timetable.js';

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
  /**
   * Read the TIMETABLE corpus from a local JSON file instead of fetching
   * getStaticData.php across every stop code.
   *
   * Same rationale as `liveFeedFile`, and a stronger one. H* is now derived
   * from this corpus, so a seed run's most consequential output — whether a
   * route-direction can ever be flagged as bunched — depends on it. Being able
   * to re-run the exact derivation over the exact bytes is what makes that
   * auditable rather than "whatever the wire said that minute". It also
   * collapses 24 requests to a shared PHP host into zero.
   *
   * Accepts an array of rows, an array of per-stop arrays, or a stop-code ->
   * payload object, so any reasonable capture works unmodified. Produce one
   * with --timetable-out.
   */
  timetableFile: string | null;
  /** Write the fetched timetable corpus here, for a later --timetable-file run. */
  timetableOut: string | null;
  /**
   * Do not use a timetable at all: fall back to the vehicle-derived estimators
   * ('journey_span' / 'fleet_span' / 'default').
   *
   * Opt-in rather than automatic BECAUSE of what it does — it re-enables the
   * fabricated fallback that put 435 of 656 route-directions outside detection.
   * Degrading to that silently on a bad fetch would hide the one thing anybody
   * needs to know about the run.
   */
  noTimetable: boolean;
  /**
   * Skip the harvest; only re-derive H* for route-directions already in the
   * database (src/seed/recalibrate.ts).
   *
   * The harvest needs the live feed to publish a `routename` per vehicle to
   * plan its probes. MEASURED 2026-08-10: zero of 9,155 live records carried
   * one, so no harvest was possible at all — while 656 route-directions with
   * good geometry sat in the database carrying a fabricated headway. Geometry
   * does not go stale on the timescale a headway does; this mode fixes the
   * headway without pretending the network can be rebuilt.
   */
  recalibrateOnly: boolean;
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
    timetableFile: flagValue(argv, 'timetable-file') ?? null,
    timetableOut: flagValue(argv, 'timetable-out') ?? null,
    noTimetable: hasFlag(argv, 'no-timetable'),
    recalibrateOnly: hasFlag(argv, 'recalibrate-only'),
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
  const total = HEADWAY_CALIBRATION_SOURCES.reduce((sum, source) => sum + calibration[source], 0);
  const share = (count: number): string =>
    total === 0 ? '0.0%' : `${((count / total) * 100).toFixed(1)}%`;

  logger.info(
    {
      ...calibration,
      total,
      // `measuredPct` is the timetable alone — a reading of the published
      // service. `derivedPct` keeps its original meaning of "H* rests on some
      // evidence", which the timetable also satisfies, so the two overlap on
      // purpose and neither can be read as the other.
      measuredPct: share(calibration.timetable),
      derivedPct: share(calibration.timetable + calibration.journey_span + calibration.fleet_span),
      fabricatedPct: share(calibration.default),
      noTargetPct: share(calibration.none),
      timetableMatchesExact: report.timetableMatches.filter((entry) => entry.match === 'exact').length,
      timetableMatchesSoleDirection: report.timetableMatches.filter(
        (entry) => entry.match === 'sole_direction',
      ).length,
      timetableLineDirections: report.timetable?.distinctLineDirections ?? 0,
      timetableHeadwaysDerived: report.timetable?.headwaysDerived ?? 0,
      timetableNoRepeatedDeparture: report.timetable?.headwaysNoRepeatedDeparture ?? 0,
      timetableImplausible: report.timetable?.headwaysImplausible.length ?? 0,
      fleetRouteNames: report.fleetDepartures.routeNames,
      fleetRouteNamesWithMultipleDepartures: report.fleetDepartures.withMultipleDepartures,
      implausibleDerivationsRejected: report.implausibleHeadways.length,
    },
    'seed: target headway (H*) calibration by source',
  );

  // KEPT VERBATIM, and it must be. A fabricated target raises no error, fails
  // no constraint and never appears in `failures` — the run that writes it is
  // the only moment anyone is placed to notice.
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

  // A DIFFERENT warning, deliberately not merged with the one above. 'none' is
  // also "no target", but it is the honest kind: nothing was invented, the
  // policy row is refused by loadActiveRoutePolicy, and the route-direction is
  // observation-only in a way that shows up in a `group by`. Collapsing the two
  // would lose exactly the distinction this work created.
  if (calibration.none > 0) {
    logger.warn(
      {
        directions: calibration.none,
        share: share(calibration.none),
      },
      'seed: these route-directions have NO target headway — the timetable published no repeated departure for them, so none was invented. They are observation-only: loadActiveRoutePolicy refuses the row and bunching detection is off for them, visibly. Find them with: select * from route_policies where effective_to is null and calibration_source = \'none\'',
    );
  }
}

/**
 * Load the timetable corpus, from a file or from the endpoint, and index it.
 *
 * Returns null when the run asked for no timetable, or when the corpus came
 * back empty — an empty corpus would mark EVERY route-direction 'none', which
 * is a truthful statement about a corpus that does not exist but a false one
 * about the network. A run that cannot get a timetable and was not told to
 * proceed without one aborts instead, because silently continuing is how the
 * fabricated-fallback regime became the default in the first place.
 */
async function loadTimetable(options: SeedCliOptions): Promise<TimetableIndex | null> {
  if (options.noTimetable) {
    logger.warn(
      {},
      'seed: --no-timetable — H* will fall back to the vehicle-derived estimators, which infer a service property from a sample of vehicles and produce a FABRICATED default when they cannot',
    );
    return null;
  }

  let payloads: unknown[];

  if (options.timetableFile) {
    let raw: string;
    try {
      raw = await readFile(options.timetableFile, 'utf8');
    } catch (error) {
      logger.error(
        {
          file: options.timetableFile,
          error: error instanceof Error ? error.message : String(error),
        },
        'seed: --timetable-file could not be read',
      );
      return null;
    }
    try {
      payloads = splitTimetableCorpus(JSON.parse(raw));
    } catch {
      logger.error(
        { file: options.timetableFile, bytes: raw.length, head: raw.slice(0, 32) },
        'seed: --timetable-file is not valid JSON',
      );
      return null;
    }
    logger.info(
      { file: options.timetableFile, payloads: payloads.length },
      'seed: using saved timetable (getStaticData not contacted)',
    );
  } else {
    // Sequential, not concurrent. There are only 24 of these, they are large,
    // and they hit the same shared PHP host the schedule probes are about to
    // hammer. Politeness costs about a minute once per run.
    const fetched: unknown[] = [];
    let failures = 0;
    let empty = 0;
    for (const stopCode of STATIC_DATA_STOP_CODES) {
      const response = await fetchStaticData(stopCode);
      if (response.error) {
        failures += 1;
        logger.warn({ stopCode, error: response.error }, 'seed: timetable stop fetch failed');
        continue;
      }
      const rowCount = Array.isArray(response.payload) ? response.payload.length : 0;
      // Codes 16 and 23 answer `[]` permanently. Normal, not a failure.
      if (rowCount === 0) empty += 1;
      fetched.push(response.payload);
    }
    logger.info(
      { stopCodes: STATIC_DATA_STOP_CODES.length, fetched: fetched.length, empty, failures },
      'seed: timetable fetched',
    );
    payloads = fetched;

    if (options.timetableOut) {
      await writeFile(options.timetableOut, `${JSON.stringify(payloads)}\n`, 'utf8');
      logger.info({ path: options.timetableOut }, 'seed: timetable corpus written');
    }
  }

  const { rows, rowCount, rejectedRowCount } = normalizeTimetablePayloads(payloads);
  if (rows.length === 0) {
    logger.error(
      { rowCount, rejectedRowCount },
      'seed: timetable corpus is empty — refusing to continue, since every route-direction would be marked uncalibrated. Pass --no-timetable to seed with the vehicle-derived estimators instead',
    );
    return null;
  }

  const index = buildTimetableIndex(rows);
  logger.info(
    {
      rowCount,
      rowsAccepted: index.report.rowsAccepted,
      rejectedRowCount,
      lines: index.report.distinctLines,
      lineDirections: index.report.distinctLineDirections,
      routeNames: index.report.distinctRouteNames,
      stopAreas: index.report.stopAreasWithRows.length,
      headwaysDerived: index.report.headwaysDerived,
      noRepeatedDeparture: index.report.headwaysNoRepeatedDeparture,
      implausible: index.report.headwaysImplausible.length,
    },
    'seed: timetable indexed',
  );
  return index;
}

interface SeedRunSummary {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  dryRun: boolean;
  serviceDate: string;
  options: Omit<SeedCliOptions, 'reportPath'>;
  harvest: ReturnType<typeof harvestNetwork>['report'] | null;
  persist: PersistResult | null;
  recalibrate: RecalibrateResult | null;
}

/**
 * A pool sized for a batch job rather than a request handler.
 *
 * db/pool.ts sets statement_timeout to 10s, which a ~9,300-row bulk vehicle
 * upsert can legitimately exceed.
 */
function openSeedPool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    max: 4,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 120_000,
  });
}

/**
 * Report a recalibration run at the same volume the harvest's calibration
 * summary is reported at, for the same reason: nothing downstream will ever
 * mention an uncalibrated route-direction again.
 */
function logRecalibration(result: RecalibrateResult): void {
  const summary = summarizeRecalibration(result);
  logger.info(
    {
      routeDirections: result.routeDirectionsConsidered,
      calibrated: result.calibrated,
      uncalibrated: result.uncalibrated,
      calibratedPct: summary.calibratedPct,
      matchesExact: result.matchesExact,
      matchesSoleDirection: result.matchesSoleDirection,
      policiesInserted: result.policiesInserted,
      policiesUnchanged: result.policiesUnchanged,
      fabricatedTargetsCleared: summary.fabricatedCleared,
      replacedByMeasurement: summary.replacedByMeasurement,
      failures: result.failures.length,
    },
    'seed: timetable recalibration complete',
  );

  if (result.uncalibrated > 0) {
    logger.warn(
      { directions: result.uncalibrated },
      'seed: these route-directions have NO target headway — the timetable published no repeated departure for them, so none was invented. They are observation-only: loadActiveRoutePolicy refuses the row and bunching detection is off for them, visibly. Find them with: select * from route_policies where effective_to is null and calibration_source = \'none\'',
    );
  }
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
      recalibrateOnly: options.recalibrateOnly,
    },
    'seed: starting network harvest',
  );

  const timetable = await loadTimetable(options);
  if (timetable === null && !options.noTimetable) {
    // Fatal, and deliberately so. Continuing without a timetable means
    // continuing with the fabricated fallback, which is the defect being fixed;
    // an operator who genuinely wants that must ask for it by name.
    logger.error(
      {},
      'seed: no timetable available — aborting. Pass --no-timetable to seed with the vehicle-derived estimators, or --timetable-file=<path> to use a saved corpus',
    );
    return 1;
  }

  // ---- recalibrate-only --------------------------------------------------
  if (options.recalibrateOnly) {
    if (!timetable) {
      logger.error({}, 'seed: --recalibrate-only needs a timetable and is meaningless without one');
      return 1;
    }
    const env = loadEnv();
    const pool = openSeedPool(env.CONTROL_SERVICE_DATABASE_URL);
    let recalibrate: RecalibrateResult | null = null;
    let exitCode = 0;
    try {
      recalibrate = await recalibrateHeadways(pool, timetable, {
        dryRun: options.dryRun,
        gains: options.gains,
      });
      logRecalibration(recalibrate);
      for (const failure of recalibrate.failures) {
        logger.warn(failure, 'seed: route-direction recalibration failed');
      }
      if (recalibrate.failures.length > 0) exitCode = 2;
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'seed: recalibration failed',
      );
      exitCode = 1;
    } finally {
      await pool.end();
    }

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
        harvest: null,
        persist: null,
        recalibrate,
      };
      await writeFile(options.reportPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
      logger.info({ path: options.reportPath }, 'seed: report written');
    }
    return exitCode;
  }

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
    timetable,
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
  const pool = openSeedPool(env.CONTROL_SERVICE_DATABASE_URL);

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
      recalibrate: null,
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
