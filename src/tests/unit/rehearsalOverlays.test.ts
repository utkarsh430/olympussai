// Drawing a rehearsal on the shared fleet map.
//
// The load-bearing property is what these marks are NOT: a simulated bus is
// never handed to the map as a vehicle, because the renderer colours
// vehicles by how old their GPS fix is and a simulated bus has no fix. A
// green "Fresh" chevron over an invented bus is exactly the claim this
// surface exists to avoid making.
import { describe, expect, it } from 'vitest';
import {
  CORRIDOR_OVERLAY_ID,
  FLEET_OVERLAY_ID,
  buildCorridorOverlay,
  buildSimulatedFleetOverlay,
  corridorFitPoints,
  simulatedVehicleColour,
} from '@/lib/rehearsal/overlays';
import type { RehearsalFrame, RehearsalStop } from '@/models/rehearsal';

function stop(overrides: Partial<RehearsalStop> & Pick<RehearsalStop, 'stopId'>): RehearsalStop {
  return {
    name: `Stop ${overrides.stopId}`,
    sequence: 0,
    cumulativeDistanceMeters: 0,
    isControlPoint: false,
    maxHoldSeconds: null,
    latitude: 26.8,
    longitude: 80.9,
    ...overrides,
  };
}

const SHAPE = [
  { latitude: 26.8, longitude: 80.9 },
  { latitude: 26.6, longitude: 80.6 },
  { latitude: 26.4, longitude: 80.3 },
];

function frame(vehicles: RehearsalFrame['vehicles']): RehearsalFrame {
  return { atSeconds: 600, vehicles };
}

function vehicle(
  overrides: Partial<RehearsalFrame['vehicles'][number]> &
    Pick<RehearsalFrame['vehicles'][number], 'vehicleId'>,
): RehearsalFrame['vehicles'][number] {
  return {
    distanceAlongRouteMeters: 1000,
    latitude: 26.7,
    longitude: 80.7,
    headingDegrees: 200,
    onboard: 12,
    status: 'running',
    ...overrides,
  };
}

describe('buildCorridorOverlay', () => {
  it('draws the corridor beneath the buses, because the road is context and the buses are the reading', () => {
    const overlay = buildCorridorOverlay([stop({ stopId: 's1' })], SHAPE);
    expect(overlay.id).toBe(CORRIDOR_OVERLAY_ID);
    expect(overlay.beneath).toBe(true);
  });

  it('rings a control point more prominently than an ordinary stop', () => {
    const overlay = buildCorridorOverlay(
      [
        stop({ stopId: 's1', isControlPoint: true }),
        stop({ stopId: 's2', latitude: 26.5, longitude: 80.5 }),
      ],
      SHAPE,
    );
    const control = overlay.marks.find((m) => m.id.endsWith('s1'))!;
    const ordinary = overlay.marks.find((m) => m.id.endsWith('s2'))!;
    expect(control.radiusPx!).toBeGreaterThan(ordinary.radiusPx!);
    expect(control.colour).not.toBe(ordinary.colour);
  });

  // The shape's vertices are survey geometry, not stops. Ringing them would
  // put a stop wherever the road happened to bend.
  it('draws the route line without ringing its vertices', () => {
    const overlay = buildCorridorOverlay([], SHAPE);
    const path = overlay.marks.find((m) => m.id.endsWith('-path'))!;
    expect(path.points).toHaveLength(3);
    expect(path.radiusPx).toBe(0);
  });

  // Same rule src/lib/maps/plottable.ts exists for, applied to stop rows:
  // one latitude 0.000 reading once opened the statewide console on empty
  // ocean.
  it('drops a stop whose position is not on the served network rather than drawing it at zero', () => {
    const overlay = buildCorridorOverlay(
      [stop({ stopId: 'good' }), stop({ stopId: 'ocean', latitude: 0, longitude: 0 })],
      [],
    );
    expect(overlay.marks.map((m) => m.id)).toEqual([`${CORRIDOR_OVERLAY_ID}-stop-good`]);
  });

  it('draws no line at all from a shape with a single vertex', () => {
    const overlay = buildCorridorOverlay([], [SHAPE[0]!]);
    expect(overlay.marks.some((m) => m.id.endsWith('-path'))).toBe(false);
  });
});

describe('buildSimulatedFleetOverlay', () => {
  it('labels every bus with its simulated id, so nothing reads as a registration number', () => {
    const overlay = buildSimulatedFleetOverlay(
      frame([vehicle({ vehicleId: 'SIM-01' }), vehicle({ vehicleId: 'SIM-02' })]),
      null,
    );
    expect(overlay.id).toBe(FLEET_OVERLAY_ID);
    expect(overlay.marks.map((m) => m.label)).toEqual(['SIM-01', 'SIM-02']);
  });

  it('draws one ring per bus, never a path between them', () => {
    const overlay = buildSimulatedFleetOverlay(frame([vehicle({ vehicleId: 'SIM-01' })]), null);
    expect(overlay.marks[0]!.points).toHaveLength(1);
  });

  it('makes a held bus larger, because a hold is what a planner opened this for', () => {
    const overlay = buildSimulatedFleetOverlay(
      frame([vehicle({ vehicleId: 'SIM-01', status: 'held' }), vehicle({ vehicleId: 'SIM-02' })]),
      null,
    );
    const held = overlay.marks[0]!;
    const running = overlay.marks[1]!;
    expect(held.radiusPx!).toBeGreaterThan(running.radiusPx!);
  });

  it('draws nothing before a run has produced a frame', () => {
    expect(buildSimulatedFleetOverlay(null, null).marks).toEqual([]);
  });

  it('drops a bus whose modelled position is not on the served network', () => {
    const overlay = buildSimulatedFleetOverlay(
      frame([vehicle({ vehicleId: 'SIM-01', latitude: 0, longitude: 0 })]),
      null,
    );
    expect(overlay.marks).toEqual([]);
  });
});

describe('simulatedVehicleColour', () => {
  // Colour carries what the MODEL has the bus doing. It must never carry a
  // data quality, because there is no data.
  it('separates running, dwelling and held', () => {
    const running = simulatedVehicleColour({ vehicleId: 'SIM-01', status: 'running' }, null);
    const dwelling = simulatedVehicleColour({ vehicleId: 'SIM-01', status: 'dwelling' }, null);
    const held = simulatedVehicleColour({ vehicleId: 'SIM-01', status: 'held' }, null);
    expect(new Set([running, dwelling, held]).size).toBe(3);
  });

  it('marks the disturbed bus whatever it is doing, so it can be found in the run', () => {
    const disturbedRunning = simulatedVehicleColour({ vehicleId: 'SIM-02', status: 'running' }, 'SIM-02');
    const disturbedHeld = simulatedVehicleColour({ vehicleId: 'SIM-02', status: 'held' }, 'SIM-02');
    const ordinaryHeld = simulatedVehicleColour({ vehicleId: 'SIM-01', status: 'held' }, 'SIM-02');
    expect(disturbedRunning).toBe(disturbedHeld);
    expect(disturbedHeld).not.toBe(ordinaryHeld);
  });
});

describe('corridorFitPoints', () => {
  it('opens the camera over the whole corridor rather than over whichever bus leads', () => {
    expect(corridorFitPoints([], SHAPE)).toHaveLength(3);
  });

  it('falls back to the stops when the corridor has no drawable shape', () => {
    const points = corridorFitPoints([stop({ stopId: 's1' }), stop({ stopId: 's2', latitude: 26.5 })], []);
    expect(points).toHaveLength(2);
  });

  // fitBounds takes the extremes of whatever it is given, so one bad
  // coordinate decides what every reader sees first.
  it('never lets an off-network coordinate into the camera fit', () => {
    const points = corridorFitPoints([], [...SHAPE, { latitude: 0, longitude: 0 }]);
    expect(points).toHaveLength(3);
  });
});
