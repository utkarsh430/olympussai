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

function armSummary(arm: ArmReport): TrialArmSummary {
  return {
    ewtSeconds: arm.spacing.ewtSeconds,
    meanHeadwaySeconds: arm.spacing.meanHeadwaySeconds,
    headwayCv: arm.spacing.headwayCv,
    bunchingRate: arm.spacing.bunchingRate,
    incidentsDetected: arm.incidents.detected,
    incidentsResolved: arm.incidents.resolved,
    onTimeRate: arm.punctuality.onTimeRate,
    meanHoldSecondsPerVehicle: arm.punctuality.meanHoldSecondsPerVehicle,
    totalHoldSeconds: arm.punctuality.totalHoldSeconds,
    totalPassengerSeconds: arm.passengers.totalPassengerSeconds,
    waitPassengerSeconds: arm.passengers.waitPassengerSeconds,
    boardings: arm.passengers.boardings,
    deniedBoardings: arm.passengers.deniedBoardings,
    deniedShare: arm.spacing.deniedShare,
    firstTimeDeniedBoardings: arm.spacing.firstTimeDeniedBoardings,
    meanJourneySeconds: arm.punctuality.meanJourneySeconds,
    p95JourneySeconds: arm.punctuality.p95JourneySeconds,
    meanScheduleDeviationSeconds: arm.punctuality.meanScheduleDeviationSeconds,
    p95ScheduleDeviationSeconds: arm.punctuality.p95ScheduleDeviationSeconds,
    maxHoldSecondsOnAnyVehicle: arm.punctuality.maxHoldSecondsOnAnyVehicle,
    alightingOnlyActions: arm.punctuality.alightingOnlyActions,
    alightingOnlyPassengersPassed: arm.punctuality.alightingOnlyPassengersPassed,
  };
}

interface ScenarioKeep {
  trajectories: boolean;
  sweeps: boolean;
}

function scenarioData(
  scenario: ScenarioReport,
  keep: ScenarioKeep,
  sweepPoints: number,
): TrialScenario {
  return {
    id: scenario.id,
    title: scenario.title,
    mechanism: scenario.mechanism,
    whatItTests: scenario.whatItTests,
    vehicleCount: scenario.vehicleCount,
    horizonSeconds: scenario.horizonSeconds,
    saturated: scenario.controlled.spacing.saturated || scenario.uncontrolled.spacing.saturated,
    contrast: contrast(scenario.contrast),
    controlled: armSummary(scenario.controlled),
    uncontrolled: armSummary(scenario.uncontrolled),
    sweeps: keep.sweeps
      ? {
          controlled: decimate(scenario.sweeps.controlled, sweepPoints).map(sweepPoint),
          uncontrolled: decimate(scenario.sweeps.uncontrolled, sweepPoints).map(sweepPoint),
        }
      : { controlled: [], uncontrolled: [] },
    trajectories: keep.trajectories
      ? {
          controlled: scenario.trajectories.controlled.map((trajectory) => ({
            vehicleId: trajectory.vehicleId,
            points: trajectory.points.map((point) => ({
              t: point.t,
              d: point.d,
              hold: point.hold,
            })),
          })),
          uncontrolled: scenario.trajectories.uncontrolled.map((trajectory) => ({
            vehicleId: trajectory.vehicleId,
            points: trajectory.points.map((point) => ({
              t: point.t,
              d: point.d,
              hold: point.hold,
            })),
          })),
        }
      : null,
  };
}

function phaseData(
  phase: PhaseReport,
  presetId: CorridorPresetId,
  options: ExtractOptions,
): TrialPhase {
  const headline = phase.id === options.headlinePhaseId;
  const replayPhase = headline && options.replayPresetIds.includes(presetId);
  const keepSweeps = headline || options.sweepsForNonHeadlinePhase;
  return {
    id: phase.id,
    title: phase.title,
    vehicleCount: phase.vehicleCount,
    contrast: contrast(phase.contrast),
    allScenariosContrast: contrast(phase.allScenarios.contrast),
    controlled: armSummary(phase.controlled),
    uncontrolled: armSummary(phase.uncontrolled),
    lawCoverage: phase.lawCoverage.map((entry) => ({
      law: entry.law,
      decisionsGenerating: entry.decisionsGenerating,
      decisionsTotal: entry.decisionsTotal,
    })),
    holdSecondsByStation: phase.holdSecondsByStation.map((station) => ({
      sequence: station.sequence,
      name: station.name,
      holdSeconds: station.holdSeconds,
      holdCount: station.holdCount,
    })),
    holdCountByActionType: phase.holdCountByActionType.map((entry) => ({
      actionType: entry.actionType,
      count: entry.count,
      holdSeconds: entry.holdSeconds,
    })),
    scenarios: phase.scenarios.map((scenario) =>
      scenarioData(
        scenario,
        {
          trajectories: replayPhase && options.replayScenarioIds.includes(scenario.id),
          sweeps: keepSweeps,
        },
        options.sweepPoints,
      ),
    ),
  };
}

function presetIdOf(report: FleetTrialReport): CorridorPresetId {
  const parsed = corridorPresetIdSchema.safeParse(report.corridorPreset.id);
  if (!parsed.success) {
    throw new Error(
      `Report generated at ${report.generatedAt} names corridor preset "${report.corridorPreset.id}", which is not one of ${corridorPresetIdSchema.options.join(', ')}.`,
    );
  }
  return parsed.data;
}

function corridorDataOf(report: FleetTrialReport, options: ExtractOptions): TrialCorridorData {
  const presetId = presetIdOf(report);
  const net = headlineNetPassengerTime(report);
  return {
    presetId,
    title: report.corridorPreset.title,
    routeName: report.corridor.routeName,
    totalDistanceMeters: report.corridor.totalDistanceMeters,
    stationCount: report.corridor.stationCount,
    targetHeadwaySeconds: report.corridor.targetHeadwaySeconds,
    bunchedThresholdRatio: report.corridor.bunchedThresholdRatio,
    warningThresholdRatio: report.corridor.warningThresholdRatio,
    maxHoldSeconds: report.corridor.maxHoldSeconds,
    generatedAt: report.generatedAt,
    durationMs: report.durationMs,
    vehiclesSimulated: report.vehiclesSimulated,
    headlineScope: {
      includedScenarioIds: [...report.headlineScope.includedScenarioIds],
      excludedScenarioIds: report.headlineScope.excludedScenarios.map((entry) => entry.id),
    },
    controllability: {
      disturbanceRatio: report.controllability.disturbanceRatio,
      legTimeSigmaSeconds: report.controllability.legTimeSigmaSeconds,
      band: report.controllability.band,
    },
    headlineNetPercent: net.headlinePercent,
    allScenariosNetPercent: net.allScenariosPercent,
    stations: [...report.corridor.stations]
      .sort((a, b) => a.sequence - b.sequence)
      .map((station) => ({
        sequence: station.sequence,
        name: station.name,
        cumulativeDistanceMeters: station.cumulativeDistanceMeters,
      })),
    phases: report.phases.map((phase) => phaseData(phase, presetId, options)),
  };
}

/**
 * Reduce one or more trial reports to what the showcase renders.
 *
 * Corridors come out in `PRESET_ORDER` whatever order the reports were given
 * in, and two reports for one preset are refused rather than silently letting
 * the later one win.
 */
export function extractTrialData(
  reports: readonly FleetTrialReport[],
  options: ExtractOptions,
): TrialData {
  if (reports.length === 0) throw new Error('At least one fleet-trial report is required.');
  if (!Number.isInteger(options.sweepPoints) || options.sweepPoints < 2) {
    throw new Error(`sweepPoints must be an integer of at least 2, got ${options.sweepPoints}`);
  }

  const corridors = reports.map((report) => corridorDataOf(report, options));
  const seen = new Set<CorridorPresetId>();
  for (const corridor of corridors) {
    if (seen.has(corridor.presetId)) {
      throw new Error(
        `Two reports describe the "${corridor.presetId}" preset; pass one per corridor.`,
      );
    }
    seen.add(corridor.presetId);
  }
  corridors.sort((a, b) => PRESET_ORDER.indexOf(a.presetId) - PRESET_ORDER.indexOf(b.presetId));

  return {
    builtAt: options.builtAt,
    headlinePhaseId: options.headlinePhaseId,
    replayScenarioIds: [...options.replayScenarioIds],
    corridors,
  };
}
