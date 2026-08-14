// @vitest-environment node
//
// The pure half of the ops map: how a scoped fleet plus control-service
// vehicle states become drawable vehicles, and how real bunching incidents
// become overlay geometry.
//
// The wire-level boundary proof lives in opsMapBoundary.test.ts. This file
// covers the rule underneath it - that the SCOPED FLEET is what gets
// iterated, so a vehicle state with no matching bus is inert - plus the
// honesty properties a map either has or lies about: position provenance,
// heading fallback, and incidents that cannot be drawn being reported rather
// than silently dropped.
import { describe, it, expect } from 'vitest';
import { buildIncidentOverlay, toOpsMapVehicles, type OpsMapVehicle } from '@/lib/ops/mapVehicles';
import type { CanonicalLiveBus } from '@/models/canonical';
import type { BunchingIncident, VehicleState } from '@/models/control';

function bus(overrides: Partial<CanonicalLiveBus> & { id: string }): CanonicalLiveBus {
  return {
    registrationNumber: overrides.id,
    latitude: 28.35,
    longitude: 79.42,
    speedKmph: 20,
    headingDegrees: 90,
    depotName: 'BAREILLY',
    routeId: 'R1',
    routeName: 'Route 1',
    serviceNumber: 'S1',
    tripId: 'T1',
    vehicleType: null,
    gpsTimestamp: '2026-08-12T06:00:00Z',
    lastUpdatedAt: '2026-08-12T06:00:00Z',
    ignitionOn: true,
    rawStatus: 'RUNNING',
    tripDate: '2026-08-12',
    dataQuality: 'good',
    ...overrides,
  };
}

function state(overrides: Partial<VehicleState> & { vehicleId: string }): VehicleState {
  return {
    tripId: 'T1',
    routeDirectionId: 'rd-1',
    position: { latitude: 27.1, longitude: 80.2 },
    distanceAlongRouteMeters: 900,
    speedKmph: 33,
    headingDegrees: 200,
    stopState: 'departed_stop',
    currentStopId: null,
    occupancyCount: null,
    occupancyLoadBand: null,
    confidence: 0.8,
    observedAt: '2026-08-12T06:00:30Z',
    ...overrides,
  };
}

describe('toOpsMapVehicles', () => {
  it('prefers the control-service position and labels it as such', () => {
    const [vehicle] = toOpsMapVehicles([bus({ id: 'A' })], [state({ vehicleId: 'A' })]);
    expect(vehicle).toMatchObject({
      id: 'A',
      latitude: 27.1,
      longitude: 80.2,
      headingDegrees: 200,
      speedKmph: 33,
      stopState: 'departed_stop',
      positionSource: 'control-service',
      observedAt: '2026-08-12T06:00:30Z',
    });
  });

  it('keeps the GPS position when control-service reports no fix', () => {
    const [vehicle] = toOpsMapVehicles([bus({ id: 'A' })], [state({ vehicleId: 'A', position: null })]);
    expect(vehicle).toMatchObject({
      latitude: 28.35,
      longitude: 79.42,
      positionSource: 'live-feed',
      observedAt: '2026-08-12T06:00:00Z',
    });
  });

  // An older control-service build omits the key entirely rather than sending
  // null. Both must fall back; a vehicle drawn at 0,0 would be worse than no
  // vehicle at all.
  it('keeps the GPS position when the endpoint omits position altogether', () => {
    const legacy = state({ vehicleId: 'A' });
    delete (legacy as { position?: unknown }).position;
    const [vehicle] = toOpsMapVehicles([bus({ id: 'A' })], [legacy]);
    expect(vehicle).toMatchObject({ latitude: 28.35, longitude: 79.42, positionSource: 'live-feed' });
  });

  it('falls back to the GPS heading when a control-service fix carries none', () => {
    const [vehicle] = toOpsMapVehicles([bus({ id: 'A' })], [state({ vehicleId: 'A', headingDegrees: null })]);
    expect(vehicle).toMatchObject({ latitude: 27.1, headingDegrees: 90, positionSource: 'control-service' });
  });

  it('leaves a vehicle with no control-service row entirely on the GPS feed', () => {
    const [vehicle] = toOpsMapVehicles([bus({ id: 'A' })], []);
    expect(vehicle).toMatchObject({ positionSource: 'live-feed', stopState: null, routeDirectionId: null });
  });

  // THE FAIL-CLOSED SHAPE. The scoped fleet is the iteration; a vehicle state
  // is only ever a lookup. Reverse the two and a depot operator's map would
  // draw every vehicle control-service knows about, because a vehicle state
  // carries no depot of its own.
  it('draws nothing for a vehicle state with no matching scoped bus', () => {
    const vehicles = toOpsMapVehicles([bus({ id: 'MINE' })], [
      state({ vehicleId: 'MINE' }),
      state({ vehicleId: 'SOMEONE_ELSES', position: { latitude: 1, longitude: 2 } }),
    ]);
    expect(vehicles.map((vehicle) => vehicle.id)).toEqual(['MINE']);
  });

  it('carries the depot through, so a caption can name the boundary', () => {
    const [vehicle] = toOpsMapVehicles([bus({ id: 'A', depotName: 'LUCKNOW' })]);
    expect(vehicle?.depotName).toBe('LUCKNOW');
  });

  it('preserves the feed data quality, which is what the renderer colours by', () => {
    const vehicles = toOpsMapVehicles([
      bus({ id: 'A', dataQuality: 'good' }),
      bus({ id: 'B', dataQuality: 'stale' }),
    ]);
    expect(vehicles.map((vehicle) => vehicle.dataQuality)).toEqual(['good', 'stale']);
  });
});

function incident(overrides: Partial<BunchingIncident> & { id: string }): BunchingIncident {
  return {
    routeDirectionId: 'rd-1',
    members: [
      { vehicleId: 'A', role: 'leader' },
      { vehicleId: 'B', role: 'follower' },
    ],
    severity: 'bunched',
    causeClass: 'endogenous',
    controllability: 'controllable',
    status: 'open',
    startedAt: '2026-08-12T06:00:00Z',
    endedAt: null,
    evidence: {},
    ...overrides,
  };
}

const drawn: OpsMapVehicle[] = toOpsMapVehicles([
  bus({ id: 'A', latitude: 28.1, longitude: 79.1 }),
  bus({ id: 'B', latitude: 28.2, longitude: 79.2 }),
]);

describe('buildIncidentOverlay', () => {
  it('links the members it can place, leader first', () => {
    const result = buildIncidentOverlay(
      [incident({ id: 'inc-1', members: [{ vehicleId: 'B', role: 'follower' }, { vehicleId: 'A', role: 'leader' }] })],
      drawn,
    );
    expect(result.overlay.marks).toHaveLength(1);
    expect(result.overlay.marks[0]?.points).toEqual([
      { latitude: 28.1, longitude: 79.1 },
      { latitude: 28.2, longitude: 79.2 },
    ]);
    expect(result.renderedIncidentIds).toEqual(['inc-1']);
  });

  it('colours and labels by severity', () => {
    const result = buildIncidentOverlay(
      [
        incident({ id: 'w', severity: 'warning' }),
        incident({ id: 'b', severity: 'bunched' }),
        incident({ id: 's', severity: 'severe' }),
      ],
      drawn,
    );
    expect(result.overlay.marks.map((mark) => mark.label)).toEqual(['WARNING', 'BUNCHED', 'SEVERE']);
    expect(new Set(result.overlay.marks.map((mark) => mark.colour)).size).toBe(3);
  });

  // The overlay inherits the fleet's boundary rather than re-deriving one: it
  // can only place a vehicle it was given. An out-of-scope member has no
  // position to resolve, so it cannot be plotted.
  it('plots only the members present in the drawn fleet', () => {
    const result = buildIncidentOverlay(
      [incident({ id: 'inc-1', members: [{ vehicleId: 'A', role: 'leader' }, { vehicleId: 'FOREIGN', role: 'follower' }] })],
      drawn,
    );
    expect(result.overlay.marks[0]?.points).toEqual([{ latitude: 28.1, longitude: 79.1 }]);
  });

  it('reports an incident it could not place at all, instead of silently dropping it', () => {
    const result = buildIncidentOverlay(
      [incident({ id: 'inc-foreign', members: [{ vehicleId: 'FOREIGN', role: 'leader' }] })],
      drawn,
    );
    expect(result.overlay.marks).toEqual([]);
    expect(result.renderedIncidentIds).toEqual([]);
    expect(result.unresolvedIncidentIds).toEqual(['inc-foreign']);
  });

  it('drops a closed incident, because an overlay is a claim about right now', () => {
    const result = buildIncidentOverlay([incident({ id: 'done', status: 'closed' })], drawn);
    expect(result.overlay.marks).toEqual([]);
    expect(result.unresolvedIncidentIds).toEqual([]);
  });

  it('keeps escalated and mitigating incidents, which are still live', () => {
    const result = buildIncidentOverlay(
      [incident({ id: 'esc', status: 'escalated' }), incident({ id: 'mit', status: 'mitigating' })],
      drawn,
    );
    expect(result.renderedIncidentIds).toEqual(['esc', 'mit']);
  });

  it('produces an empty overlay rather than throwing when nothing is happening', () => {
    const result = buildIncidentOverlay([], drawn);
    expect(result.overlay).toEqual({ id: 'bunching-incidents', marks: [] });
  });
});
