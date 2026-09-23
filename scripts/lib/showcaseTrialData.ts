/**
 * The extractor behind `pnpm showcase:build-data`.
 *
 * Pure: takes parsed `FleetTrialReport`s and returns the `TrialData` shape
 * that `src/lib/showcase/trialData.ts` declares, so the same function can be
 * driven by the script over the real reports and by a unit test over a
 * hand-built one. No I/O, no clock - `builtAt` is an input, which is what
 * makes two runs over the same reports byte-identical.
 *
 * Relative imports throughout: this runs under `tsx` from `scripts/`, and the
 * `@/` alias belongs to the app.
 */
import { headlineNetPassengerTime } from '../../src/lib/ops/fleetTrialView';
import type {
  TrialArmSummary,
  TrialContrast,
  TrialCorridorData,
  TrialData,
  TrialPhase,
  TrialScenario,
  TrialSweepPoint,
} from '../../src/lib/showcase/trialData';
import {
  corridorPresetIdSchema,
  type ArmContrast,
  type ArmReport,
  type BunchingScenarioId,
  type CorridorPresetId,
  type FleetTrialReport,
  type PhaseId,
  type PhaseReport,
  type ScenarioReport,
  type SweepSample,
} from '../../src/models/fleetTrial';

export interface ExtractOptions {
  /** The phase whose per-scenario figures and replay the page leads with. */
  headlinePhaseId: PhaseId;
  /** Scenarios whose full trajectories are kept, in the order the picker offers them. */
  replayScenarioIds: BunchingScenarioId[];
  /** The corridors whose replay scenarios carry trajectories, in the headline phase. */
  replayPresetIds: readonly CorridorPresetId[];
  /**
   * Whether scenarios outside the headline phase keep their sweep curves.
   * Off, they carry empty arrays: nothing on the page reads the other phase's
   * curves, and they are the bulk of the file once every corridor replays.
   */
  sweepsForNonHeadlinePhase: boolean;
  /** Upper bound on sweep samples kept per arm; the first and last always survive. */
  sweepPoints: number;
  builtAt: string;
}

/** The order the page walks the corridors in, whatever order the reports arrived. */
export const PRESET_ORDER: readonly CorridorPresetId[] = ['urban', 'suburban', 'intercity'];

export const DEFAULT_EXTRACT_OPTIONS: Omit<ExtractOptions, 'builtAt'> = {
  headlinePhaseId: 'occupancy_blind',
  replayScenarioIds: ['steady_variability', 'slow_bus', 'traffic_shock'],
  replayPresetIds: PRESET_ORDER,
  sweepsForNonHeadlinePhase: false,
  sweepPoints: 60,
};

/**
 * Keep at most `maxPoints` samples by even index sampling.
 *
 * The first and last samples are always kept: the curves these feed are drawn
 * against the scenario's horizon, and a decimation that dropped the endpoint
 * would draw a run that ended early.
 */
export function decimate<T>(samples: readonly T[], maxPoints: number): T[] {
  if (!Number.isInteger(maxPoints) || maxPoints < 2) {
    throw new Error(`sweepPoints must be an integer of at least 2, got ${maxPoints}`);
  }
  if (samples.length <= maxPoints) return [...samples];
  const last = samples.length - 1;
  const kept: T[] = [];
  for (let i = 0; i < maxPoints; i += 1) {
    const index = Math.round((i * last) / (maxPoints - 1));
    const sample = samples[index];
    if (sample !== undefined) kept.push(sample);
  }
  return kept;
}

function sweepPoint(sample: SweepSample): TrialSweepPoint {
  return {
    atSeconds: sample.atSeconds,
    openIncidents: sample.openIncidents,
    bunchedPairs: sample.bunchedPairs,
    liveVehicles: sample.liveVehicles,
  };
}

function contrast(source: ArmContrast): TrialContrast {
  return {
    ewtImprovementPercent: source.ewtImprovementPercent,
    passengerSecondsSavedPercent: source.passengerSecondsSavedPercent,
    passengerSecondsSaved: source.passengerSecondsSaved,
    incidentsAvoided: source.incidentsAvoided,
    waitSecondsSaved: source.waitSecondsSaved,
    onboardDelayImposed: source.onboardDelayImposed,
    inVehicleSecondsSaved: source.inVehicleSecondsSaved,
    bunchingRateImprovementPercent: source.bunchingRateImprovementPercent,
    cvImprovementPercent: source.cvImprovementPercent,
    addedJourneySecondsPerVehicle: source.addedJourneySecondsPerVehicle,
    additionalDeniedBoardings: source.additionalDeniedBoardings,
  };
}