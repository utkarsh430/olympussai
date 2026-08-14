/**
 * Wire contract for a control-strategy rehearsal.
 *
 * Parsed with Zod at the boundary like every other control-service payload
 * (see src/models/control.ts): the simulator is the one surface whose whole
 * value is that a reader can tell a measurement from a model, so a response
 * whose provenance manifest did not arrive intact must be refused rather
 * than rendered with a missing label.
 *
 * No `server-only` guard: these types cross into client components, which
 * is where the result is drawn.
 */
import { z } from 'zod';

export const rehearsalDisturbanceSchema = z.enum([
  'none',
  'demand_burst',
  'missed_trip',
  'gps_dropout',
  'non_compliance',
]);
export type RehearsalDisturbance = z.infer<typeof rehearsalDisturbanceSchema>;

/** How an operator reads each disturbance, in the words a planner would use. */
export const REHEARSAL_DISTURBANCE_LABEL: Record<RehearsalDisturbance, string> = {
  none: 'Ordinary running',
  demand_burst: 'Crowd surge mid-route',
  missed_trip: 'A bus never leaves',
  gps_dropout: 'A bus loses its position feed',
  non_compliance: 'A driver does not take the holds',
};

export const REHEARSAL_DISTURBANCE_DETAIL: Record<RehearsalDisturbance, string> = {
  none: 'No disturbance. Only the corridor and the modelled demand.',
  demand_burst: 'Eight times the modelled boarding rate at the mid-route stop, over about half an hour, timed to when the buses reach it.',
  missed_trip: 'One scheduled departure never happens, leaving a double gap behind it.',
  gps_dropout: "One bus's position is unreadable for the whole run, so the safety filter refuses to act on it.",
  non_compliance: 'One driver takes only about a third of the holds asked for.',
};

export const provenanceSourceSchema = z.enum(['measured', 'configured', 'modelled']);
export type ProvenanceSource = z.infer<typeof provenanceSourceSchema>;

export const provenanceEntrySchema = z.object({
  field: z.string(),
  source: provenanceSourceSchema,
  value: z.string(),
  note: z.string(),
});
export type ProvenanceEntry = z.infer<typeof provenanceEntrySchema>;

export const rehearsalStopSchema = z.object({
  stopId: z.string(),
  name: z.string(),
  sequence: z.number().int(),
  cumulativeDistanceMeters: z.number(),
  isControlPoint: z.boolean(),
  maxHoldSeconds: z.number().nullable(),
  latitude: z.number(),
  longitude: z.number(),
});
export type RehearsalStop = z.infer<typeof rehearsalStopSchema>;

export const rehearsalVehicleFrameSchema = z.object({
  vehicleId: z.string(),
  distanceAlongRouteMeters: z.number(),
  latitude: z.number(),
  longitude: z.number(),
  headingDegrees: z.number().nullable(),
  onboard: z.number(),
  status: z.enum(['running', 'dwelling', 'held']),
});
export type RehearsalVehicleFrame = z.infer<typeof rehearsalVehicleFrameSchema>;

export const rehearsalFrameSchema = z.object({
  atSeconds: z.number(),
  vehicles: z.array(rehearsalVehicleFrameSchema),
});
export type RehearsalFrame = z.infer<typeof rehearsalFrameSchema>;

export const rehearsalKpiSchema = z.object({
  meanHeadwaySeconds: z.number().nullable(),
  headwayCv: z.number().nullable(),
  bunchingIncidents: z.number(),
  excessWaitSeconds: z.number(),
  deniedBoardings: z.number(),
  strandedPassengers: z.number(),
  onTimeDispatchRate: z.number(),
  complianceRate: z.number().nullable(),
  totalBoardings: z.number(),
});
export type RehearsalKpis = z.infer<typeof rehearsalKpiSchema>;

export const rehearsalArmSchema = z.object({
  name: z.string(),
  kpis: rehearsalKpiSchema,
  frames: z.array(rehearsalFrameSchema),
  appliedHoldSeconds: z.number(),
  refusedHoldSeconds: z.number(),
});
export type RehearsalArm = z.infer<typeof rehearsalArmSchema>;

const candidateActionSchema = z.object({
  actionType: z.string(),
  vehicleId: z.string(),
  holdSeconds: z.number(),
  objectiveCost: z.number(),
  headwayDeviationSeconds: z.number(),
  targetHeadwaySeconds: z.number(),
});

export const rehearsalDecisionSchema = z.object({
  atSeconds: z.number(),
  stopId: z.string(),
  vehicleId: z.string(),
  leaderVehicleId: z.string().nullable(),
  gapMeters: z.number().nullable(),
  hFwdSeconds: z.number().nullable(),
  hBwdSeconds: z.number().nullable(),
  candidates: z.array(candidateActionSchema),
  rejected: z.array(
    z.object({
      candidate: candidateActionSchema,
      reasons: z.array(z.string()),
    }),
  ),
  selectedActionType: z.string(),
  holdSeconds: z.number(),
  onboardCount: z.number().nullable(),
  occupancy: z
    .object({
      asDeployedToday: z.object({
        candidates: z.array(z.object({ onboardCost: z.number(), occupancyEstimated: z.boolean() })),
      }),
      withModelledOccupancy: z.object({
        candidates: z.array(z.object({ onboardCost: z.number(), occupancyEstimated: z.boolean() })),
      }),
    })
    .nullable(),
});
export type RehearsalDecision = z.infer<typeof rehearsalDecisionSchema>;

export const rehearsalResultSchema = z.object({
  corridor: z.object({
    routeDirectionId: z.string(),
    routeId: z.string(),
    routeName: z.string().nullable(),
    directionCode: z.string(),
    isLoop: z.boolean(),
    totalDistanceMeters: z.number(),
    calibrationSource: z.string(),
    stops: z.array(rehearsalStopSchema),
    shape: z.array(z.object({ latitude: z.number(), longitude: z.number() })),
    controlPointCount: z.number(),
  }),
  policy: z.object({
    targetHeadwaySeconds: z.number().positive(),
    bunchedThresholdRatio: z.number(),
    warningThresholdRatio: z.number(),
    kf: z.number().nullable(),
    kb: z.number().nullable(),
    selfEqualizingK: z.number().nullable(),
    maxHoldSeconds: z.number(),
    cooldownSeconds: z.number(),
    predictionHorizonControlPoints: z.number(),
    occupancyCapacity: z.number().nullable(),
    occupancyStaleSeconds: z.number().nullable(),
  }),
  inputs: z.object({
    cruiseSpeedKmph: z.number(),
    travelTimeVariation: z.number(),
    boardingRatePerMinute: z.number(),
    alightingFraction: z.number(),
    baseDwellSeconds: z.number(),
    secondsPerBoarding: z.number(),
    secondsPerAlighting: z.number(),
    vehicleCapacity: z.number(),
    vehicleCount: z.number(),
    seed: z.number(),
    disturbance: rehearsalDisturbanceSchema,
  }),
  provenance: z.array(provenanceEntrySchema),
  arms: z.object({ uncontrolled: rehearsalArmSchema, controlled: rehearsalArmSchema }),
  decisions: z.array(rehearsalDecisionSchema),
  occupancyContrast: z.object({
    decisionsScored: z.number(),
    decisionsUsingFallbackToday: z.number(),
    meanOnboardCostAsDeployedToday: z.number().nullable(),
    meanOnboardCostWithModelledOccupancy: z.number().nullable(),
    rankingComparable: z.boolean(),
  }),
  disturbedVehicleId: z.string().nullable(),
  notRehearsed: z.array(z.string()),
  horizonSeconds: z.number(),
});
export type RehearsalResult = z.infer<typeof rehearsalResultSchema>;

/** The knobs the operator may turn, and what the request body may carry. */
export const rehearsalRequestSchema = z.object({
  routeDirectionId: z.string().uuid(),
  vehicleCount: z.number().int().min(2).max(24).optional(),
  cruiseSpeedKmph: z.number().min(5).max(120).optional(),
  boardingRatePerMinute: z.number().min(0).max(120).optional(),
  vehicleCapacity: z.number().int().min(1).max(400).optional(),
  travelTimeVariation: z.number().min(0).max(1).optional(),
  seed: z.number().int().min(0).max(2_147_483_647).optional(),
  disturbance: rehearsalDisturbanceSchema.optional(),
});
export type RehearsalRequest = z.infer<typeof rehearsalRequestSchema>;
