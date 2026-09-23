/**
 * The shapes the showcase draws from a real fleet-trial run.
 *
 * `scripts/showcase/build-trial-data.ts` extracts this from one or more
 * `sim:fleet` reports and writes `generated/trialData.json`; the page parses
 * that file with the schema below at module load, so a stale or hand-edited
 * file fails at build time rather than on stage.
 *
 * Deliberately a SUBSET of `src/models/fleetTrial.ts`: only what a scene
 * renders. Trajectories are kept for the replay scenarios of every corridor,
 * sweeps are decimated and carried for the headline phase only (the other
 * phase's scenarios keep empty sweep arrays), which is what keeps the
 * committed file small enough to import into the server page.
 *
 * No `'use client'`: the server page imports this, and so do the extractor
 * and the tests.
 */
import { z } from 'zod';
import {
  bunchingScenarioIdSchema,
  corridorPresetIdSchema,
  phaseIdSchema,
} from '@/models/fleetTrial';

export const trialContrastSchema = z.object({
  ewtImprovementPercent: z.number().nullable(),
  passengerSecondsSavedPercent: z.number().nullable(),
  passengerSecondsSaved: z.number(),
  incidentsAvoided: z.number(),
  waitSecondsSaved: z.number(),
  onboardDelayImposed: z.number(),
  inVehicleSecondsSaved: z.number(),
  bunchingRateImprovementPercent: z.number().nullable(),
  cvImprovementPercent: z.number().nullable(),
  addedJourneySecondsPerVehicle: z.number().nullable(),
  additionalDeniedBoardings: z.number(),
});
export type TrialContrast = z.infer<typeof trialContrastSchema>;

export const trialArmSummarySchema = z.object({
  ewtSeconds: z.number().nullable(),
  meanHeadwaySeconds: z.number().nullable(),
  headwayCv: z.number().nullable(),
  bunchingRate: z.number(),
  incidentsDetected: z.number(),
  incidentsResolved: z.number(),
  onTimeRate: z.number().nullable(),
  meanHoldSecondsPerVehicle: z.number(),
  totalHoldSeconds: z.number(),
  totalPassengerSeconds: z.number(),
  waitPassengerSeconds: z.number(),
  boardings: z.number(),
  deniedBoardings: z.number(),
  /** Headcount share the `saturated` flag is drawn on; null when nobody was offered a seat. */
  deniedShare: z.number().nullable(),
  firstTimeDeniedBoardings: z.number(),
  meanJourneySeconds: z.number().nullable(),
  p95JourneySeconds: z.number().nullable(),
  meanScheduleDeviationSeconds: z.number().nullable(),
  p95ScheduleDeviationSeconds: z.number().nullable(),
  maxHoldSecondsOnAnyVehicle: z.number(),
  alightingOnlyActions: z.number(),
  alightingOnlyPassengersPassed: z.number(),
});
export type TrialArmSummary = z.infer<typeof trialArmSummarySchema>;

export const trialSweepPointSchema = z.object({
  atSeconds: z.number(),
  openIncidents: z.number(),
  bunchedPairs: z.number(),
  liveVehicles: z.number(),
});
export type TrialSweepPoint = z.infer<typeof trialSweepPointSchema>;

export const trialTrajectorySchema = z.object({
  vehicleId: z.string(),
  points: z.array(z.object({ t: z.number(), d: z.number(), hold: z.number() })),
});
export type TrialTrajectory = z.infer<typeof trialTrajectorySchema>;

export const trialScenarioSchema = z.object({
  id: bunchingScenarioIdSchema,
  title: z.string(),
  mechanism: z.string(),
  whatItTests: z.string(),
  vehicleCount: z.number(),
  horizonSeconds: z.number(),
  saturated: z.boolean(),
  contrast: trialContrastSchema,
  controlled: trialArmSummarySchema,
  uncontrolled: trialArmSummarySchema,
  sweeps: z.object({
    controlled: z.array(trialSweepPointSchema),
    uncontrolled: z.array(trialSweepPointSchema),
  }),
  /** Present only for the replay scenarios; null keeps the file small. */
  trajectories: z
    .object({
      controlled: z.array(trialTrajectorySchema),
      uncontrolled: z.array(trialTrajectorySchema),
    })
    .nullable(),
});
export type TrialScenario = z.infer<typeof trialScenarioSchema>;

export const trialLawCoverageSchema = z.object({
  law: z.string(),
  decisionsGenerating: z.number(),
  decisionsTotal: z.number(),
});
export type TrialLawCoverage = z.infer<typeof trialLawCoverageSchema>;

export const trialStationHoldSchema = z.object({
  sequence: z.number(),
  name: z.string(),
  holdSeconds: z.number(),
  holdCount: z.number(),
});
export type TrialStationHold = z.infer<typeof trialStationHoldSchema>;

export const trialPhaseSchema = z.object({
  id: phaseIdSchema,
  title: z.string(),
  vehicleCount: z.number(),
  contrast: trialContrastSchema,
  allScenariosContrast: trialContrastSchema,
  controlled: trialArmSummarySchema,
  uncontrolled: trialArmSummarySchema,
  lawCoverage: z.array(trialLawCoverageSchema),
  holdSecondsByStation: z.array(trialStationHoldSchema),
  holdCountByActionType: z.array(
    z.object({ actionType: z.string(), count: z.number(), holdSeconds: z.number() }),
  ),
  scenarios: z.array(trialScenarioSchema),
});
export type TrialPhase = z.infer<typeof trialPhaseSchema>;

export const trialCorridorDataSchema = z.object({
  presetId: corridorPresetIdSchema,
  title: z.string(),
  routeName: z.string(),
  totalDistanceMeters: z.number(),
  stationCount: z.number(),
  targetHeadwaySeconds: z.number(),
  bunchedThresholdRatio: z.number(),
  warningThresholdRatio: z.number(),
  maxHoldSeconds: z.number(),
  generatedAt: z.string(),
  durationMs: z.number(),
  vehiclesSimulated: z.number(),
  headlineScope: z.object({
    includedScenarioIds: z.array(z.string()),
    excludedScenarioIds: z.array(z.string()),
  }),
  controllability: z.object({
    disturbanceRatio: z.number(),
    legTimeSigmaSeconds: z.number(),
    band: z.enum(['too_regular', 'controllable', 'too_disturbed']),
  }),
  /** Passenger-seconds pooled across phases and divided once (`headlineNetPassengerTime`). */
  headlineNetPercent: z.number().nullable(),
  allScenariosNetPercent: z.number().nullable(),
  stations: z.array(
    z.object({ sequence: z.number(), name: z.string(), cumulativeDistanceMeters: z.number() }),
  ),
  phases: z.array(trialPhaseSchema),
});
export type TrialCorridorData = z.infer<typeof trialCorridorDataSchema>;

export const trialDataSchema = z.object({
  builtAt: z.string(),
  /** The phase whose per-scenario figures and replay the page leads with. */
  headlinePhaseId: phaseIdSchema,
  /** Scenario ids whose trajectories were kept, in the order the picker offers them. */
  replayScenarioIds: z.array(bunchingScenarioIdSchema),
  corridors: z.array(trialCorridorDataSchema),
});
export type TrialData = z.infer<typeof trialDataSchema>;

/** Parse a generated file, throwing a readable error when it does not match. */
export function parseTrialData(raw: unknown): TrialData {
  return trialDataSchema.parse(raw);
}

export function corridorData(data: TrialData, presetId: string): TrialCorridorData | null {
  return data.corridors.find((corridor) => corridor.presetId === presetId) ?? null;
}

export function headlinePhase(corridor: TrialCorridorData, phaseId: string): TrialPhase | null {
  return corridor.phases.find((phase) => phase.id === phaseId) ?? corridor.phases[0] ?? null;
}
