// What an evaluation run is, as data.
//
// ─── WHY THE SPEC IS A FILE AND NOT A PILE OF FLAGS ──────────────────────
//
// An evaluation exists to be believed later. Six months after a gain is
// changed on the strength of one, the only thing that can defend the change
// is a re-run that produces the same numbers - which needs the corridors, the
// scenarios, the seeds, the modelled inputs and the arms all recorded
// together, not reassembled from shell history. Every run therefore writes
// its own spec into its output directory alongside the results.
//
// Bounds are REFUSALS, not clamps, for the same reason `routes/rehearsal.ts`
// refuses: a clamp runs a different experiment from the one that was asked
// for and reports it as the answer.
import { z } from 'zod';
import { DEFAULT_MODELLED_INPUTS, REHEARSAL_DISTURBANCES } from '../rehearsal/run.js';
import type { ModelledInputs, RehearsalDisturbance } from '../rehearsal/run.js';

/**
 * The controller parameters an arm may override, per corridor.
 *
 * Exactly the `route_policies` columns a control law reads. Anything not
 * listed here is not sweepable by construction, which is the honest position:
 * `cooldown_seconds`, `minimum_action_seconds` and `max_concurrent_actions`
 * live in the command lifecycle, and this harness does not model it - see
 * `rehearsal/deployedControlLaws.ts`'s header. Offering them as knobs would
 * produce a confident optimum for a quantity the run never exercised.
 */
export const policyOverrideSchema = z
  .object({
    kf: z.number().min(0).max(3).nullable(),
    kb: z.number().min(0).max(3).nullable(),
    selfEqualizingK: z.number().min(0).max(3).nullable(),
    maxHoldSeconds: z.number().int().min(0).max(3600),
    bunchedThresholdRatio: z.number().min(0.01).max(1),
    warningThresholdRatio: z.number().min(0.01).max(1),
    ks: z.number().min(0).max(3).nullable(),
  })
  .partial()
  .strict();

export type PolicyOverride = z.infer<typeof policyOverrideSchema>;

export const armSchema = z
  .object({
    /** Short, stable, and used as a column heading and a filename. */
    name: z.string().min(1).max(64),
    policyOverrides: policyOverrideSchema.default({}),
    /** Whether `cost_optimal_hold` may be selected. Defaults to the deployed switch. */
    costOptimalSelectable: z.boolean().optional(),
    /** Whether the objective weighs the in-vehicle term. Defaults to the rehearsal's own default (true). */
    weighOccupancy: z.boolean().optional(),
  })
  .strict();

export type ArmSpec = z.infer<typeof armSchema>;

/**
 * Bounds mirror `routes/rehearsal.ts`'s, because a corridor evaluated here and
 * a corridor rehearsed there must be the same corridor under the same rules.
 */
export const modelledInputsSchema = z
  .object({
    cruiseSpeedKmph: z.number().min(5).max(120),
    travelTimeVariation: z.number().min(0).max(1),
    boardingRatePerMinute: z.number().min(0).max(120),
    alightingFraction: z.number().min(0).max(1),
    baseDwellSeconds: z.number().min(0).max(600),
    secondsPerBoarding: z.number().min(0).max(60),
    secondsPerAlighting: z.number().min(0).max(60),
    vehicleCapacity: z.number().int().min(1).max(400),
    vehicleCount: z.number().int().min(2).max(24),
  })
  .partial()
  .strict();

export const corridorSourceSchema = z.discriminatedUnion('source', [
  z
    .object({
      source: z.literal('db'),
      /** Explicit ids, or `sample` to take a spread of calibrated corridors. */
      routeDirectionIds: z.array(z.string().min(1)).min(1).optional(),
      sample: z.number().int().min(1).max(200).optional(),
    })
    .strict(),
  z
    .object({
      source: z.literal('synthetic'),
      /** How many synthetic corridors, each a different length/stop-count, so a result is not one corridor's accident. */
      count: z.number().int().min(1).max(20).default(1),
    })
    .strict(),
]);

export type CorridorSource = z.infer<typeof corridorSourceSchema>;

export const experimentSpecSchema = z
  .object({
    name: z.string().min(1).max(80),
    corridors: corridorSourceSchema,
    scenarios: z
      .array(z.enum(REHEARSAL_DISTURBANCES as unknown as [string, ...string[]]))
      .min(1)
      .default([...REHEARSAL_DISTURBANCES]),
    seeds: z
      .object({
        count: z.number().int().min(1).max(500),
        base: z.number().int().min(0).max(2_000_000_000).default(20260820),
      })
      .strict(),
    inputs: modelledInputsSchema.default({}),
    /**
     * The arms compared. The uncontrolled baseline is NOT listed: every arm is
     * compared against a no-control run on the identical seeded scenario, and
     * making that opt-in would allow an evaluation with nothing to compare to.
     */
    arms: z.array(armSchema).min(1),
    /**
     * Compliance levels to re-run the winning arm at, as probabilities.
     * `algo_new.md` section 8.4 requires the degradation curve: a gain set
     * that wins only at perfect compliance is not a recommendation, and the
     * CTA deployment it cites achieved its results at 35-57%.
     */
    complianceSweep: z.array(z.number().min(0).max(1)).max(10).default([]),
    /** Travel-time variation levels to re-run the winning arm at (`algo_new.md` 8.4). */
    variabilitySweep: z.array(z.number().min(0).max(1)).max(10).default([]),
  })
  .strict();

export type ExperimentSpec = z.infer<typeof experimentSpecSchema>;

export function parseExperimentSpec(input: unknown): ExperimentSpec {
  return experimentSpecSchema.parse(input);
}

/**
 * Modelled demand for an EVALUATION, which is not the same job as a
 * rehearsal's.
 *
 * `DEFAULT_MODELLED_INPUTS` is tuned for a single rehearsal a planner looks
 * at: 1.5 boardings/min against 18% alighting and 52 seats. MEASURED on those
 * numbers, the steady-state load is `boardings x H* / alightingFraction` ~=
 * 125 passengers against 52 seats, so the buses run at capacity end to end and
 * 39% of offered passengers are denied. A saturated corridor is the one
 * regime in which the headline metric CANNOT respond to control: waiting time
 * is bounded by how many seats exist, not by how they are spaced, and holding
 * a full bus only strands more people. An evaluation run on it reports "no
 * effect" about a working controller.
 *
 * These defaults leave headroom (0.8/min against 25% alighting gives a
 * steady-state load near 48 of 52 seats) and carry more travel-time
 * variability, so the corridor actually comes apart and there is something
 * for a control law to fix. Still invented - see `rehearsal/run.ts`'s header.
 * A spec that names its own `inputs` overrides these.
 */
export const EVALUATION_DEFAULT_INPUTS: Partial<ModelledInputs> = {
  boardingRatePerMinute: 0.8,
  alightingFraction: 0.25,
  travelTimeVariation: 0.2,
};

/** Modelled inputs for one run: the spec's overrides on the shared defaults, with the seed and disturbance this cell is for. */
export function resolveInputs(
  spec: ExperimentSpec,
  seed: number,
  disturbance: RehearsalDisturbance,
  overrides: Partial<ModelledInputs> = {},
): ModelledInputs {
  return {
    ...DEFAULT_MODELLED_INPUTS,
    ...EVALUATION_DEFAULT_INPUTS,
    ...spec.inputs,
    ...overrides,
    seed,
    disturbance,
  };
}

/**
 * The seeds an experiment draws, derived from the base rather than random.
 *
 * The SAME seed drives every arm and the baseline, which is what makes a
 * difference attributable to the controller instead of to the day - see
 * `statistics.ts`. Deriving them from a recorded base is what makes the whole
 * experiment re-runnable.
 */
export function seedsFor(spec: ExperimentSpec): number[] {
  return Array.from({ length: spec.seeds.count }, (_, index) => spec.seeds.base + index);
}
