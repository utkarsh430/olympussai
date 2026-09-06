// The fleet trial, over HTTP - web -> control-service, service-token
// authenticated like every other /v1 route.
//
//   POST /v1/fleet-trial          run a trial and return the full report
//   GET  /v1/fleet-trial/latest   the last report this process produced
//
// READ-ONLY AND SIDE-EFFECT FREE, structurally rather than by promise:
// `src/fleetTrial/**` composes `src/simulation/**` (a pure in-memory
// computation over caller-supplied data) with the deployed control laws and
// the deployed detector, both of which are pure functions over plain data. It
// opens no transaction, issues no command, writes no headway sample and
// touches no live vehicle state. Unlike `routes/rehearsal.ts` it does not even
// SELECT: the corridor is built by arithmetic, not loaded.
//
// ─── WHY THE LAST REPORT IS CACHED IN MEMORY ─────────────────────────────
//
// A trial simulates a thousand buses and takes a couple of seconds. That fits
// inside the web client's 8 s budget, so POST returns the real thing. But an
// operator opening the console does not want to re-run an experiment to look
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
import { runFleetTrial, DEFAULT_FLEET_TRIAL_SPEC } from '../fleetTrial/run.js';
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
 * The upper bound on `vehiclesPerPhase` also bounds the work: buses x stations
 * x scenarios x 2 phases x 2 arms is the size of the run, and 1,000 per phase
 * over ten stations completes in about two seconds - comfortably inside the
 * web client's request budget.
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

    const report = runFleetTrial({
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
    });
    lastReport = report;
    res.status(200).json(report);
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
