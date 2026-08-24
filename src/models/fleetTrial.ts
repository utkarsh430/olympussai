/**
 * Wire contract for the fleet trial.
 *
 * Parsed with Zod at the boundary like every other control-service payload.
 * It matters more here than almost anywhere else: this is the surface whose
 * entire value is that a reader can tell what was MEASURED from what was
 * MODELLED, so a response whose provenance manifest or saturation flags did
 * not arrive intact must be refused rather than drawn with a missing label.
 *
 * No `server-only` guard: these types cross into client components, which is
 * where the charts are drawn.
 */
import { z } from 'zod';

export const bunchingScenarioIdSchema = z.enum([
  'steady_variability',
  'terminal_jitter',
  'station_surge',
  'slow_bus',
  'traffic_shock',
  'missed_trip',
  'cascade',
  'peak_load',
  'gps_dropout',
  'driver_non_compliance',
]);
export type BunchingScenarioId = z.infer<typeof bunchingScenarioIdSchema>;

export const phaseIdSchema = z.enum(['occupancy_blind', 'occupancy_aware']);
export type PhaseId = z.infer<typeof phaseIdSchema>;

const spacingKpisSchema = z.object({
  headwaySampleCount: z.number(),
  meanHeadwaySeconds: z.number().nullable(),
  ewtSeconds: z.number().nullable(),
  headwayCv: z.number().nullable(),
  bunchingRate: z.number(),
  deniedBoardings: z.number(),
  totalBoardings: z.number(),
  saturated: z.boolean(),
});

const punctualityKpisSchema = z.object({
  vehiclesCompleted: z.number(),
  meanJourneySeconds: z.number().nullable(),
  p95JourneySeconds: z.number().nullable(),
  maxJourneySeconds: z.number().nullable(),
  totalHoldSeconds: z.number(),
  meanHoldSecondsPerVehicle: z.number(),
  maxHoldSecondsOnAnyVehicle: z.number(),
  refusedHoldSeconds: z.number(),
  meanScheduleDeviationSeconds: z.number().nullable(),
  p95ScheduleDeviationSeconds: z.number().nullable(),
  onTimeRate: z.number().nullable(),
  alightingOnlyActions: z.number(),
  alightingOnlyPassengersPassed: z.number(),
});

const passengerOutcomeSchema = z.object({
  boardings: z.number(),
  deniedBoardings: z.number(),
  waitPassengerSeconds: z.number(),
  onboardDelayPassengerSeconds: z.number(),
  dwellPassengerSeconds: z.number(),
  ridePassengerSeconds: z.number(),
  inVehiclePassengerSeconds: z.number(),
  totalPassengerSeconds: z.number(),
});

const incidentSummarySchema = z.object({
  detected: z.number(),
  byOpeningSeverity: z.record(z.string(), z.number()),
  byPeakSeverity: z.record(z.string(), z.number()),
  escalatedFromPrediction: z.number(),
  resolved: z.number(),
  closedPairGone: z.number(),
  unresolvedAtEnd: z.number(),
  medianResolutionSeconds: z.number().nullable(),
  meanResolutionSeconds: z.number().nullable(),
  worstRatio: z.number().nullable(),
  withIntervention: z.number(),
  totalHoldSecondsServed: z.number(),
});

const armReportSchema = z.object({
  spacing: spacingKpisSchema,
  punctuality: punctualityKpisSchema,
  passengers: passengerOutcomeSchema,
  incidents: incidentSummarySchema,
});
export type ArmReport = z.infer<typeof armReportSchema>;

const armContrastSchema = z.object({
  ewtImprovementSeconds: z.number().nullable(),
  ewtImprovementPercent: z.number().nullable(),
  cvImprovementPercent: z.number().nullable(),
  bunchingRateImprovementPercent: z.number().nullable(),
  incidentsAvoided: z.number(),
  addedJourneySecondsPerVehicle: z.number().nullable(),
  additionalDeniedBoardings: z.number(),
  passengerSecondsSaved: z.number(),
  passengerSecondsSavedPercent: z.number().nullable(),
  passengerSecondsPerBoardingSavedPercent: z.number().nullable(),
  waitSecondsSaved: z.number(),
  onboardDelayImposed: z.number(),
  inVehicleSecondsSaved: z.number(),
});
export type ArmContrast = z.infer<typeof armContrastSchema>;

const detectedIncidentSchema = z.object({
  incidentId: z.string(),
  leaderVehicleId: z.string(),
  followerVehicleId: z.string(),
  openedAtSeconds: z.number(),
  openedSeverity: z.string(),
  peakSeverity: z.string(),
  escalations: z.number(),
  closedAtSeconds: z.number().nullable(),
  closeReason: z.string(),
  durationSeconds: z.number().nullable(),
  minRatio: z.number(),
  minHFwdSeconds: z.number().nullable(),
  openedAtDistanceMeters: z.number(),
  holdSecondsApplied: z.number(),
  holdCount: z.number(),
  holdActionTypes: z.array(z.string()),
  holdSecondsRefused: z.number(),
  observationLost: z.boolean(),
});
export type DetectedIncident = z.infer<typeof detectedIncidentSchema>;

const sweepSampleSchema = z.object({
  atSeconds: z.number(),
  liveVehicles: z.number(),
  pairCount: z.number(),
  minRatio: z.number().nullable(),
  meanRatio: z.number().nullable(),
  bunchedPairs: z.number(),
  warningPairs: z.number(),
  openIncidents: z.number(),
});
export type SweepSample = z.infer<typeof sweepSampleSchema>;

const trajectorySchema = z.object({
  vehicleId: z.string(),
  points: z.array(z.object({ t: z.number(), d: z.number(), hold: z.number() })),
});
export type VehicleTrajectory = z.infer<typeof trajectorySchema>;

const scenarioReportSchema = z.object({
  id: bunchingScenarioIdSchema,
  title: z.string(),
  mechanism: z.string(),
  whatItTests: z.string(),
  vehicleCount: z.number(),
  seed: z.number(),
  horizonSeconds: z.number(),
  controlled: armReportSchema,
  uncontrolled: armReportSchema,
  contrast: armContrastSchema,
  sweeps: z.object({
    controlled: z.array(sweepSampleSchema),
    uncontrolled: z.array(sweepSampleSchema),
  }),
  trajectories: z.object({
    controlled: z.array(trajectorySchema),
    uncontrolled: z.array(trajectorySchema),
  }),
  worstIncidents: z.array(detectedIncidentSchema),
  worstIncidentsUncontrolled: z.array(detectedIncidentSchema),
});
export type ScenarioReport = z.infer<typeof scenarioReportSchema>;

const lawCoverageSchema = z.object({
  law: z.string(),
  decisionsGenerating: z.number(),
  decisionsTotal: z.number(),
  commonestDecline: z.string().nullable(),
  commonestDeclineShare: z.number().nullable(),
});
export type LawCoverage = z.infer<typeof lawCoverageSchema>;

const phaseReportSchema = z.object({
  id: phaseIdSchema,
  title: z.string(),
  weighOccupancy: z.boolean(),
  vehicleCount: z.number(),
  scenarios: z.array(scenarioReportSchema),
  controlled: armReportSchema,
  uncontrolled: armReportSchema,
  contrast: armContrastSchema,
  lawCoverage: z.array(lawCoverageSchema),
  holdSecondsByStation: z.array(
    z.object({
      stopId: z.string(),
      name: z.string(),
      sequence: z.number(),
      holdSeconds: z.number(),
      holdCount: z.number(),
    }),
  ),
  holdCountByActionType: z.array(
    z.object({ actionType: z.string(), count: z.number(), holdSeconds: z.number() }),
  ),
  safetyRejections: z.array(z.object({ reason: z.string(), count: z.number() })),
});
export type PhaseReport = z.infer<typeof phaseReportSchema>;

const policyStudySchema = z.object({
  knob: z.string(),
  title: z.string(),
  description: z.string(),
  rows: z.array(
    z.object({
      label: z.string(),
      ewtImprovementPercent: z.number().nullable(),
      passengerSecondsSavedPercent: z.number().nullable(),
      meanHoldSecondsPerVehicle: z.number(),
      worstBusHoldSeconds: z.number(),
      holdCount: z.number(),
      deniedBoardings: z.number(),
      incidentsDetected: z.number(),
      incidentsResolved: z.number(),
      seedCount: z.number(),
      seedsAgreeingWithSign: z.number(),
      isCurrent: z.boolean(),
    }),
  ),
  recommended: z.string().nullable(),
  verdict: z.string(),
  seedsPerRow: z.number(),
});
export type PolicyStudy = z.infer<typeof policyStudySchema>;

export const corridorPresetIdSchema = z.enum(['intercity', 'suburban', 'urban']);
export type CorridorPresetId = z.infer<typeof corridorPresetIdSchema>;

export const fleetTrialReportSchema = z.object({
  generatedAt: z.string(),
  durationMs: z.number(),
  corridorPreset: z.object({ id: z.string(), title: z.string(), description: z.string() }),
  alightingOnlySelectable: z.boolean(),
  corridor: z.object({
    routeDirectionId: z.string(),
    routeName: z.string(),
    totalDistanceMeters: z.number(),
    stationCount: z.number(),
    holdingPointCount: z.number(),
    targetHeadwaySeconds: z.number(),
    bunchedThresholdRatio: z.number(),
    warningThresholdRatio: z.number(),
    maxHoldSeconds: z.number(),
    kf: z.number().nullable(),
    kb: z.number().nullable(),
    selfEqualizingK: z.number().nullable(),
    stations: z.array(
      z.object({
        stopId: z.string(),
        name: z.string(),
        sequence: z.number(),
        cumulativeDistanceMeters: z.number(),
        latitude: z.number(),
        longitude: z.number(),
      }),
    ),
  }),
  controllability: z.object({
    legTimeSigmaSeconds: z.number(),
    disturbanceRatio: z.number(),
    band: z.enum(['too_regular', 'controllable', 'too_disturbed']),
    note: z.string(),
  }),
  scheduleFit: z.object({
    meanUncontrolledDeviationSeconds: z.number().nullable(),
    deviationRatio: z.number().nullable(),
    band: z.enum(['tight', 'achievable', 'slack']),
    note: z.string(),
  }),
  vehiclesSimulated: z.number(),
  sweepIntervalSeconds: z.number(),
  requiredSamples: z.number(),
  phases: z.array(phaseReportSchema),
  policyStudies: z.array(policyStudySchema),
  occupancyContrast: z.object({
    decisionsChanged: z.number(),
    decisionsCompared: z.number(),
    meanObjectiveCostBlind: z.number().nullable(),
    meanObjectiveCostAware: z.number().nullable(),
    rankingComparable: z.boolean(),
    verdict: z.string(),
  }),
  provenance: z.array(
    z.object({
      field: z.string(),
      source: z.enum(['deployed', 'configured', 'modelled']),
      value: z.string(),
      note: z.string(),
    }),
  ),
  notExercised: z.array(z.string()),
});

export type FleetTrialReport = z.infer<typeof fleetTrialReportSchema>;

/** What the operator asks for. Every field optional: the defaults are the thousand-bus trial. */
export const fleetTrialRequestSchema = z
  .object({
    vehiclesPerPhase: z.number().int().min(10).max(1000),
    scenarios: z.array(bunchingScenarioIdSchema).min(1),
    seed: z.number().int().min(0).max(2_147_483_647),
    followerSpeedSource: z.enum(['link_average', 'vehicle_state']),
    corridorPreset: corridorPresetIdSchema,
    alightingOnlySelectable: z.boolean(),
  })
  .partial()
  .strict();

export type FleetTrialRequest = z.infer<typeof fleetTrialRequestSchema>;

/** How each severity reads to an operator, and what kind of claim it is. */
export const SEVERITY_LABEL: Record<string, string> = {
  predicted: 'Predicted',
  warning: 'Warning',
  bunched: 'Bunched',
};

/** Why an incident stopped being open. Only the first two are resolutions. */
export const CLOSE_REASON_LABEL: Record<string, string> = {
  recovered: 'Gap reopened',
  risk_cleared: 'Forecast cleared',
  pair_no_longer_adjacent: 'Bus left the route',
  run_ended: 'Still open at end',
};

export const LAW_LABEL: Record<string, string> = {
  terminal_dispatch: 'Terminal dispatch',
  two_way: 'Two-way holding',
  self_equalizing: 'Self-equalising',
  cost_optimal: 'Closed-form optimum',
  boarding_limit: 'Alighting-only',
};

/** What each hard-safety rejection means, in the words an operator would use. */
export const REJECTION_LABEL: Record<string, string> = {
  stale_state: 'the bus had not reported its position recently enough',
  max_lateness_breach: 'the hold would have pushed the bus too far behind its timetable',
  max_hold_cap_breach: 'the hold was longer than the corridor permits',
  below_minimum_action: 'the hold was too short to be worth giving',
  cooldown_active: 'the bus had been given an instruction too recently',
  conflicting_active_command: 'the bus was already carrying an instruction',
};

export const DECLINE_LABEL: Record<string, string> = {
  no_leader_on_corridor: 'no bus ahead on the corridor',
  not_at_terminal: 'the bus was not at the origin terminal',
  no_measured_terminal_departure: 'no previous departure had been recorded',
  suppressed_by_terminal_regulation: 'terminal dispatch had already claimed the bus',
  gains_unset: 'the corridor has no Kf/Kb gains',
  self_equalizing_gain_unset: 'the corridor has no self-equalising gain',
  h_fwd_unavailable: 'no measurable gap to the bus ahead',
  h_bwd_unavailable: 'no measurable gap to the bus behind',
  two_way_covers_pair: 'two-way holding already covered the pair',
  not_eligible_to_hold: 'the bus was not at a stop it could hold at',
  leader_not_at_stop: 'the bus ahead was not at a stop it could act at',
  no_hold_indicated: 'the pair was not deviant enough to act on',
};
