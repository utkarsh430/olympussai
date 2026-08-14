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

function meta(
  overrides: Partial<RouteDirectionMeta> & Pick<RouteDirectionMeta, 'routeDirectionId'>,
): RouteDirectionMeta {
  return {
    routeId: '1348',
    directionCode: 'OUT',
    isLoop: false,
    totalDistanceMeters: 42_000,
    ...overrides,
  };
}

function corridor(
  overrides: Partial<DepotCorridor> & Pick<DepotCorridor, 'routeDirectionId'>,
): DepotCorridor {
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
      [
        meta({ routeDirectionId: 'rd-a' }),
        meta({ routeDirectionId: 'rd-b', routeId: '999' }),
        meta({ routeDirectionId: 'rd-unrelated', routeId: '111' }),
      ],
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
    const reversed = deriveDepotCorridors(
      [...routeDirections].reverse(),
      [...states].reverse(),
    ).map((c) => c.routeDirectionId);

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
  const corridors = [
    corridor({ routeDirectionId: 'rd-busy', depotVehicleCount: 5 }),
    corridor({ routeDirectionId: 'rd-quiet' }),
  ];

  it('honours a requested corridor the depot is running', () => {
    expect(selectDepotCorridor(corridors, 'rd-quiet')?.routeDirectionId).toBe('rd-quiet');
  });

  it('falls back to the busiest corridor rather than showing an empty board for a stale bookmark', () => {
    expect(selectDepotCorridor(corridors, 'rd-some-other-depots-road')?.routeDirectionId).toBe(
      'rd-busy',
    );
    expect(selectDepotCorridor(corridors, undefined)?.routeDirectionId).toBe('rd-busy');
    expect(selectDepotCorridor(corridors, null)?.routeDirectionId).toBe('rd-busy');
  });

  it('returns null when the depot is on no mapped corridor at all', () => {
    expect(selectDepotCorridor([], 'rd-busy')).toBeNull();
  });

  /**
   * THE DEFECT: the depot opened every shift on a screen that could report
   * nothing.
   *
   * 561 of the 759 surveyed corridors have no planned gap, so the busiest
   * corridor a depot is on is very often one that can never report a bus
   * closing up. KAUSHAMBI's was, and the live console therefore opened with
   * its whole panel replaced by a paragraph explaining why it was empty. The
   * first thing a new operator saw was an apology.
   */
  describe('which corridor the console opens on', () => {
    it('opens on the busiest corridor that can actually report something', () => {
      const mixed = [
        corridor({
          routeDirectionId: 'rd-busy-blind',
          depotVehicleCount: 9,
          hasActivePolicy: false,
        }),
        corridor({
          routeDirectionId: 'rd-quieter-seeing',
          depotVehicleCount: 4,
          hasActivePolicy: true,
        }),
        corridor({
          routeDirectionId: 'rd-quietest-seeing',
          depotVehicleCount: 1,
          hasActivePolicy: true,
        }),
      ];

      expect(selectDepotCorridor(mixed, undefined)?.routeDirectionId).toBe('rd-quieter-seeing');
    });

    it('still opens on the busiest corridor when NONE of them can report', () => {
      // The depot must keep its running order, its roster and its map. Showing
      // nothing at all would be the same lie by omission — the panels say in
      // words why they are blank, and that is the honest version.
      const allBlind = [
        corridor({ routeDirectionId: 'rd-busy', depotVehicleCount: 9, hasActivePolicy: false }),
        corridor({ routeDirectionId: 'rd-quiet', depotVehicleCount: 2, hasActivePolicy: false }),
      ];

      expect(selectDepotCorridor(allBlind, undefined)?.routeDirectionId).toBe('rd-busy');
    });

    it('does not prefer a corridor whose ability to report is merely UNKNOWN', () => {
      // Preferring it would be treating "the control service did not say" as
      // "yes", which is the exact substitution this product exists to refuse.
      const unknownVsKnown = [
        corridor({
          routeDirectionId: 'rd-unknown',
          depotVehicleCount: 9,
          hasActivePolicy: undefined,
        }),
        corridor({ routeDirectionId: 'rd-known', depotVehicleCount: 3, hasActivePolicy: true }),
      ];

      expect(selectDepotCorridor(unknownVsKnown, undefined)?.routeDirectionId).toBe('rd-known');
    });

    it('never overrides a corridor the operator actually asked for', () => {
      // The preference decides only the DEFAULT. An operator who picked a
      // watch-only corridor is entitled to sit on it, and a screen that
      // bounced them back to another one would be unusable.
      const mixed = [
        corridor({ routeDirectionId: 'rd-seeing', depotVehicleCount: 4, hasActivePolicy: true }),
        corridor({ routeDirectionId: 'rd-blind', depotVehicleCount: 9, hasActivePolicy: false }),
      ];

      expect(selectDepotCorridor(mixed, 'rd-blind')?.routeDirectionId).toBe('rd-blind');
    });
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
  it('says an all-watch-only depot will never see a bus reported closing up, in words', () => {
    const sentence = describeDepotDetectionCoverage(
      { running: 3, detecting: 0, observationOnly: 3, unknown: 0 },
      'Bareilly',
    );

    // The failure this exists to prevent: a permanently empty panel read as a
    // quiet night.
    expect(sentence).toContain('watch-only');
    expect(sentence).toContain('not a quiet night');
    expect(sentence).not.toMatch(/\b0 of\b/);
  });

  it('names both halves when a depot has a mix', () => {
    const sentence = describeDepotDetectionCoverage(
      { running: 10, detecting: 4, observationOnly: 6, unknown: 0 },
      'Bareilly',
    );

    expect(sentence).toContain('4 of the 10 corridors');
    expect(sentence).toContain('The other 6 corridors');
    expect(sentence).toContain('watch-only');
  });

  it('keeps the second half grammatical when exactly one corridor is watch-only', () => {
    // A count baked into a sentence is a count that can read as broken English
    // the one time it is 1. These readers are largely reading English as a
    // second language, and "The other 1 corridor are surveyed" is the kind of
    // sentence that makes a screen look untrustworthy.
    const sentence = describeDepotDetectionCoverage(
      { running: 2, detecting: 1, observationOnly: 1, unknown: 0 },
      'Bareilly',
    );

    expect(sentence).toContain('The other one is surveyed but has no planned gap set');
    expect(sentence).not.toContain('The other 1 corridor');
  });

  it('reports an unknown planned gap as unknown rather than as no', () => {
    const sentence = describeDepotDetectionCoverage(
      { running: 5, detecting: 2, observationOnly: 1, unknown: 2 },
      'Bareilly',
    );

    expect(sentence).toContain('does not say whether 2 of them have a planned gap');
    expect(sentence).toContain('unknown, not no');
  });

  it('distinguishes "this depot is on no surveyed corridor" from "this depot is quiet"', () => {
    const sentence = describeDepotDetectionCoverage(
      { running: 0, detecting: 0, observationOnly: 0, unknown: 0 },
      'Bareilly',
    );

    expect(sentence).toContain('gap in the survey');
    expect(sentence).toContain('not a quiet depot');
  });

  it('does not hedge a depot whose corridors can all be checked', () => {
    const sentence = describeDepotDetectionCoverage(
      { running: 2, detecting: 2, observationOnly: 0, unknown: 0 },
      'Bareilly',
    );

    expect(sentence).toBe(
      'All 2 corridors Bareilly is on have a planned gap set, so buses closing up can be reported on every one of them.',
    );
  });
});

describe('describeCorridorObservationOnly', () => {
  it('stays silent for a corridor that can actually detect', () => {
    expect(
      describeCorridorObservationOnly(corridor({ routeDirectionId: 'a', hasActivePolicy: true })),
    ).toBeNull();
  });

  it('blames the corridor’s own settings, not the connection, when it cannot be checked', () => {
    const text = describeCorridorObservationOnly(
      corridor({
        routeDirectionId: 'a',
        hasActivePolicy: false,
        routeId: '1348',
        directionCode: 'OUT',
      }),
    );

    expect(text).toContain('1348 · OUT');
    expect(text).toContain('no planned gap has been set for it');
    expect(text).toContain('not a failure to reach it');
  });

  it('says unknown, not no, when the service reports no policy state', () => {
    const text = describeCorridorObservationOnly(
      corridor({ routeDirectionId: 'a', hasActivePolicy: undefined }),
    );

    expect(text).toContain('unknown');
    expect(text).toContain('cannot be read as a quiet corridor');
  });
});

describe('depotCorridorLabel', () => {
  it('marks a loop', () => {
    expect(depotCorridorLabel({ routeId: '1348', directionCode: 'OUT', isLoop: false })).toBe(
      '1348 · OUT',
    );
    expect(depotCorridorLabel({ routeId: '1348', directionCode: 'OUT', isLoop: true })).toBe(
      '1348 · OUT (loop)',
    );
  });
});
