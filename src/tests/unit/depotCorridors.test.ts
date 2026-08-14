import { describe, expect, it } from 'vitest';
import type { RouteDirectionMeta } from '@/models/control';
import {
  corridorDetection,
  depotCorridorLabel,
  depotDetectionCoverage,
  deriveDepotCorridors,
  describeCorridorObservationOnly,
  describeDepotDetectionCoverage,
  selectDepotCorridor,
  type DepotCorridor,
} from '@/lib/ops/depotCorridors';

function meta(overrides: Partial<RouteDirectionMeta> & Pick<RouteDirectionMeta, 'routeDirectionId'>): RouteDirectionMeta {
  return {
    routeId: '1348',
    directionCode: 'OUT',
    isLoop: false,
    totalDistanceMeters: 42_000,
    ...overrides,
  };
}

function corridor(overrides: Partial<DepotCorridor> & Pick<DepotCorridor, 'routeDirectionId'>): DepotCorridor {
  return {
    routeId: '1348',
    directionCode: 'OUT',
    isLoop: false,
    hasActivePolicy: true,
    depotVehicleCount: 1,
    ...overrides,
  };
}

describe('deriveDepotCorridors', () => {
  it('keeps only corridors this depot has vehicles on, and counts them', () => {
    const corridors = deriveDepotCorridors(
      [meta({ routeDirectionId: 'rd-a' }), meta({ routeDirectionId: 'rd-b', routeId: '999' }), meta({ routeDirectionId: 'rd-unrelated', routeId: '111' })],
      [
        { vehicleId: 'UP25A', routeDirectionId: 'rd-a' },
        { vehicleId: 'UP25B', routeDirectionId: 'rd-a' },
        { vehicleId: 'UP25C', routeDirectionId: 'rd-b' },
      ],
    );

    expect(corridors.map((c) => c.routeDirectionId)).toEqual(['rd-a', 'rd-b']);
    expect(corridors[0]!.depotVehicleCount).toBe(2);
    expect(corridors[1]!.depotVehicleCount).toBe(1);
  });

  it('ignores vehicles the control service places on no corridor rather than bucketing them', () => {
    const corridors = deriveDepotCorridors(
      [meta({ routeDirectionId: 'rd-a' })],
      [
        { vehicleId: 'UP25A', routeDirectionId: 'rd-a' },
        { vehicleId: 'UP25B', routeDirectionId: null },
        { vehicleId: 'UP25C', routeDirectionId: null },
      ],
    );

    expect(corridors).toHaveLength(1);
    expect(corridors[0]!.depotVehicleCount).toBe(1);
  });

  it('drops a corridor the depot is running that the corridor list cannot describe', () => {
    // The corridor list is what carries hasActivePolicy. An id present only in
    // the vehicle states would have to be shown with its detection state made
    // up, which is the one thing this console must not do.
    const corridors = deriveDepotCorridors(
      [meta({ routeDirectionId: 'rd-a' })],
      [
        { vehicleId: 'UP25A', routeDirectionId: 'rd-a' },
        { vehicleId: 'UP25B', routeDirectionId: 'rd-unmapped' },
      ],
    );

    expect(corridors.map((c) => c.routeDirectionId)).toEqual(['rd-a']);
  });

  it('orders busiest first, then by routeId and directionCode so ties do not reshuffle between renders', () => {
    const routeDirections = [
      meta({ routeDirectionId: 'rd-z', routeId: '900', directionCode: 'OUT' }),
      meta({ routeDirectionId: 'rd-y', routeId: '100', directionCode: 'RET' }),
      meta({ routeDirectionId: 'rd-x', routeId: '100', directionCode: 'OUT' }),
      meta({ routeDirectionId: 'rd-busy', routeId: '500', directionCode: 'OUT' }),
    ];
    const states = [
      { vehicleId: 'v1', routeDirectionId: 'rd-z' },
      { vehicleId: 'v2', routeDirectionId: 'rd-y' },
      { vehicleId: 'v3', routeDirectionId: 'rd-x' },
      { vehicleId: 'v4', routeDirectionId: 'rd-busy' },
      { vehicleId: 'v5', routeDirectionId: 'rd-busy' },
    ];

    const forward = deriveDepotCorridors(routeDirections, states).map((c) => c.routeDirectionId);
    const reversed = deriveDepotCorridors([...routeDirections].reverse(), [...states].reverse()).map(
      (c) => c.routeDirectionId,
    );

    expect(forward).toEqual(['rd-busy', 'rd-x', 'rd-y', 'rd-z']);
    expect(reversed).toEqual(forward);
  });

  it('carries the three-state policy flag through untouched', () => {
    const corridors = deriveDepotCorridors(
      [
        meta({ routeDirectionId: 'rd-yes', hasActivePolicy: true }),
        meta({ routeDirectionId: 'rd-no', routeId: '2', hasActivePolicy: false }),
        meta({ routeDirectionId: 'rd-silent', routeId: '3' }),
      ],
      [
        { vehicleId: 'a', routeDirectionId: 'rd-yes' },
        { vehicleId: 'b', routeDirectionId: 'rd-no' },
        { vehicleId: 'c', routeDirectionId: 'rd-silent' },
      ],
    );

    const byId = new Map(corridors.map((c) => [c.routeDirectionId, c]));
    expect(byId.get('rd-yes')?.hasActivePolicy).toBe(true);
    expect(byId.get('rd-no')?.hasActivePolicy).toBe(false);
    expect(byId.get('rd-silent')?.hasActivePolicy).toBeUndefined();
    expect(corridorDetection(byId.get('rd-yes')!)).toBe('detecting');
    expect(corridorDetection(byId.get('rd-no')!)).toBe('observation-only');
    expect(corridorDetection(byId.get('rd-silent')!)).toBe('unknown');
  });
});

describe('selectDepotCorridor', () => {
  const corridors = [corridor({ routeDirectionId: 'rd-busy', depotVehicleCount: 5 }), corridor({ routeDirectionId: 'rd-quiet' })];

  it('honours a requested corridor the depot is running', () => {
    expect(selectDepotCorridor(corridors, 'rd-quiet')?.routeDirectionId).toBe('rd-quiet');
  });

  it('falls back to the busiest corridor rather than showing an empty board for a stale bookmark', () => {
    expect(selectDepotCorridor(corridors, 'rd-some-other-depots-road')?.routeDirectionId).toBe('rd-busy');
    expect(selectDepotCorridor(corridors, undefined)?.routeDirectionId).toBe('rd-busy');
    expect(selectDepotCorridor(corridors, null)?.routeDirectionId).toBe('rd-busy');
  });

  it('returns null when the depot is on no mapped corridor at all', () => {
    expect(selectDepotCorridor([], 'rd-busy')).toBeNull();
  });
});

describe('depotDetectionCoverage', () => {
  it('splits the depot’s corridors into what can detect, what cannot, and what is unknown', () => {
    const coverage = depotDetectionCoverage([
      corridor({ routeDirectionId: 'a', hasActivePolicy: true }),
      corridor({ routeDirectionId: 'b', hasActivePolicy: false }),
      corridor({ routeDirectionId: 'c', hasActivePolicy: false }),
      corridor({ routeDirectionId: 'd', hasActivePolicy: undefined }),
    ]);

    expect(coverage).toEqual({ running: 4, detecting: 1, observationOnly: 2, unknown: 1 });
  });
});

describe('describeDepotDetectionCoverage', () => {
  it('says an all-observation-only depot will never see a bunching incident, in words', () => {
    const sentence = describeDepotDetectionCoverage(
      { running: 3, detecting: 0, observationOnly: 3, unknown: 0 },
      'Bareilly',
    );

    // The failure this exists to prevent: a permanently empty bunching panel
    // read as a quiet night.
    expect(sentence).toContain('observation-only');
    expect(sentence).toContain('not a quiet corridor');
    expect(sentence).not.toMatch(/\b0 of\b/);
  });

  it('names both halves when a depot has a mix', () => {
    const sentence = describeDepotDetectionCoverage(
      { running: 10, detecting: 4, observationOnly: 6, unknown: 0 },
      'Bareilly',
    );

    expect(sentence).toContain('4 of the 10 corridors');
    expect(sentence).toContain('6 corridors marked observation-only');
  });

  it('reports unknown policy state as unknown rather than as no', () => {
    const sentence = describeDepotDetectionCoverage(
      { running: 5, detecting: 2, observationOnly: 1, unknown: 2 },
      'Bareilly',
    );

    expect(sentence).toContain('does not report a policy state for 2 of them');
    expect(sentence).toContain('unknown rather than no');
  });

  it('distinguishes "this depot is on no mapped corridor" from "this depot is quiet"', () => {
    const sentence = describeDepotDetectionCoverage(
      { running: 0, detecting: 0, observationOnly: 0, unknown: 0 },
      'Bareilly',
    );

    expect(sentence).toContain('gap in the mapped route network');
    expect(sentence).toContain('not a quiet depot');
  });

  it('does not hedge a depot whose corridors all detect', () => {
    const sentence = describeDepotDetectionCoverage(
      { running: 2, detecting: 2, observationOnly: 0, unknown: 0 },
      'Bareilly',
    );

    expect(sentence).toBe('All 2 corridors Bareilly is running carry a measured target headway and can report bunching.');
  });
});

describe('describeCorridorObservationOnly', () => {
  it('stays silent for a corridor that can actually detect', () => {
    expect(describeCorridorObservationOnly(corridor({ routeDirectionId: 'a', hasActivePolicy: true }))).toBeNull();
  });

  it('blames the corridor’s configuration, not the connection, when detection is off', () => {
    const text = describeCorridorObservationOnly(
      corridor({ routeDirectionId: 'a', hasActivePolicy: false, routeId: '1348', directionCode: 'OUT' }),
    );

    expect(text).toContain('1348 · OUT');
    expect(text).toContain('no measured target headway');
    expect(text).toContain('not a failure to reach it');
  });

  it('says unknown, not no, when the service reports no policy state', () => {
    const text = describeCorridorObservationOnly(corridor({ routeDirectionId: 'a', hasActivePolicy: undefined }));

    expect(text).toContain('unknown');
    expect(text).toContain('cannot be read as a quiet corridor');
  });
});

describe('depotCorridorLabel', () => {
  it('marks a loop', () => {
    expect(depotCorridorLabel({ routeId: '1348', directionCode: 'OUT', isLoop: false })).toBe('1348 · OUT');
    expect(depotCorridorLabel({ routeId: '1348', directionCode: 'OUT', isLoop: true })).toBe('1348 · OUT (loop)');
  });
});
