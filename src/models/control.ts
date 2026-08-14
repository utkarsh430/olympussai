import { z } from 'zod';

/**
 * Wire-contract Zod schemas for the persistent control service.
 *
 * These describe the JSON payloads exchanged with the control service over
 * REST + signed webhooks, per docs/CONTROL_SERVICE_INTEGRATION.md — they do
 * NOT describe this app's own database rows, because this app has none for
 * these entities: the control service owns its Postgres/PostGIS schema
 * under control-service/db/migrations/, and this app never connects to it
 * directly (see control-service/README.md). Field names and shapes mirror
 * that schema's columns so a payload round-trips without translation, but
 * every id here is a string on the wire, matching the existing
 * canonicalLiveBusSchema / canonicalStopSchema pattern in ./canonical.ts.
 *
 * Extends the canonical model set described in canonical.ts: those cover
 * LIVE UPSRTC upstream data; these cover the control system's own
 * entities (blueprint section 12.1 "Core entities").
 */

// ---------------------------------------------------------------------------
// Route / stop / control point
// ---------------------------------------------------------------------------

export const routeOperatingModeSchema = z.enum(['headway_managed', 'timetable_managed', 'hybrid']);
export type RouteOperatingMode = z.infer<typeof routeOperatingModeSchema>;

export const controlRouteSchema = z.object({
  id: z.string(),
  publicName: z.string(),
  operatingMode: routeOperatingModeSchema,
  isActive: z.boolean(),
});
export type ControlRoute = z.infer<typeof controlRouteSchema>;

export const controlRouteDirectionSchema = z.object({
  id: z.string(),
  routeId: z.string(),
  directionCode: z.string(),
  directionName: z.string().nullable(),
  corridorId: z.string().nullable(),
  isActive: z.boolean(),
});
export type ControlRouteDirection = z.infer<typeof controlRouteDirectionSchema>;

/** A single lat/lon vertex, used to describe geography(Point/LineString) columns on the wire. */
export const geoPointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export type GeoPoint = z.infer<typeof geoPointSchema>;

export const controlPointSchema = z.object({
  id: z.string(),
  routeDirectionId: z.string(),
  stopId: z.string(),
  sequence: z.number().int().min(0),
  cumulativeDistanceMeters: z.number().min(0),
  location: geoPointSchema,
  isControlPoint: z.boolean(),
  holdSuitable: z.boolean(),
  maxHoldSeconds: z.number().int().min(0).nullable(),
  geofenceRadiusMeters: z.number().positive(),
  laybyBerth: z.boolean(),
  shelterFlag: z.boolean(),
  weatherFlag: z.boolean(),
});
export type ControlPoint = z.infer<typeof controlPointSchema>;

// ---------------------------------------------------------------------------
// Trip / block / vehicle
// ---------------------------------------------------------------------------

export const tripStatusSchema = z.enum([
  'scheduled',
  'active',
  'completed',
  'cancelled',
  'short_turned',
  'deadhead',
]);
export type TripStatus = z.infer<typeof tripStatusSchema>;

export const controlTripSchema = z.object({
  id: z.string(),
  routeDirectionId: z.string(),
  blockId: z.string().nullable(),
  vehicleId: z.string().nullable(),
  serviceDate: z.string(), // YYYY-MM-DD
  scheduledStartTime: z.string(), // ISO datetime
  scheduledEndTime: z.string(),
  originStopId: z.string(),
  destinationStopId: z.string(),
  reliefPointStopId: z.string().nullable(),
  status: tripStatusSchema,
});
export type ControlTrip = z.infer<typeof controlTripSchema>;

// ---------------------------------------------------------------------------
// Vehicle state / headway state
// ---------------------------------------------------------------------------

export const stopStateSchema = z.enum([
  'approaching_stop',
  'dwelling_at_stop',
  'held_by_controller',
  'stopped_in_traffic',
  'departed_stop',
  'off_route',
]);
export type StopState = z.infer<typeof stopStateSchema>;

export const vehicleStateSchema = z.object({
  vehicleId: z.string(),
  tripId: z.string().nullable(),
  routeDirectionId: z.string().nullable(),
  // position/headingDegrees/occupancy* are `.optional()` in addition to
  // `.nullable()`, and the distinction is now load-bearing rather than a
  // placeholder.
  //
  // GET /v1/vehicle-states DOES populate position and headingDegrees
  // (control-service/src/routes/vehicleStates.ts passes both through from
  // the in-memory store). A `null` from that endpoint is therefore a real
  // statement - this vehicle has no fix - and consumers must treat it as
  // such rather than as a missing feature. `.optional()` remains because an
  // older control-service build omits the keys entirely, and a map that
  // cannot tell "no fix" from "this deployment does not send fixes" will
  // draw a bus somewhere it is not. src/lib/ops/mapVehicles.ts handles both
  // by falling back to the GPS feed's own position and labelling the source.
  //
  // occupancy* genuinely are still unpopulated by every ingestion path.
  position: geoPointSchema.nullable().optional(),
  distanceAlongRouteMeters: z.number().nullable(),
  speedKmph: z.number().nullable(),
  headingDegrees: z.number().min(0).max(360).nullable().optional(),
  stopState: stopStateSchema,
  currentStopId: z.string().nullable(),
  occupancyCount: z.number().int().min(0).nullable().optional(),
  occupancyLoadBand: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).nullable(),
  observedAt: z.string(),
});
export type VehicleState = z.infer<typeof vehicleStateSchema>;

/** Response body of GET /v1/vehicle-states. */
export const vehicleStatesResponseSchema = z.object({
  vehicleStates: z.array(vehicleStateSchema),
});
export type VehicleStatesResponse = z.infer<typeof vehicleStatesResponseSchema>;

export const headwayStateSchema = z.object({
  id: z.string(),
  routeDirectionId: z.string(),
  leaderVehicleId: z.string(),
  followerVehicleId: z.string(),
  hFwdSeconds: z.number().nullable(),
  hBwdSeconds: z.number().nullable(),
  targetHeadwaySeconds: z.number().positive(), // H*
  deviationSeconds: z.number().nullable(),
  forecastHFwdSeconds: z.number().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  computedAt: z.string(),
});
export type HeadwayState = z.infer<typeof headwayStateSchema>;

// ---------------------------------------------------------------------------
// Bunching incident
// ---------------------------------------------------------------------------

export const incidentSeveritySchema = z.enum(['warning', 'bunched', 'severe']);
export type IncidentSeverity = z.infer<typeof incidentSeveritySchema>;

export const causeClassSchema = z.enum(['endogenous', 'exogenous', 'structural', 'unknown']);
export type CauseClass = z.infer<typeof causeClassSchema>;

export const controllabilitySchema = z.enum(['controllable', 'mitigable', 'structural', 'none']);
export type Controllability = z.infer<typeof controllabilitySchema>;

export const incidentStatusSchema = z.enum([
  'open',
  'mitigating',
  'recovering',
  'closed',
  'escalated',
]);
export type IncidentStatus = z.infer<typeof incidentStatusSchema>;

export const bunchingIncidentMemberSchema = z.object({
  vehicleId: z.string(),
  role: z.enum(['leader', 'follower', 'platoon_member']),
});
export type BunchingIncidentMember = z.infer<typeof bunchingIncidentMemberSchema>;

export const bunchingIncidentSchema = z.object({
  id: z.string(),
  routeDirectionId: z.string(),
  members: z.array(bunchingIncidentMemberSchema),
  severity: incidentSeveritySchema,
  causeClass: causeClassSchema,
  controllability: controllabilitySchema,
  status: incidentStatusSchema,
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  evidence: z.record(z.string(), z.unknown()),
});
export type BunchingIncident = z.infer<typeof bunchingIncidentSchema>;

// ---------------------------------------------------------------------------
// Headway/EWT/CV metrics compute result
//
// Mirrors control-service/src/headway/types.ts (HeadwayPairMetric,
// HeadwayAggregate) and headway/service.ts (HeadwayComputeResult,
// IncidentChange) — the response body of
// POST /v1/route-directions/:id/headway/compute. Distinct from
// headwayStateSchema above: that one is a single persisted headway_states
// row; these describe one whole compute cycle (every leader/follower pair
// on a route-direction, the route-direction-wide CV/EWT aggregate derived
// from them, and any bunching_incidents change the reactive rule made).
// ---------------------------------------------------------------------------

export const routeDirectionMetaSchema = z.object({
  routeDirectionId: z.string(),
  routeId: z.string(),
  directionCode: z.string(),
  isLoop: z.boolean(),
  totalDistanceMeters: z.number(),
  /**
   * Whether the control service reports an active headway policy for this
   * corridor — i.e. whether bunching detection runs on it, or whether asking
   * for its headway will answer 404 `no_active_policy`.
   *
   * OPTIONAL ON PURPOSE, and it must stay optional. A control service that
   * predates the field simply omits it, and a required field would make
   * `routeDirectionsResponseSchema.parse` throw — which
   * `getObservabilitySnapshot` catches as `source: 'unavailable'`, so the
   * console would report an OUTAGE at a service that had just answered
   * correctly. That is the exact fabrication
   * src/lib/ops/controlRoomOverviewModel.ts exists to prevent, and it would
   * have been introduced by the very change meant to make the console more
   * honest. `undefined` therefore means "this service does not say", which the
   * coverage reading renders as unknown rather than as a number.
   */
  hasActivePolicy: z.boolean().optional(),
});
export type RouteDirectionMeta = z.infer<typeof routeDirectionMetaSchema>;

export const headwayPairMetricSchema = z.object({
  id: z.string(),
  routeDirectionId: z.string(),
  leaderVehicleId: z.string(),
  followerVehicleId: z.string(),
  gapMeters: z.number(),
  hFwdSeconds: z.number().nullable(),
  hBwdSeconds: z.number().nullable(),
  targetHeadwaySeconds: z.number().positive(),
  deviationSeconds: z.number().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
});
export type HeadwayPairMetric = z.infer<typeof headwayPairMetricSchema>;

export const headwayAggregateSchema = z.object({
  routeDirectionId: z.string(),
  sampleCount: z.number().int().min(0),
  meanHeadwaySeconds: z.number().nullable(),
  stddevHeadwaySeconds: z.number().nullable(),
  /** Coefficient of variation of forward headways (stddev / mean); higher = more irregular/bunched. */
  cv: z.number().nullable(),
  /** Excess Wait Time in seconds (blueprint 7.2: observed wait implied by the headway distribution minus wait under regular headway). */
  ewtSeconds: z.number().nullable(),
  targetHeadwaySeconds: z.number().positive(),
});
export type HeadwayAggregate = z.infer<typeof headwayAggregateSchema>;

export const incidentChangeActionSchema = z.enum(['opened', 'escalated', 'closed', 'none']);
export type IncidentChangeAction = z.infer<typeof incidentChangeActionSchema>;

export const incidentChangeSchema = z.object({
  routeDirectionId: z.string(),
  leaderVehicleId: z.string(),
  followerVehicleId: z.string(),
  action: incidentChangeActionSchema,
  severity: z.enum(['warning', 'bunched']).nullable(),
  incidentId: z.string().nullable(),
  ratio: z.number().nullable(),
});
export type IncidentChange = z.infer<typeof incidentChangeSchema>;

export const headwayComputeResultSchema = z.object({
  routeDirectionId: z.string(),
  computedAt: z.string(),
  pairs: z.array(headwayPairMetricSchema),
  aggregate: headwayAggregateSchema,
  incidents: z.array(incidentChangeSchema),
});
export type HeadwayComputeResult = z.infer<typeof headwayComputeResultSchema>;

/** Response body of GET /v1/incidents. */
export const incidentsResponseSchema = z.object({
  incidents: z.array(bunchingIncidentSchema),
});
export type IncidentsResponse = z.infer<typeof incidentsResponseSchema>;

/** Response body of GET /v1/incidents/:id — unlike the list above, returns the incident regardless of status (open or closed), for the incident timeline's "state" stage. */
export const incidentResponseSchema = z.object({
  incident: bunchingIncidentSchema,
});
export type IncidentResponse = z.infer<typeof incidentResponseSchema>;

/** Response body of GET /v1/route-directions. */
export const routeDirectionsResponseSchema = z.object({
  routeDirections: z.array(routeDirectionMetaSchema),
});
export type RouteDirectionsResponse = z.infer<typeof routeDirectionsResponseSchema>;

// ---------------------------------------------------------------------------
// Recommendation
// ---------------------------------------------------------------------------

export const recommendationStatusSchema = z.enum([
  'proposed',
  'selected',
  'superseded',
  'rejected',
]);
export type RecommendationStatus = z.infer<typeof recommendationStatusSchema>;

export const recommendationSchema = z.object({
  id: z.string(),
  incidentId: z.string().nullable(),
  routeDirectionId: z.string(),
  candidateActions: z.array(z.record(z.string(), z.unknown())),
  selectedActionType: z.string().nullable(),
  objectiveCost: z.number().nullable(),
  expectedRecoverySeconds: z.number().nullable(),
  constraints: z.record(z.string(), z.unknown()),
  modelVersion: z.string().nullable(),
  controllerVersion: z.string().nullable(),
  status: recommendationStatusSchema,
});
export type Recommendation = z.infer<typeof recommendationSchema>;

// ---------------------------------------------------------------------------
// Decision engine (POST /v1/mpc/solve)
// ---------------------------------------------------------------------------

/**
 * THE COMPLETE SET OF ACTIONS THE DECISION ENGINE CAN EVER PROPOSE.
 *
 * Three hold types, and nothing else — this is not a subset chosen for
 * convenience, it is the whole of `CandidateAction['actionType']` in
 * control-service/src/mpc/types.ts. Terminal dispatch regulation, two-way
 * holding and self-equalizing holding are the only control laws the solver
 * implements, so they are the only actions it can put forward.
 *
 * The other six values in `commandActionTypeSchema` — speed_guidance,
 * stop_skip, short_turn, deadhead, boarding_limit, standby_injection — are
 * issuable driver instructions that NOTHING in this system generates. They
 * exist because an operator may decide on one; no model recommends one. Any
 * UI that renders engine output must keep that line visible, which is why
 * this enum is exported separately rather than callers reaching for the
 * nine-value command enum and quietly implying the engine covers all of it.
 */
export const engineActionTypeSchema = z.enum([
  'terminal_dispatch_hold',
  'two_way_hold',
  'self_equalizing_hold',
]);
export type EngineActionType = z.infer<typeof engineActionTypeSchema>;

/** Every action type the engine can propose, as a value — for a UI that wants to state the boundary rather than hardcode it. */
export const ENGINE_ACTION_TYPES = engineActionTypeSchema.options;

/** One committable candidate hold, mirroring control-service/src/mpc/types.ts#CandidateAction. */
export const engineCandidateActionSchema = z.object({
  actionType: engineActionTypeSchema,
  vehicleId: z.string(),
  /** Every vehicle whose live state the computation depended on (the held bus plus its leader/follower). A stale reading on ANY of them rejects the whole candidate. */
  involvedVehicleIds: z.array(z.string()),
  holdSeconds: z.number(),
  /** |ideal hold − applied hold|: 0 when the cap and rounding did not pull the hold away from the formula's raw output. Candidates rank lowest-cost first. */
  objectiveCost: z.number(),
  routeDirectionId: z.string(),
  /** ISO timestamp of the sample this candidate was computed from — what the staleness check is measured against. */
  stateAsOf: z.string(),
  /** h_fwd − H*. Negative means the bus is bunched too close to its leader. */
  headwayDeviationSeconds: z.number(),
  targetHeadwaySeconds: z.number(),
});
export type EngineCandidateAction = z.infer<typeof engineCandidateActionSchema>;

export const safetyRejectionReasonSchema = z.enum([
  'stale_state',
  'max_hold_cap_breach',
  'conflicting_active_command',
]);
export type SafetyRejectionReason = z.infer<typeof safetyRejectionReasonSchema>;

/** A candidate the hard safety filter refused, and every reason it refused it. Kept, never dropped: an operator overriding the engine has to be able to see what it would not do. */
export const engineSafetyRejectionSchema = z.object({
  candidate: engineCandidateActionSchema,
  reasons: z.array(safetyRejectionReasonSchema),
});
export type EngineSafetyRejection = z.infer<typeof engineSafetyRejectionSchema>;

export const predictiveAdvisoryCandidateSchema = z.object({
  actionType: engineActionTypeSchema,
  vehicleId: z.string(),
  holdSeconds: z.number(),
  waitCost: z.number(),
  onboardCost: z.number(),
  mpcObjectiveCost: z.number(),
  /** True when occupancy for this vehicle was missing or stale, so the onboard cost used a mid-load assumption rather than a live reading. */
  occupancyEstimated: z.boolean(),
});
export type PredictiveAdvisoryCandidate = z.infer<typeof predictiveAdvisoryCandidateSchema>;

/**
 * The occupancy-weighted re-score of the safety-filtered candidates.
 *
 * ADVISORY ONLY, and structurally so: nothing in the solver can promote an
 * advisory ranking into `selectedAction`. `label` is a literal so no
 * consumer can lose that fact while passing the object around.
 */
export const predictiveAdvisorySchema = z.object({
  label: z.literal('PREDICTIVE'),
  horizonControlPoints: z.number(),
  candidates: z.array(predictiveAdvisoryCandidateSchema),
  controllerVersion: z.string(),
});
export type PredictiveAdvisory = z.infer<typeof predictiveAdvisorySchema>;

export const mpcSolveResultSchema = z.object({
  routeDirectionId: z.string(),
  /** Everything the control laws generated, before the safety filter ran. */
  candidateActions: z.array(engineCandidateActionSchema),
  /** The subset that survived the safety filter, in the solver's own priority order. */
  safeCandidates: z.array(engineCandidateActionSchema),
  /** The one candidate the selection policy picked, in full. Null when nothing safe was available. */
  selectedAction: engineCandidateActionSchema.nullable(),
  selectedActionType: engineActionTypeSchema.nullable(),
  objectiveCost: z.number().nullable(),
  expectedRecoverySeconds: z.number().nullable(),
  constraints: z.record(z.string(), z.unknown()),
  controllerVersion: z.string(),
  rejectedCandidates: z.array(engineSafetyRejectionSchema),
  predictiveAdvisory: predictiveAdvisorySchema,
});
export type MpcSolveResult = z.infer<typeof mpcSolveResultSchema>;

// ---------------------------------------------------------------------------
// Command / outcome
// ---------------------------------------------------------------------------

export const commandActionTypeSchema = z.enum([
  'terminal_dispatch_hold',
  'two_way_hold',
  'self_equalizing_hold',
  'speed_guidance',
  'stop_skip',
  'short_turn',
  'deadhead',
  'boarding_limit',
  'standby_injection',
]);
export type CommandActionType = z.infer<typeof commandActionTypeSchema>;

/**
 * Every dispatchable instruction, as a value — the counterpart to
 * ENGINE_ACTION_TYPES above.
 *
 * Exported so a console can DERIVE which instructions are human-originated by
 * subtracting what the engine reports it can propose, instead of hardcoding
 * the six that happen to be left today. See
 * `humanOriginatedActions` in src/lib/ops/recommendationView.ts: if the solver
 * ever learns a fourth action type, the claim "nothing generates these" stops
 * being made about it automatically, with no UI edit.
 */
export const COMMAND_ACTION_TYPES = commandActionTypeSchema.options;

export const commandStatusSchema = z.enum([
  'proposed',
  'awaiting_approval',
  'authorized',
  'delivered',
  'acknowledged',
  'executing',
  'completed',
  'expired',
  'cancelled',
  'failed',
]);
export type CommandStatus = z.infer<typeof commandStatusSchema>;

/**
 * A command flowing web -> control service. dispatcherActionId is
 * REQUIRED and is the wire-level counterpart of the non-negotiable rule
 * in docs/CONTROL_SERVICE_INTEGRATION.md section 1: no command may be sent
 * without a valid, unconsumed, human-authorized dispatcher action. The
 * control service's `commands.dispatcher_action_id` column is NOT NULL and
 * UNIQUE and its `consume_dispatcher_action` trigger rejects a reused or
 * unknown id — see control-service/db/migrations/20260805190000__core_data_model.sql.
 */
export const commandSchema = z.object({
  id: z.string(),
  recommendationId: z.string().nullable(),
  vehicleId: z.string(),
  tripId: z.string().nullable(),
  actionType: commandActionTypeSchema,
  targetStopId: z.string().nullable(),
  parameters: z.record(z.string(), z.unknown()),
  dispatcherActionId: z.string(),
  ttlSeconds: z.number().int().positive(),
  validFrom: z.string(),
  expiresAt: z.string(),
  policyVersion: z.string().nullable(),
  status: commandStatusSchema,
  deliveredAt: z.string().nullable(),
  acknowledgedAt: z.string().nullable(),
  acknowledgementReason: z.string().nullable(),
  // version/supersedesCommandId/ackOutcome/createdAt: added by the driver
  // PWA ticket to match control-service's CommandRow in full
  // (control-service/src/db/commands.ts) — the supersede lifecycle and ack
  // outcome weren't part of this schema's original wire contract. Optional
  // rather than required so this remains a superset-compatible extension
  // of the pre-existing wire contract this schema's own test fixtures
  // exercise (src/tests/unit/control.test.ts) — every real control-service
  // response includes them, but a caller not passing them is not an error.
  version: z.number().int().positive().optional(),
  supersedesCommandId: z.string().nullable().optional(),
  /** Driver ack outcome (blueprint 9.2) — accept/unable/unsafe, never penalized either way. Optional: older/other call sites of this schema may not populate it. */
  ackOutcome: z.enum(['accept', 'unable', 'unsafe']).nullable().optional(),
  createdAt: z.string().optional(),
});
export type Command = z.infer<typeof commandSchema>;

export const complianceSchema = z.enum(['complied', 'partial', 'unable', 'unsafe', 'no_response']);
export type Compliance = z.infer<typeof complianceSchema>;

/** Response body of GET /v1/commands/:id. */
export const commandResponseSchema = z.object({
  command: commandSchema,
});
export type CommandResponse = z.infer<typeof commandResponseSchema>;

/** Mirrors control-service's CommandAuditLogEntry (control-service/src/db/commandAudit.ts) — one row per command_audit_log entry, the sole source of truth for command lifecycle reconstruction. */
export const commandAuditLogEntrySchema = z.object({
  id: z.string(),
  commandId: z.string(),
  eventType: z.string(),
  fromStatus: z.string().nullable(),
  toStatus: z.string(),
  actorType: z.string(),
  actorId: z.string().nullable(),
  reason: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  occurredAt: z.string(),
});
export type CommandAuditLogEntry = z.infer<typeof commandAuditLogEntrySchema>;

/** Response body of GET /v1/commands/:id/audit — ordered oldest-first. */
export const commandAuditResponseSchema = z.object({
  commandId: z.string(),
  command: commandSchema,
  auditLog: z.array(commandAuditLogEntrySchema),
});
export type CommandAuditResponse = z.infer<typeof commandAuditResponseSchema>;

export const outcomeSchema = z.object({
  id: z.string(),
  commandId: z.string().nullable(),
  incidentId: z.string().nullable(),
  actualAction: z.string().nullable(),
  compliance: complianceSchema.nullable(),
  recoverySeconds: z.number().nullable(),
  passengerCost: z.number().nullable(),
  guardrailEvents: z.array(z.record(z.string(), z.unknown())),
  finalAttribution: z.record(z.string(), z.unknown()),
});
export type Outcome = z.infer<typeof outcomeSchema>;

// ---------------------------------------------------------------------------
// Route policy (config, not code)
// ---------------------------------------------------------------------------

export const operatingPeriodSchema = z.enum(['peak', 'off_peak', 'night', 'all']);
export type OperatingPeriod = z.infer<typeof operatingPeriodSchema>;

export const dayTypeSchema = z.enum(['weekday', 'weekend', 'holiday', 'all']);
export type DayType = z.infer<typeof dayTypeSchema>;

export const fallbackModeSchema = z.enum(['live', 'schedule_assisted', 'observation_only']);
export type FallbackMode = z.infer<typeof fallbackModeSchema>;

export const authorizationLevelSchema = z.enum(['automatic', 'approval', 'prohibited']);
export type AuthorizationLevel = z.infer<typeof authorizationLevelSchema>;

/** Mirrors control-service `route_policies` (blueprint Appendix C). Every field here is tunable configuration, never a compiled-in constant. */
export const routePolicySchema = z.object({
  id: z.string(),
  routeDirectionId: z.string(),
  operatingPeriod: operatingPeriodSchema,
  dayType: dayTypeSchema,
  targetHeadwaySeconds: z.number().positive(),
  bunchedThresholdRatio: z.number().positive().max(1),
  warningThresholdRatio: z.number().positive().max(1),
  requiredSamples: z.number().int().positive(),
  predictionHorizonControlPoints: z.number().int().positive(),
  kf: z.number().nullable(),
  kb: z.number().nullable(),
  selfEqualizingK: z.number().nullable(),
  cooldownSeconds: z.number().int().min(0),
  minimumActionSeconds: z.number().int().min(0),
  maxHoldSeconds: z.number().int().min(0),
  occupancyStaleSeconds: z.number().int().nullable(),
  occupancyCapacity: z.number().int().positive().nullable(),
  authorizedActions: z.record(z.string(), authorizationLevelSchema),
  commandTtlSeconds: z.number().int().positive(),
  ackTimeoutSeconds: z.number().int().positive(),
  retryCount: z.number().int().min(0),
  speedBandMinKmph: z.number().nullable(),
  speedBandMaxKmph: z.number().nullable(),
  noOvertake: z.boolean(),
  fallbackMode: fallbackModeSchema,
  kpiThresholds: z.record(z.string(), z.unknown()),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable(),
});
export type RoutePolicy = z.infer<typeof routePolicySchema>;

// ---------------------------------------------------------------------------
// Command / outcome wire responses (driver PWA — "Driver PWA:
// single-instruction command interface")
// ---------------------------------------------------------------------------
// commandSchema itself (above, "Command / outcome") already mirrors
// control-service's CommandRow — extended here with the fields that schema
// didn't yet carry (version/supersedesCommandId/ackOutcome/createdAt) and
// the two response envelopes the driver PWA's API routes validate against
// (src/lib/controlService/commands.ts). This app only ever reads/acks
// commands through control-service's REST surface
// (docs/CONTROL_SERVICE_INTEGRATION.md §1) — it never writes to
// control-service's own `commands` table directly.

export const commandAckOutcomeSchema = z.enum(['accept', 'unable', 'unsafe']);
export type CommandAckOutcome = z.infer<typeof commandAckOutcomeSchema>;

export const activeCommandResponseSchema = z.object({
  command: commandSchema.nullable(),
});

export const acknowledgeCommandResponseSchema = z.object({
  command: commandSchema,
  webhookDelivered: z.boolean(),
});

// ---------------------------------------------------------------------------
// Command CREATION (web -> control service) — the approval bridge
// ---------------------------------------------------------------------------
// Everything above this block is a read or an ack. These three schemas are
// the first time this app describes ISSUING a command, which was previously
// impossible end to end: this app records dispatcher approvals in its own
// ops_dispatcher_actions table, and control-service refuses to insert a
// command without a matching, unconsumed row in ITS OWN dispatcher_actions
// table — a row nothing in that service ever created.
//
// The bridge mirrors THIS app's own ops_dispatcher_actions.id into control's
// dispatcher_actions, inline on POST /v1/commands, written in the same
// transaction as the command. Mirroring our uuid (rather than accepting a
// control-generated one) is what makes the call exactly-once: control's
// commands.dispatcher_action_id is NOT NULL UNIQUE, so a retry produces a 409
// `dispatcher_action_already_used` that this app reads as "the first attempt
// landed" — see src/lib/controlService/createCommand.ts.

/**
 * A human approval mirrored inline into the control service's own
 * `dispatcher_actions` table. Mirrors control-service's
 * `inlineDispatcherActionSchema` (control-service/src/models/schemas.ts)
 * field for field.
 *
 * `routeDirectionId` is required and non-null on purpose: control-service's
 * rollout gate resolves the route-direction it gates on FROM this row, and a
 * null there means "nothing to gate — allow". Sending null would silently
 * disable the rollout gate for every command, so this app refuses to
 * construct such a payload at all.
 */
export const controlDispatcherActionSchema = z.object({
  /** This app's own ops_dispatcher_actions.id — mirrored, never regenerated. */
  id: z.string().uuid(),
  /** The authorizing human: this app's ops_users.id. */
  dispatcherId: z.string().min(1).max(200),
  actionType: commandActionTypeSchema,
  routeDirectionId: z.string().uuid(),
  vehicleId: z.string().min(1).max(64).nullable().optional(),
  incidentId: z.string().uuid().nullable().optional(),
  reason: z.string().min(1).max(2000),
  authorizedAt: z.string().datetime({ offset: true }),
});
export type ControlDispatcherAction = z.infer<typeof controlDispatcherActionSchema>;

/** Request body of POST /v1/commands. Mirrors control-service's `createCommandRequestSchema`, including its two cross-field assertions. */
export const createCommandRequestSchema = z
  .object({
    vehicleId: z.string().min(1),
    tripId: z.string().min(1).nullable().optional(),
    recommendationId: z.string().uuid().nullable().optional(),
    actionType: commandActionTypeSchema,
    targetStopId: z.string().min(1).nullable().optional(),
    parameters: z.record(z.string(), z.unknown()),
    dispatcherActionId: z.string().uuid(),
    ttlSeconds: z.number().int().positive(),
    policyVersion: z.string().nullable().optional(),
    dispatcherAction: controlDispatcherActionSchema.optional(),
  })
  // Same cross-checks control-service applies. Duplicated rather than trusted:
  // without them a caller could hold an approval for `speed_guidance` and
  // issue a `stop_skip` against it, and the audit trail would point at an
  // approval describing an action nobody authorized.
  .superRefine((value, ctx) => {
    if (!value.dispatcherAction) return;
    if (value.dispatcherAction.id !== value.dispatcherActionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dispatcherAction', 'id'],
        message: 'dispatcherAction.id must equal dispatcherActionId',
      });
    }
    if (value.dispatcherAction.actionType !== value.actionType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dispatcherAction', 'actionType'],
        message: 'dispatcherAction.actionType must equal actionType',
      });
    }
  });
export type CreateCommandRequest = z.infer<typeof createCommandRequestSchema>;

/**
 * Response body of POST /v1/commands (201).
 *
 * `webhookDelivered` is OPTIONAL here, and required in
 * acknowledgeCommandResponseSchema above, because the two endpoints know
 * genuinely different things. The ack/deliver/supersede endpoints await
 * their webhook dispatch and report its real outcome. Create does not:
 * control-service fires this request's webhooks without waiting for them
 * (control-service/src/routes/commands.ts#notifyWithoutWaiting), because
 * awaiting them blew the web client's 8s timeout AFTER the command had
 * already committed and delivered. There is therefore no outcome to report,
 * and a placeholder boolean would be a fabricated one.
 *
 * Optional rather than absent so the contract survives a deploy in either
 * order, instead of depending on the two services going out together: a
 * control-service still sending the field (any release up to and including
 * the one this app shipped alongside) parses here, and one that has stopped
 * sending it parses here too. Nothing reads the value on this path - the
 * only consumer, createControlServiceCommand
 * (src/lib/controlService/createCommand.ts), returns `command` and discards
 * the rest - so tolerating it costs nothing, whereas refusing it turns a
 * routine version skew into a 502 on a command an operator had already
 * authorized (and which control-service had already delivered to the
 * driver).
 */
export const createCommandResponseSchema = z.object({
  command: commandSchema,
  webhookDelivered: z.boolean().optional(),
});
export type CreateCommandResponse = z.infer<typeof createCommandResponseSchema>;

// ---------------------------------------------------------------------------
// Pilot-staging dashboard — rollout stage, guardrail breaches, daily KPI
// snapshots, war-room incident review ("Pilot-staging dashboard with
// per-route rollout gates and daily KPIs"). Mirrors
// control-service/src/models/pilotSchemas.ts and the row shapes returned by
// control-service/src/pilot/*.ts.
// ---------------------------------------------------------------------------

export const rolloutStageSchema = z.enum(['observation', 'shadow', 'advisory', 'limited_auto', 'expanded']);
export type RolloutStage = z.infer<typeof rolloutStageSchema>;

export const rolloutStageRowSchema = z.object({
  routeDirectionId: z.string(),
  routeId: z.string(),
  directionCode: z.string(),
  directionName: z.string().nullable(),
  publicName: z.string(),
  stage: rolloutStageSchema,
  reason: z.string().nullable(),
  updatedBy: z.string().nullable(),
  updatedAt: z.string().nullable(),
});
export type RolloutStageRow = z.infer<typeof rolloutStageRowSchema>;

/** Response body of GET /v1/rollout-stages. */
export const rolloutStagesResponseSchema = z.object({
  rolloutStages: z.array(rolloutStageRowSchema),
});

/** Response body of GET/PUT /v1/route-directions/:id/rollout-stage. */
export const rolloutStageResponseSchema = z.object({
  rolloutStage: rolloutStageRowSchema,
});

export const rolloutStageAuditEntrySchema = z.object({
  id: z.string(),
  routeDirectionId: z.string(),
  previousStage: z.string().nullable(),
  newStage: z.string(),
  changedBy: z.string(),
  reason: z.string().nullable(),
  createdAt: z.string(),
});
export type RolloutStageAuditEntry = z.infer<typeof rolloutStageAuditEntrySchema>;

/** Response body of GET /v1/route-directions/:id/rollout-stage/audit. */
export const rolloutStageAuditResponseSchema = z.object({
  routeDirectionId: z.string(),
  auditLog: z.array(rolloutStageAuditEntrySchema),
});

export const guardrailBreachSchema = z.object({
  id: z.string(),
  routeDirectionId: z.string().nullable(),
  breachType: z.string(),
  severity: z.enum(['info', 'warning', 'critical']),
  detail: z.record(z.string(), z.unknown()),
  detectedAt: z.string(),
});
export type GuardrailBreach = z.infer<typeof guardrailBreachSchema>;

/** Response body of GET /v1/guardrail-breaches. */
export const guardrailBreachesResponseSchema = z.object({
  breaches: z.array(guardrailBreachSchema),
});

export const dailyKpiSnapshotSchema = z.object({
  routeDirectionId: z.string(),
  publicName: z.string(),
  directionCode: z.string(),
  snapshotDate: z.string(),
  sampleCount: z.number().int().min(0),
  meanHeadwaySeconds: z.number().nullable(),
  ewtSeconds: z.number().nullable(),
  cv: z.number().nullable(),
  incidentCount: z.number().int().min(0),
  recoveredIncidentCount: z.number().int().min(0),
  recoveryRate: z.number().nullable(),
  guardrailBreachCount: z.number().int().min(0),
  complianceSampleCount: z.number().int().min(0),
  compliancePct: z.number().nullable(),
  computedAt: z.string(),
});
export type DailyKpiSnapshot = z.infer<typeof dailyKpiSnapshotSchema>;

/** Response body of GET /v1/kpi/daily. */
export const dailyKpiResponseSchema = z.object({
  date: z.string(),
  snapshots: z.array(dailyKpiSnapshotSchema),
});

export const warRoomClassificationSchema = z.enum(['eligible', 'exogenous', 'structural']);
export type WarRoomClassification = z.infer<typeof warRoomClassificationSchema>;

export const warRoomIncidentSchema = z.object({
  incidentId: z.string(),
  routeDirectionId: z.string(),
  severity: incidentSeveritySchema,
  causeClass: causeClassSchema,
  controllability: controllabilitySchema,
  status: incidentStatusSchema,
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  classification: warRoomClassificationSchema.nullable(),
  actionTaken: z.string().nullable(),
  reviewOutcome: z.string().nullable(),
  reviewedBy: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  measuredCompliance: complianceSchema.nullable(),
  measuredRecoverySeconds: z.number().nullable(),
  measuredGuardrailEvents: z.array(z.record(z.string(), z.unknown())),
});
export type WarRoomIncident = z.infer<typeof warRoomIncidentSchema>;

/** Response body of GET /v1/war-room/incidents. */
export const warRoomIncidentsResponseSchema = z.object({
  date: z.string(),
  incidents: z.array(warRoomIncidentSchema),
});

/** Response body of PUT /v1/war-room/incidents/:incidentId/review. */
export const warRoomIncidentReviewResponseSchema = z.object({
  incident: warRoomIncidentSchema,
});

export const submitIncidentReviewRequestSchema = z.object({
  classification: warRoomClassificationSchema,
  actionTaken: z.string().max(4000).nullable().optional(),
  outcome: z.string().max(4000).nullable().optional(),
  reviewedBy: z.string().min(1).max(200),
});
export type SubmitIncidentReviewRequest = z.infer<typeof submitIncidentReviewRequestSchema>;

export const setRolloutStageRequestSchema = z.object({
  stage: rolloutStageSchema,
  reason: z.string().max(2000).nullable().optional(),
});
export type SetRolloutStageRequest = z.infer<typeof setRolloutStageRequestSchema>;

// ---------------------------------------------------------------------------
// Arrival prediction
//
// Mirrors control-service/src/arrival-prediction/types.ts field for field. That
// module's header is the authority on what every field MEANS; this is the
// validation boundary, and it exists so a malformed control-service response
// becomes a caught parse error rather than a countdown rendered from `undefined`.
//
// THE ONE RULE FOR ANY CONSUMER OF THESE TYPES. A prediction and a published
// timetable time are different KINDS of claim and must never be rendered as the
// same thing. Nothing in this schema can carry a timetable time - by design, so
// that substituting one is a visible code change in the consumer rather than an
// invisible field swap here. Where `prediction.status` is `'unavailable'`,
// `arrivals` is empty and the honest surface is the reason, not a fallback
// number dressed up as an estimate.
// ---------------------------------------------------------------------------

export const predictionUnavailableReasonSchema = z.enum([
  'vehicle_unknown',
  'no_live_state',
  'unreadable_observation_time',
  'future_dated_state',
  'stale_state',
  'implausible_position',
  'off_route',
  'low_match_confidence',
  'held_by_controller',
  'no_route_geometry',
  'no_stops_ahead',
  'no_speed_basis',
]);
export type PredictionUnavailableReason = z.infer<typeof predictionUnavailableReasonSchema>;

export const stopUnavailableReasonSchema = z.enum([
  'beyond_prediction_horizon',
  'due_or_passed',
  'confidence_below_floor',
]);
export type StopUnavailableReason = z.infer<typeof stopUnavailableReasonSchema>;

/**
 * Where the running speed behind every time in this response was measured.
 *
 * Both values are measurements of buses actually moving. There is deliberately
 * no value for a configured constant: the service declines instead.
 */
export const speedBasisKindSchema = z.enum(['vehicle_smoothed_speed', 'route_peer_median_speed']);
export type SpeedBasisKind = z.infer<typeof speedBasisKindSchema>;

export const runningSpeedSchema = z.object({
  basis: speedBasisKindSchema,
  speedKmph: z.number(),
  sampleCount: z.number().int().nonnegative(),
  /** Fractional half-width used for the bounds. 0.25 means the band was computed at +/-25%. */
  relativeSpread: z.number(),
  /** Along-route half-window the neighbours were drawn from; null when the bus's own speed was used. */
  peerWindowMeters: z.number().nullable(),
});
export type RunningSpeed = z.infer<typeof runningSpeedSchema>;

export const currentStopDwellBasisSchema = z.enum([
  'not_at_stop',
  'observed_dwell_elapsed',
  'dwell_elapsed_unknown',
]);

/**
 * The dwell half of the model. `measured: false` is the honesty flag and is
 * always false: travel time is measured, dwell is a configured constant, and
 * the two are reported separately in every arrival's `components` so the
 * modelled portion of any number stays identifiable.
 */
export const dwellModelSchema = z.object({
  basis: z.literal('configured_default'),
  measured: z.literal(false),
  secondsPerIntermediateStop: z.number(),
  currentStop: z.object({
    basis: currentStopDwellBasisSchema,
    remainingSeconds: z.number(),
  }),
});
export type DwellModel = z.infer<typeof dwellModelSchema>;

export const arrivalComponentsSchema = z.object({
  /** Measured: remaining distance / measured running speed. */
  travelSeconds: z.number(),
  /** Modelled: the dwell constant times the number of stops in between. */
  dwellSeconds: z.number(),
  /** What is left to serve at the stop the bus is at now. */
  currentStopDwellSeconds: z.number(),
  /** How much elapsed time was subtracted to express the answer as "from now". The only extrapolation performed. */
  stateAgeSeconds: z.number(),
});

export const confidenceBandSchema = z.enum(['firm', 'usable', 'rough']);
export type ConfidenceBand = z.infer<typeof confidenceBandSchema>;

const stopArrivalBaseSchema = z.object({
  stopId: z.string(),
  stopName: z.string(),
  sequence: z.number().int(),
  isControlPoint: z.boolean(),
  distanceRemainingMeters: z.number(),
  intermediateStopCount: z.number().int().nonnegative(),
  /**
   * Where the stop is, from the same `stops.geom` row control-service
   * sequenced this arrival from.
   *
   * `.nullable()` and NOT `.optional()`, deliberately. Null is a real answer
   * ("this stop has no surveyed position"), which a renderer must handle by
   * not drawing it. Undefined is not an answer at all, and a `lat={undefined}`
   * reaching a map is how a marker ends up at (0, 0) - see
   * src/lib/maps/plottable.ts for the reading that put the statewide console
   * on empty ocean. Requiring the key makes a control-service that stops
   * sending it a caught parse error here rather than a marker in the sea.
   */
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
});

export const stopArrivalSchema = z.discriminatedUnion('status', [
  stopArrivalBaseSchema.extend({
    status: z.literal('predicted'),
    etaSeconds: z.number(),
    etaAt: z.string(),
    lowerBoundSeconds: z.number(),
    upperBoundSeconds: z.number(),
    confidence: z.number(),
    confidenceBand: confidenceBandSchema,
    components: arrivalComponentsSchema,
  }),
  stopArrivalBaseSchema.extend({
    status: z.literal('unavailable'),
    reason: stopUnavailableReasonSchema,
  }),
]);
export type StopArrival = z.infer<typeof stopArrivalSchema>;

export const predictionEnvelopeSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('unavailable'),
    reason: predictionUnavailableReasonSchema,
    /** Plain-language statement of what is missing, safe to show an operator verbatim. */
    detail: z.string(),
    routeDirectionId: z.string().nullable(),
    observedAt: z.string().nullable(),
    stateAgeSeconds: z.number().nullable(),
    /** Always empty. Present so a consumer that ignores `status` renders nothing rather than something wrong. */
    arrivals: z.array(z.never()).max(0),
  }),
  z.object({
    status: z.literal('available'),
    routeDirectionId: z.string(),
    observedAt: z.string(),
    stateAgeSeconds: z.number(),
    vehicle: z.object({
      distanceAlongRouteMeters: z.number(),
      matchConfidence: z.number(),
      stopState: z.string(),
      currentStopId: z.string().nullable(),
      /** The fix every distance in this response was measured from. Same nullable-not-optional rule as a stop's. */
      latitude: z.number().nullable(),
      longitude: z.number().nullable(),
    }),
    speed: runningSpeedSchema,
    dwell: dwellModelSchema,
    arrivals: z.array(stopArrivalSchema),
  }),
]);
export type PredictionEnvelope = z.infer<typeof predictionEnvelopeSchema>;

export const arrivalPredictionResponseSchema = z.object({
  vehicleId: z.string(),
  /** Every `etaSeconds` is relative to this instant, not to when the client received the response. */
  generatedAt: z.string(),
  horizonSeconds: z.number(),
  stopLimit: z.number(),
  prediction: predictionEnvelopeSchema,
});
export type ArrivalPredictionResponse = z.infer<typeof arrivalPredictionResponseSchema>;

// ===========================================================================
// APPENDED SECTION — inbound control-service -> web webhook envelope
//
// Everything above describes payloads this app READS from control-service's
// REST surface. This block describes the payloads control-service PUSHES to
// this app: the signed deliveries handled by
// src/app/api/control-service/webhook/route.ts.
//
// Wire contract (control-service/src/webhooks/{dispatch,sign}.ts), matched
// byte for byte because the HMAC is computed over the exact serialization:
//   body      JSON.stringify({ type, idempotencyKey, data })
//   signature hex(hmac_sha256(secret, `${timestamp}.${rawBody}`))  — no prefix
//   headers   x-control-service-{timestamp,signature,idempotency-key}
// The signature is the only authentication; there is no Authorization header.
// ===========================================================================

/** The four event types control-service emits today (control-service/src/routes/commands.ts). */
export const controlServiceWebhookEventTypeSchema = z.enum([
  'command.created',
  'command.delivered',
  'command.acknowledged',
  'command.superseded',
]);
export type ControlServiceWebhookEventType = z.infer<typeof controlServiceWebhookEventTypeSchema>;

/**
 * The outer envelope, validated BEFORE the event type is known.
 *
 * `type` is a plain bounded string rather than the enum above on purpose: an
 * unrecognised type must produce a 200 (forward compatibility — a new
 * control-service event must not make the sender log delivery errors and burn
 * its retry budget), whereas a structurally malformed envelope is a 400. Those
 * are different outcomes, so they need different schemas.
 */
export const webhookEventEnvelopeSchema = z.object({
  type: z.string().min(1).max(200),
  idempotencyKey: z.string().min(1).max(300),
  data: z.record(z.string(), z.unknown()),
});
export type WebhookEventEnvelope = z.infer<typeof webhookEventEnvelopeSchema>;

/**
 * `commandSchema` as it appears inside a webhook payload.
 *
 * Two deliberate deltas from the bare `commandSchema` above, both additive:
 *
 *  - `id`/`supersedesCommandId` are narrowed to UUIDs. control-service's
 *    `commands.id` is `uuid primary key default gen_random_uuid()`
 *    (control-service/db/migrations/20260805190000__core_data_model.sql) and
 *    this app's `ops_command_mirror.command_id` is a `uuid` column, so a
 *    non-UUID id is genuinely unprocessable — better a 400 at the edge than a
 *    22P02 from Postgres halfway through the side effects.
 *  - `updatedAt`/`routeDirectionId` are accepted when present. Zod strips
 *    unknown keys, so without naming them here a future control-service that
 *    starts sending `updatedAt` would have it silently dropped — and
 *    `updatedAt` is precisely the field the mirror's out-of-order write guard
 *    prefers as its event time.
 */
export const webhookCommandSchema = commandSchema.extend({
  id: z.string().uuid(),
  supersedesCommandId: z.string().uuid().nullable().optional(),
  /** Preferred event time for the mirror's last-write-wins guard. Not on CommandRow today; honoured if it appears. */
  updatedAt: z.string().optional(),
  /** Not on CommandRow today; the mirror otherwise backfills this from the referenced ops_dispatcher_actions row. */
  routeDirectionId: z.string().nullable().optional(),
});
export type WebhookCommand = z.infer<typeof webhookCommandSchema>;

/** `data` for command.created / command.delivered / command.acknowledged. */
export const commandWebhookDataSchema = z.object({
  command: webhookCommandSchema,
});
export type CommandWebhookData = z.infer<typeof commandWebhookDataSchema>;

/** `data` for command.superseded — the NEW command, plus the id of the one it replaces. */
export const supersededCommandWebhookDataSchema = commandWebhookDataSchema.extend({
  supersedesCommandId: z.string().uuid(),
});
export type SupersededCommandWebhookData = z.infer<typeof supersededCommandWebhookDataSchema>;

/**
 * Fully-typed event, discriminated on `type`. Only applied once the type is
 * known to be one this app handles; a failure here is a contract violation
 * (400), not an unknown-event-type case (200).
 */
export const controlServiceWebhookEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('command.created'),
    idempotencyKey: z.string().min(1).max(300),
    data: commandWebhookDataSchema,
  }),
  z.object({
    type: z.literal('command.delivered'),
    idempotencyKey: z.string().min(1).max(300),
    data: commandWebhookDataSchema,
  }),
  z.object({
    type: z.literal('command.acknowledged'),
    idempotencyKey: z.string().min(1).max(300),
    data: commandWebhookDataSchema,
  }),
  z.object({
    type: z.literal('command.superseded'),
    idempotencyKey: z.string().min(1).max(300),
    data: supersededCommandWebhookDataSchema,
  }),
]);
export type ControlServiceWebhookEvent = z.infer<typeof controlServiceWebhookEventSchema>;
