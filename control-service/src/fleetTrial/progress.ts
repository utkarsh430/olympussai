// What a running fleet trial can honestly say about itself.
//
// ─── WHY THIS IS A COUNT AND NEVER AN ESTIMATE ───────────────────────────
//
// A trial is a fixed number of simulated runs, and every one of them is known
// BEFORE the first is started: the phases are `PHASES.length x scenarios`, and
// every policy study is `variants x STUDY_SEEDS x scenarios` over a variant
// list built from the corridor spec. So the denominator is not a guess and the
// numerator is not a clock - "142 of 437 runs" is a fact about work completed,
// which is the only claim this file will make.
//
// It deliberately does NOT publish a percentage, a bar fraction or a time
// remaining. The runs are not equal in cost (a phase run at 1,000 buses per
// phase carries four times the fleet of a study run, which is capped at
// `MAX_STUDY_VEHICLES`), so a fraction of runs is NOT a fraction of the wait,
// and anything derived from it would be exactly the confident-sounding lie
// this reporting exists to replace. `OpsCoverage` in the web app renders the
// pair for the same reason and says so: a percentage hides the denominator,
// and the denominator is the honest part.
//
// ─── THE TOTAL AND THE COUNT ARE ONE EXPRESSION, OR THEY DRIFT ───────────
//
// `plannedUnitCount` below and the loops in `run.ts` have to agree exactly. If
// a future study is added to the trial and not to the plan, the count would
// walk past its own total and the console would report "500 of 437" - or, far
// worse, stall at 437 while real work continued, which is the stalled-bar
// failure again with extra steps. They are not kept in agreement by care:
// `test/fleetTrial/progress.test.ts` runs a real trial, counts the units it
// actually reports, and fails if that number is not the one planned.

/**
 * Which part of the trial is running.
 *
 * Four, because these are the four things `run.ts` does that take measurable
 * time, and an operator watching a 30 s run wants to know which one it is in.
 */
export type FleetTrialStage =
  | 'phases'
  | 'policy_study'
  | 'occupancy_contrast'
  | 'self_equalizing';

/** Plain-language stage names. Operator-facing: no module names, no jargon. */
export const FLEET_TRIAL_STAGE_LABEL: Record<FleetTrialStage, string> = {
  phases: 'Simulating both phases',
  policy_study: 'Sweeping the policy settings',
  occupancy_contrast: 'Re-running phase 2 with the occupancy switch off',
  self_equalizing: 'Measuring the self-equalizing fallback',
};

export interface FleetTrialProgress {
  /** Simulated runs finished. Counts from 1; equals `total` on the last one. */
  done: number;
  /** Simulated runs this trial will do in all, known before the first starts. */
  total: number;
  stage: FleetTrialStage;
  /**
   * What is running right now, in words - the stage, and within it the
   * scenario or variant. Shown to an operator, so it names things the console
   * already names rather than internal ids where it can.
   */
  label: string;
}

export type FleetTrialProgressReporter = (progress: FleetTrialProgress) => void;

/**
 * How many of `scenarioCount` scenarios a fleet of `vehiclesPerPhase` actually
 * runs.
 *
 * The same base/remainder split `run.ts` does, including its floor of two
 * buses per run - a scenario handed one bus has no pair to measure a headway
 * between, so the studies `continue` past it. Duplicated here rather than
 * assumed away: the phase loop THROWS below two buses while the studies skip
 * quietly, so the two are not interchangeable and a plan that assumed the
 * phase rule would over-count on a small fleet.
 */
export function eligibleScenarioCount(vehiclesPerPhase: number, scenarioCount: number): number {
  if (scenarioCount <= 0) return 0;
  const base = Math.floor(vehiclesPerPhase / scenarioCount);
  const remainder = vehiclesPerPhase - base * scenarioCount;
  let eligible = 0;
  for (let index = 0; index < scenarioCount; index++) {
    if (base + (index < remainder ? 1 : 0) >= 2) eligible++;
  }
  return eligible;
}

/**
 * Every simulated run this trial will do, counted before it starts.
 *
 * Takes the variant counts rather than computing them, because the lists they
 * come from are built in `run.ts` from the corridor spec - passing the counts
 * keeps this module free of the corridor and keeps ONE place building the
 * variants that both the plan and the loop read.
 */
export function plannedUnitCount(args: {
  phaseCount: number;
  scenarioCount: number;
  /** One entry per policy study, in the order `run.ts` runs them. */
  policyStudyVariantCounts: readonly number[];
  studySeeds: number;
  /** Fleet the studies run at - capped below the trial's own. */
  studyVehiclesPerPhase: number;
  /** Fleet the phases run at. */
  vehiclesPerPhase: number;
  /** Whether the occupancy contrast re-simulates the aware phase's runs. */
  occupancyContrastRuns: number;
}): number {
  const {
    phaseCount,
    scenarioCount,
    policyStudyVariantCounts,
    studySeeds,
    studyVehiclesPerPhase,
    vehiclesPerPhase,
    occupancyContrastRuns,
  } = args;

  const phaseUnits = phaseCount * eligibleScenarioCount(vehiclesPerPhase, scenarioCount);
  const studyScenarios = eligibleScenarioCount(studyVehiclesPerPhase, scenarioCount);
  const studyUnits = policyStudyVariantCounts.reduce(
    (acc, variants) => acc + variants * studySeeds * studyScenarios,
    0,
  );
  // The self-equalizing coverage arm runs the scenario list once at the study
  // fleet, exactly like one seed of one variant.
  const selfEqualizingUnits = studyScenarios;
  return phaseUnits + studyUnits + occupancyContrastRuns + selfEqualizingUnits;
}
