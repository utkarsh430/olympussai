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
  // `.nullable()`: the control service's GET /v1/vehicle-states (the
  // in-memory VehicleStateRow projection, control-service/src/state/store.ts)
  // does not populate these columns yet — they're real vehicle_states
  // columns but that read path was scoped to what the MPC solver needed at
  // the time it shipped. Optional here means this schema still validates
  // today's actual response instead of silently lying about its shape;
  // widen the endpoint to populate them and this schema keeps working
  // either way.
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
