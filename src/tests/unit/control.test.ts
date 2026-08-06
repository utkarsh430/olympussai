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
});
