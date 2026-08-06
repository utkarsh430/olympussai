import { describe, it, expect } from 'vitest';
import {
  controlRouteSchema,
  controlRouteDirectionSchema,
  controlPointSchema,
  controlTripSchema,
  vehicleStateSchema,
  headwayStateSchema,
  bunchingIncidentSchema,
  recommendationSchema,
  commandSchema,
  outcomeSchema,
  routePolicySchema,
  routeDirectionMetaSchema,
  headwayPairMetricSchema,
  headwayAggregateSchema,
  incidentChangeSchema,
  headwayComputeResultSchema,
  incidentsResponseSchema,
  routeDirectionsResponseSchema,
  vehicleStatesResponseSchema,
} from '@/models/control';

describe('control service wire-contract schemas', () => {
  it('accepts a valid route + direction', () => {
    expect(() =>
      controlRouteSchema.parse({
        id: 'R1',
        publicName: 'Route 1',
        operatingMode: 'headway_managed',
        isActive: true,
      }),
    ).not.toThrow();

    expect(() =>
      controlRouteDirectionSchema.parse({
        id: 'dir-1',
        routeId: 'R1',
        directionCode: 'UP',
        directionName: 'Up direction',
        corridorId: null,
        isActive: true,
      }),
    ).not.toThrow();
  });

  it('accepts a control point with config-not-code fields', () => {
    const parsed = controlPointSchema.parse({
      id: 'rds-1',
      routeDirectionId: 'dir-1',
      stopId: 'S1',
      sequence: 0,
      cumulativeDistanceMeters: 0,
      location: { latitude: 28.0, longitude: 77.0 },
      isControlPoint: true,
      holdSuitable: true,
      maxHoldSeconds: 90,
      geofenceRadiusMeters: 25,
      laybyBerth: true,
      shelterFlag: false,
      weatherFlag: false,
    });
    expect(parsed.maxHoldSeconds).toBe(90);
    expect(parsed.geofenceRadiusMeters).toBe(25);
  });

  it('rejects an out-of-range geo point', () => {
    expect(() =>
      controlPointSchema.parse({
        id: 'rds-1',
        routeDirectionId: 'dir-1',
        stopId: 'S1',
        sequence: 0,
        cumulativeDistanceMeters: 0,
        location: { latitude: 999, longitude: 77.0 },
        isControlPoint: true,
        holdSuitable: true,
        maxHoldSeconds: null,
        geofenceRadiusMeters: 25,
        laybyBerth: false,
        shelterFlag: false,
        weatherFlag: false,
      }),
    ).toThrow();
  });

  it('accepts a scheduled trip', () => {
    expect(() =>
      controlTripSchema.parse({
        id: 'T1',
        routeDirectionId: 'dir-1',
        blockId: 'B1',
        vehicleId: 'V1',
        serviceDate: '2026-08-05',
        scheduledStartTime: '2026-08-05T06:00:00Z',
        scheduledEndTime: '2026-08-05T07:00:00Z',
        originStopId: 'S1',
        destinationStopId: 'S2',
        reliefPointStopId: null,
        status: 'scheduled',
      }),
    ).not.toThrow();
  });

  it('accepts a live vehicle state with a stop-state classification', () => {
    const parsed = vehicleStateSchema.parse({
      vehicleId: 'V1',
      tripId: 'T1',
      routeDirectionId: 'dir-1',
      position: { latitude: 28.0, longitude: 77.0 },
      distanceAlongRouteMeters: 120.5,
      speedKmph: 22.4,
      headingDegrees: 90,
      stopState: 'dwelling_at_stop',
      currentStopId: 'S1',
      occupancyCount: 30,
      occupancyLoadBand: 'medium',
      confidence: 0.95,
      observedAt: '2026-08-05T06:01:00Z',
    });
    expect(parsed.stopState).toBe('dwelling_at_stop');
  });

  it('accepts a headway state with forward/backward headways', () => {
    expect(() =>
      headwayStateSchema.parse({
        id: 'hs-1',
        routeDirectionId: 'dir-1',
        leaderVehicleId: 'V1',
        followerVehicleId: 'V2',
        hFwdSeconds: 240,
        hBwdSeconds: 300,
        targetHeadwaySeconds: 300,
        deviationSeconds: -60,
        forecastHFwdSeconds: 220,
        confidence: 0.8,
        computedAt: '2026-08-05T06:02:00Z',
      }),
    ).not.toThrow();
  });

  it('accepts a bunching incident with members and evidence', () => {
    expect(() =>
      bunchingIncidentSchema.parse({
        id: 'inc-1',
        routeDirectionId: 'dir-1',
        members: [
          { vehicleId: 'V1', role: 'leader' },
          { vehicleId: 'V2', role: 'follower' },
        ],
        severity: 'bunched',
        causeClass: 'endogenous',
        controllability: 'controllable',
        status: 'open',
        startedAt: '2026-08-05T06:03:00Z',
        endedAt: null,
        evidence: { headwayRatio: 0.2 },
      }),
    ).not.toThrow();
  });

  it('accepts a recommendation with candidate actions', () => {
    expect(() =>
      recommendationSchema.parse({
        id: 'rec-1',
        incidentId: 'inc-1',
        routeDirectionId: 'dir-1',
        candidateActions: [{ actionType: 'two_way_hold', holdSeconds: 45 }],
        selectedActionType: 'two_way_hold',
        objectiveCost: 12.5,
        expectedRecoverySeconds: 180,
        constraints: { maxHoldSeconds: 90 },
        modelVersion: 'controller-v1',
        controllerVersion: 'two-way-hold-v1',
        status: 'selected',
      }),
    ).not.toThrow();
  });

  it('requires a dispatcherActionId on every command', () => {
    const base = {
      id: 'cmd-1',
      recommendationId: 'rec-1',
      vehicleId: 'V1',
      tripId: 'T1',
      actionType: 'two_way_hold' as const,
      targetStopId: 'S1',
      parameters: { holdSeconds: 45 },
      ttlSeconds: 120,
      validFrom: '2026-08-05T06:04:00Z',
      expiresAt: '2026-08-05T06:06:00Z',
      policyVersion: 'v1',
      status: 'proposed' as const,
      deliveredAt: null,
      acknowledgedAt: null,
      acknowledgementReason: null,
    };

    expect(() => commandSchema.parse({ ...base, dispatcherActionId: 'da-1' })).not.toThrow();
    expect(() => commandSchema.parse({ ...base, dispatcherActionId: undefined })).toThrow();
  });

  it('accepts an outcome record', () => {
    expect(() =>
      outcomeSchema.parse({
        id: 'out-1',
        commandId: 'cmd-1',
        incidentId: 'inc-1',
        actualAction: 'held 42s',
        compliance: 'complied',
        recoverySeconds: 150,
        passengerCost: 3.2,
        guardrailEvents: [],
        finalAttribution: { causeClass: 'endogenous' },
      }),
    ).not.toThrow();
  });

  it('accepts a config-not-code route policy', () => {
    const parsed = routePolicySchema.parse({
      id: 'pol-1',
      routeDirectionId: 'dir-1',
      operatingPeriod: 'peak',
      dayType: 'weekday',
      targetHeadwaySeconds: 300,
      bunchedThresholdRatio: 0.25,
      warningThresholdRatio: 0.5,
      requiredSamples: 3,
      predictionHorizonControlPoints: 3,
      kf: 0.4,
      kb: 0.2,
      selfEqualizingK: 0.3,
      cooldownSeconds: 60,
      minimumActionSeconds: 10,
      maxHoldSeconds: 90,
      occupancyStaleSeconds: 120,
      occupancyCapacity: 60,
      authorizedActions: { two_way_hold: 'automatic', stop_skip: 'approval' },
      commandTtlSeconds: 120,
      ackTimeoutSeconds: 30,
      retryCount: 0,
      speedBandMinKmph: 10,
      speedBandMaxKmph: 40,
      noOvertake: false,
      fallbackMode: 'observation_only',
      kpiThresholds: { ewtSeconds: 90 },
      effectiveFrom: '2026-08-05T00:00:00Z',
      effectiveTo: null,
    });
    expect(parsed.maxHoldSeconds).toBe(90);
    expect(parsed.authorizedActions.two_way_hold).toBe('automatic');
  });

  it('accepts a vehicle state that omits position/heading/occupancy (today\'s actual GET /v1/vehicle-states shape)', () => {
    const parsed = vehicleStateSchema.parse({
      vehicleId: 'V1',
      tripId: null,
      routeDirectionId: 'dir-1',
      distanceAlongRouteMeters: 120.5,
      speedKmph: 22.4,
      stopState: 'off_route',
      currentStopId: null,
      confidence: 0.9,
      observedAt: '2026-08-06T06:01:00Z',
    });
    expect(parsed.position).toBeUndefined();
    expect(parsed.speedKmph).toBe(22.4);
  });

  it('accepts a route-direction metrics projection', () => {
    const parsed = routeDirectionMetaSchema.parse({
      routeDirectionId: 'dir-1',
      routeId: 'R1',
      directionCode: 'up',
      isLoop: false,
      totalDistanceMeters: 18500,
    });
    expect(parsed.isLoop).toBe(false);
  });

  it('accepts a headway pair metric with a null backward headway (stationary leader)', () => {
    const parsed = headwayPairMetricSchema.parse({
      id: 'hs-1',
      routeDirectionId: 'dir-1',
      leaderVehicleId: 'V1',
      followerVehicleId: 'V2',
      gapMeters: 900,
      hFwdSeconds: 180,
      hBwdSeconds: null,
      targetHeadwaySeconds: 300,
      deviationSeconds: -120,
      confidence: 0.8,
    });
    expect(parsed.hBwdSeconds).toBeNull();
    expect(parsed.deviationSeconds).toBe(-120);
  });

  it('accepts a headway aggregate with CV/EWT', () => {
    const parsed = headwayAggregateSchema.parse({
      routeDirectionId: 'dir-1',
      sampleCount: 4,
      meanHeadwaySeconds: 280,
      stddevHeadwaySeconds: 60,
      cv: 0.214,
      ewtSeconds: 15.2,
      targetHeadwaySeconds: 300,
    });
    expect(parsed.cv).toBeCloseTo(0.214);
  });

  it('accepts a zero-sample headway aggregate (all metrics null, never thrown)', () => {
    const parsed = headwayAggregateSchema.parse({
      routeDirectionId: 'dir-1',
      sampleCount: 0,
      meanHeadwaySeconds: null,
      stddevHeadwaySeconds: null,
      cv: null,
      ewtSeconds: null,
      targetHeadwaySeconds: 300,
    });
    expect(parsed.sampleCount).toBe(0);
  });

  it('accepts an "opened" incident change and rejects an unknown action', () => {
    expect(() =>
      incidentChangeSchema.parse({
        routeDirectionId: 'dir-1',
        leaderVehicleId: 'V1',
        followerVehicleId: 'V2',
        action: 'opened',
        severity: 'bunched',
        incidentId: 'inc-1',
        ratio: 0.18,
      }),
    ).not.toThrow();

    expect(() =>
      incidentChangeSchema.parse({
        routeDirectionId: 'dir-1',
        leaderVehicleId: 'V1',
        followerVehicleId: 'V2',
        action: 'exploded',
        severity: null,
        incidentId: null,
        ratio: null,
      }),
    ).toThrow();
  });

  it('accepts a full headway compute result (pairs + aggregate + incident changes)', () => {
    const parsed = headwayComputeResultSchema.parse({
      routeDirectionId: 'dir-1',
      computedAt: '2026-08-06T06:01:00Z',
      pairs: [
        {
          id: 'hs-1',
          routeDirectionId: 'dir-1',
          leaderVehicleId: 'V1',
          followerVehicleId: 'V2',
          gapMeters: 900,
          hFwdSeconds: 180,
          hBwdSeconds: 200,
          targetHeadwaySeconds: 300,
          deviationSeconds: -120,
          confidence: 0.8,
        },
      ],
      aggregate: {
        routeDirectionId: 'dir-1',
        sampleCount: 1,
        meanHeadwaySeconds: 180,
        stddevHeadwaySeconds: 0,
        cv: 0,
        ewtSeconds: 0,
        targetHeadwaySeconds: 300,
      },
      incidents: [
        {
          routeDirectionId: 'dir-1',
          leaderVehicleId: 'V1',
          followerVehicleId: 'V2',
          action: 'opened',
          severity: 'bunched',
          incidentId: 'inc-1',
          ratio: 0.6,
        },
      ],
    });
    expect(parsed.pairs).toHaveLength(1);
    expect(parsed.incidents[0]?.action).toBe('opened');
  });

  it('accepts the GET /v1/route-directions, /v1/vehicle-states and /v1/incidents response envelopes', () => {
    expect(() => routeDirectionsResponseSchema.parse({ routeDirections: [] })).not.toThrow();
    expect(() =>
      vehicleStatesResponseSchema.parse({
        vehicleStates: [
          {
            vehicleId: 'V1',
            tripId: null,
            routeDirectionId: 'dir-1',
            distanceAlongRouteMeters: 100,
            speedKmph: 20,
            stopState: 'off_route',
            currentStopId: null,
            confidence: 0.7,
            observedAt: '2026-08-06T06:00:00Z',
          },
        ],
      }),
    ).not.toThrow();
    expect(() => incidentsResponseSchema.parse({ incidents: [] })).not.toThrow();
  });
});
