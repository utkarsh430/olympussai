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