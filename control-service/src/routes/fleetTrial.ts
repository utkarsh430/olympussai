// The fleet trial, over HTTP - web -> control-service, service-token
// authenticated like every other /v1 route.
//
//   POST /v1/fleet-trial          run a trial and return the full report
//   GET  /v1/fleet-trial/latest   the last report this process produced
//   GET  /v1/fleet-trial/progress what the trial running right now is doing
//
// READ-ONLY AND SIDE-EFFECT FREE, structurally rather than by promise:
// `src/fleetTrial/**` composes `src/simulation/**` (a pure in-memory
// computation over caller-supplied data) with the deployed control laws and
// the deployed detector, both of which are pure functions over plain data. It
// opens no transaction, issues no command, writes no headway sample and
// touches no live vehicle state. Unlike `routes/rehearsal.ts` it does not even
// SELECT: the corridor is built by arithmetic, not loaded.
//
// ─── HOW LONG A TRIAL ACTUALLY TAKES ─────────────────────────────────────
//
// This file used to say "a couple of seconds", and that number was wrong by an
// order of magnitude and load-bearing: it is why the web client's budget was
// set at 30 s. MEASURED, the inter-city preset at 1,000 buses per phase takes
// about 32 seconds - so the console's own budget expired before its own trial
// finished, and reported the healthy service it was talking to as unreachable.
// About 87% of that time is the policy studies, which is also why the trial's
// original phases-only progress callback could not describe it.
//
// `runFleetTrial` is SYNCHRONOUS, so for those 32 seconds this process answered
// nothing at all. It now runs on a worker - see `../fleetTrial/runner.ts` - and
// POST awaits it. The wire contract is unchanged: POST still returns the whole
// report, and a caller that ignores progress sees exactly what it saw before.
//
// ─── WHY THE LAST REPORT IS CACHED IN MEMORY ─────────────────────────────
//
// An operator opening the console does not want to re-run an experiment to look
// at it, and re-running would give them DIFFERENT numbers if anything about
// the corridor had been changed - which is the one thing a page an operator is
// reading from must not do. GET therefore serves exactly the bytes POST
// produced, and says when they were produced.
//
// The cache is per-process and deliberately not persisted. A trial is
// reproducible from its own spec, which travels inside the report, so nothing
// is lost by a restart and nothing has to be migrated.
//
// ─── AND WHY IT IS NOT PER-CALLER, WHICH IT LOOKS LIKE IT SHOULD BE ──────
//
// One variable, served to everybody: a trial anyone runs through this endpoint
// becomes what the next person opening the console sees. That is exactly how a
// 60-bus diagnostic run reporting -7.9% came to be read off a console whose own
// controls said 1,000 buses.
//
// The answer is NOT session state here. A trial is a pure computation over a
// spec that travels inside its own result; it writes nothing, reads no
// database, and produces no private data, so there is no user at this layer to
// attach a report to and no confidentiality argument for doing so. Sessions
// would add state to a deliberately stateless endpoint and STILL leave the real
// defect in place, because a stale report of your own misleads a reader exactly
// as much as a fresh one of somebody else's. What a reader needs is to be told
// what the report IS.
//
// So the provenance already in the payload - `generatedAt`, `corridorPreset`,
// and each phase's `vehicleCount` - is rendered by the console rather than
// ignored by it: see `ProvenanceBanner` in the web app's SimulatorConsole and
// `src/lib/ops/fleetTrialView.ts#trialProvenance`. If per-caller results are
// ever genuinely wanted, that is a persistence feature with an owner and a
// retention rule, not a module-level Map.
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, AppError, sendError } from '../lib/errors.js';
import { DEFAULT_FLEET_TRIAL_SPEC } from '../fleetTrial/run.js';
import { startTrial, currentProgress, TrialAlreadyRunningError } from '../fleetTrial/runner.js';
import { BUNCHING_SCENARIOS } from '../fleetTrial/scenarios.js';
import type { BunchingScenarioId } from '../fleetTrial/scenarios.js';
import type { CorridorPresetId } from '../fleetTrial/presets.js';
import { CORRIDOR_PRESETS } from '../fleetTrial/presets.js';
import type { FleetTrialReport } from '../fleetTrial/types.js';

export const fleetTrialRouter = Router();

const SCENARIO_IDS = BUNCHING_SCENARIOS.map((s) => s.id) as [string, ...string[]];
const PRESET_IDS = Object.keys(CORRIDOR_PRESETS) as [string, ...string[]];

/**
 * Bounds on the trial's shape.
 *
 * Every one is a REFUSAL, not a clamp - the same rule `routes/rehearsal.ts`
 * follows. A clamp quietly runs a different experiment from the one that was
 * asked for and returns it as if it were the answer, which on a surface whose
 * whole purpose is to be trustworthy about what it modelled is the worst
 * available behaviour.
 *
 * The upper bound on `vehiclesPerPhase` also bounds the work, though not by as
 * much as it looks: the phases are buses x stations x scenarios x 2 phases x 2
 * arms, but they are only about an eighth of the run - the policy studies
 * sweep their variants at a capped fleet and dominate it. Measured, 1,000 per
 * phase on the inter-city preset takes about 32 seconds.
 */
const bodySchema = z
  .object({
    vehiclesPerPhase: z.number().int().min(10).max(1000),
    scenarios: z.array(z.enum(SCENARIO_IDS)).min(1),
    seed: z.number().int().min(0).max(2_147_483_647),
    sweepIntervalSeconds: z.number().int().min(15).max(600),
    requiredSamples: z.number().int().min(1).max(10),
    followerSpeedSource: z.enum(['link_average', 'vehicle_state']),
    corridorPreset: z.enum(PRESET_IDS),
    /** Off by default and deliberately so - see FleetTrialSpec.alightingOnlySelectable. */
    alightingOnlySelectable: z.boolean(),
    corridor: z
      .object({
        totalDistanceMeters: z.number().int().min(10_000).max(1_000_000),
        stationCount: z.number().int().min(3).max(40),
        targetHeadwaySeconds: z.number().int().min(120).max(7200),
        maxHoldSeconds: z.number().int().min(0).max(3600),
        minimumActionSeconds: z.number().int().min(0).max(1800),
      })
      .partial()
      .strict(),
  })
  .partial()
  .strict();

/**
 * The last report this process produced, served to ANYONE opening the console.
 *
 * Shared, not per-caller, and deliberately - see the header. Every caller gets
 * the same bytes, so the console must say when they were produced and at what
 * fleet size rather than presenting them as the reader's own.
 */
let lastReport: FleetTrialReport | null = null;

/** Exported for tests, which must not inherit a report an earlier test ran. */
export function _resetFleetTrialCacheForTests(): void {
  lastReport = null;
}

fleetTrialRouter.post(
  '/v1/fleet-trial',
  asyncHandler(async (req, res) => {
    await Promise.resolve();
    const body = bodySchema.safeParse(req.body ?? {});
    if (!body.success) {
      sendError(
        res,
        new AppError('invalid_request', 'Invalid fleet trial inputs', 400, body.error.flatten()),
      );
      return;
    }

    const spec = {
      ...DEFAULT_FLEET_TRIAL_SPEC,
      ...body.data,
      // Narrowed by the schema's own enum, which is derived from the scenario
      // library - so an id that parses is by construction one that exists.
      scenarios: (body.data.scenarios ?? DEFAULT_FLEET_TRIAL_SPEC.scenarios) as BunchingScenarioId[],
      corridorPreset: (body.data.corridorPreset ??
        DEFAULT_FLEET_TRIAL_SPEC.corridorPreset) as CorridorPresetId,
      // Overrides ONLY. Spreading DEFAULT_FLEET_CORRIDOR here would replace the
      // preset's whole shape with the inter-city one, which is the same class of
      // bug that made the urban corridor run inter-city traffic.
      corridor: body.data.corridor ?? {},
    };

    // ─── ONE TRIAL AT A TIME ───────────────────────────────────────────
    //
    // 409 rather than a queue or a second worker. A second POST arriving
    // while one is in flight is a double click on a console that looked dead
    // for thirty seconds, and the honest answer to it is "the one you started
    // is still running", which is a thing the console can say. Running it
    // would also hand the second run's progress to the first run's watcher.
    let started;
    try {
      started = startTrial(spec);
    } catch (error) {
      if (error instanceof TrialAlreadyRunningError) {
        sendError(
          res,
          new AppError(
            'trial_already_running',
            'A trial is already running. Wait for it to finish - starting a second would not make either faster.',
            409,
          ),
        );
        return;
      }
      throw error;
    }

    let report;
    try {
      report = await started.done;
    } catch (error) {
      // The trial itself failed. Distinct from a bad request (400) and from
      // the service being unreachable, which this process cannot report about
      // itself - see the web app's error mapping. The trial's own words are
      // carried through because they are usually actionable.
      sendError(
        res,
        new AppError(
          'trial_failed',
          error instanceof Error
            ? `The trial did not finish: ${error.message}`
            : 'The trial did not finish, and gave no reason.',
          500,
        ),
      );
      return;
    }

    // Only a COMPLETED trial replaces the last good report. A failed or
    // refused run must leave whatever the console was showing exactly as it
    // found it.
    lastReport = report;
    res.status(200).json(report);
  }),
);

/**
 * What the trial running right now is doing.
 *
 * ─── THIS ROUTE IS THE REASON THE TRIAL MOVED OFF THIS THREAD ────────────
 *
 * `runFleetTrial` is synchronous and takes about thirty seconds on the
 * inter-city preset at 1,000 buses per phase. Run on the request thread it
 * blocks every other request in this process, so this endpoint would answer
 * only once the thing it is reporting on had already finished. It answers
 * because `runner.ts` puts the trial on a worker.
 *
 * `running: false` with 200 rather than a 404: "no trial is running" is a
 * complete, correct answer to the question asked, and a console polling this
 * every second must not have to read a 404 as data.
 */
fleetTrialRouter.get(
  '/v1/fleet-trial/progress',
  asyncHandler(async (_req, res) => {
    await Promise.resolve();
    const progress = currentProgress();
    if (!progress) {
      res.status(200).json({ running: false });
      return;
    }
    res.status(200).json({ running: true, ...progress });
  }),
);

fleetTrialRouter.get(
  '/v1/fleet-trial/latest',
  asyncHandler(async (_req, res) => {
    await Promise.resolve();
    if (!lastReport) {
      // 404 rather than an empty report. "No trial has been run in this
      // process" and "a trial was run and found nothing" are opposite
      // statements, and a caller must not have to tell them apart by
      // inspecting a zero.
      sendError(
        res,
        new AppError(
          'no_trial_run',
          'No fleet trial has been run since this service started. POST /v1/fleet-trial to run one.',
          404,
        ),
      );
      return;
    }
    res.status(200).json(lastReport);
  }),
);
