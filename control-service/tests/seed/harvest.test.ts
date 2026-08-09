import { describe, expect, it } from 'vitest';
import {
  harvestNetwork,
  isReversedStopOrder,
  planProbes,
  scheduledTimeToSeconds,
  stripDirectionSuffix,
  directionSuffix,
  type NetworkSeed,
  type SeedRouteDirection,
} from '../../src/seed/harvest.js';
import { liveFeed, probe } from './fixtures.js';

function direction(seed: NetworkSeed, routeId: string, code: string): SeedRouteDirection {
  const route = seed.routes.find((candidate) => candidate.id === routeId);
  if (!route) throw new Error(`route ${routeId} not in seed (have ${seed.routes.map((r) => r.id).join(',')})`);
  const found = route.directions.find((candidate) => candidate.directionCode === code);
  if (!found) {
    throw new Error(
      `direction ${code} not on route ${routeId} (have ${route.directions.map((d) => d.directionCode).join(',')})`,
    );
  }
  return found;
}

describe('planProbes', () => {
  const plan = planProbes(liveFeed);

  it('seeds every vehicle in the feed, not just the live ones', () => {
    // vehicle_states.vehicle_id and commands.vehicle_id both FK vehicles(id),
    // and an Offline bus goes Live later in the day.
    expect(plan.vehicles.map((vehicle) => vehicle.id)).toEqual([
      'UP11AA1001',
      'UP11AA1002',
      'UP11AA1003',
      'UP11AA1004',
      'UP11AA1005',
    ]);
    expect(plan.vehicles.find((v) => v.id === 'UP11AA1004')).toMatchObject({
      depotName: 'GAMMA',
      vehicleType: 'ORDINARY',
    });
  });

  it('probes the lexicographically smallest registration per route, for reproducibility', () => {
    // UP11AA1002 appears first in the payload; UP11AA1001 must still win.
    expect(plan.probes).toEqual([
      { routeName: 'AAA_100_ORD_OUT', registrationNumber: 'UP11AA1001' },
      { routeName: 'BBB_200_ORD', registrationNumber: 'UP11AA1003' },
    ]);
  });

  it('never probes an offline vehicle or one with no routename', () => {
    const probed = new Set(plan.probes.map((target) => target.registrationNumber));
    expect(probed.has('UP11AA1004')).toBe(false); // Offline
    expect(probed.has('UP11AA1005')).toBe(false); // Live, but no routename
  });
});

describe('direction derivation', () => {
  it('(a) reads _OUT / _IN straight off RouteName', () => {
    const seed = harvestNetwork(liveFeed, [probe('schedule-suffixed-pair')]);
    const codes = seed.routes.find((route) => route.id === '635')!.directions.map((d) => d.directionCode);
    expect(codes).toEqual(['IN', 'OUT']);
    // Declared directions are not "derived" — nothing to audit.
    expect(seed.report.derivedDirections).toHaveLength(0);
  });

  it('treats _ORD / _JRT / _VPL as service classes, not directions', () => {
    expect(directionSuffix('BBK_2264_ORD')).toBeNull();
    expect(directionSuffix('CBG_142_JRT')).toBeNull();
    expect(directionSuffix('ALM_11_VPL')).toBeNull();
    expect(directionSuffix('BRH_949_ORD_OUT')).toBe('OUT');
    expect(directionSuffix('CHL_585_ORD_IN')).toBe('IN');
    expect(stripDirectionSuffix('BRH_949_ORD_OUT')).toBe('BRH_949_ORD');
  });

  it('(b) derives OUT then IN by start time when the stop order is genuinely reversed', () => {
    const seed = harvestNetwork(liveFeed, [probe('schedule-derived-pair')]);
    const route = seed.routes.find((candidate) => candidate.id === '400')!;
    expect(route.directions.map((d) => d.directionCode).sort()).toEqual(['IN', 'OUT']);

    const out = direction(seed, '400', 'OUT');
    const inbound = direction(seed, '400', 'IN');
    expect(out.stops.map((s) => s.stopId)).toEqual(['701', '702', '703']);
    expect(inbound.stops.map((s) => s.stopId)).toEqual(['703', '702', '701']);

    expect(seed.report.derivedDirections.map((entry) => entry.basis)).toEqual([
      'derived_from_start_time_order',
      'derived_from_start_time_order',
    ]);
  });

  it('(b) does NOT invent an inbound direction when two journeys run the same way round', () => {
    // Real ALM_11_VPL: journeys at 07:01 and 13:30 with identical stop
    // sequences. Labelling the later one 'IN' would persist two identical
    // LineStrings that then compete for the same GPS fix in map-matching.
    const seed = harvestNetwork(liveFeed, [probe('schedule-same-direction-repeat')]);
    const route = seed.routes.find((candidate) => candidate.id === '7762')!;
    expect(route.directions.map((d) => d.directionCode)).toEqual(['SINGLE']);
    expect(new Set(seed.report.derivedDirections.map((e) => e.basis))).toEqual(
      new Set(['single_direction_repeat']),
    );
  });

  it('(c) a lone unsuffixed journey is SINGLE', () => {
    const seed = harvestNetwork(liveFeed, [probe('schedule-missing-coords')]);
    expect(direction(seed, '600', 'SINGLE')).toBeDefined();
    expect(seed.report.derivedDirections.some((e) => e.basis === 'single_journey')).toBe(true);
  });

  it('isReversedStopOrder distinguishes an out-and-back from a repeat and ignores closed loops', () => {
    expect(isReversedStopOrder(['a', 'b', 'c'], ['c', 'b', 'a'])).toBe(true);
    expect(isReversedStopOrder(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(false);
    expect(isReversedStopOrder(['a', 'b', 'a'], ['a', 'b', 'a'])).toBe(false);
    expect(isReversedStopOrder(['a'], ['a'])).toBe(false);
  });
});

describe('journey splitting', () => {
  it('splits on a decreasing stop_sequence when vj_id is a sentinel', () => {
    // Both journeys are the same 3 stops in the same order, so they collapse
    // into one direction — but they must be seen as TWO journeys, or the
    // sequence would run 1,2,3,1,2,3 and the shape would double back.
    const seed = harvestNetwork(liveFeed, [probe('schedule-sentinel-journeys')]);
    expect(seed.report.journeysHarvested).toBe(2);
    const single = direction(seed, '500', 'OUT');
    expect(single.stops.map((s) => s.stopId)).toEqual(['801', '802', '803']);
    expect(single.journeyIds).toHaveLength(2);
  });

  it('keeps every journey of a multi-journey vehicle-day as its own route', () => {
    const seed = harvestNetwork(liveFeed, [probe('schedule-missing-coords')]);
    // One vehicle-day response, two distinct line_ids -> two routes.
    expect(seed.routes.map((route) => route.id).sort()).toEqual(['600', '601']);
  });
});

describe('coordinate handling', () => {
  const seed = harvestNetwork(liveFeed, [probe('schedule-missing-coords')]);

  it('recovers a 0/0 stop from another route via the global second pass', () => {
    // Stop 902 is 0/0 on line 600 and surveyed on line 601.
    const line600 = direction(seed, '600', 'SINGLE');
    expect(line600.stops.map((s) => s.stopId)).toContain('902');
    expect(seed.report.recoveredStops).toContainEqual({
      routeId: '600',
      directionCode: 'SINGLE',
      stopId: '902',
      sourceRouteId: '601',
    });
    expect(seed.stops.find((stop) => stop.id === '902')).toMatchObject({ lat: 26.9, lon: 80.95 });
  });

  it('drops a stop with no coordinate anywhere and re-sequences the survivors densely from 0', () => {
    const line600 = direction(seed, '600', 'SINGLE');
    expect(line600.stops.map((s) => s.stopId)).not.toContain('999');
    expect(line600.stops.map((s) => s.sequence)).toEqual([0, 1, 2]);
    expect(seed.report.droppedStops).toContainEqual(
      expect.objectContaining({ stopId: '999', reason: 'no_coordinate_anywhere' }),
    );
  });

  it('only emits stops that a surviving direction actually references', () => {
    expect(seed.stops.map((stop) => stop.id).sort()).toEqual(['901', '902', '903', '904']);
  });

  it('prunes a mis-surveyed interior coordinate instead of accepting a phantom spur', () => {
    const outlier = harvestNetwork(liveFeed, [probe('schedule-outlier')]);
    const built = direction(outlier, '900', 'OUT');
    expect(built.stops.map((s) => s.stopId)).toEqual(['1201', '1202', '1204', '1205']);
    expect(outlier.report.droppedStops).toContainEqual(
      expect.objectContaining({ stopId: '1203', reason: 'coordinate_outlier' }),
    );
    // ~21 km of real corridor, not the ~230 km the bad point would have added.
    expect(built.totalDistanceMeters).toBeLessThan(40_000);
  });

  it('keeps the outlier when pruning is switched off, proving the flag is live', () => {
    const unpruned = harvestNetwork(liveFeed, [probe('schedule-outlier')], {
      maxStopDetourMeters: 0,
    });
    const built = direction(unpruned, '900', 'OUT');
    expect(built.stops.map((s) => s.stopId)).toContain('1203');
    expect(built.totalDistanceMeters).toBeGreaterThan(200_000);
  });
});

describe('loop routes', () => {
  const seed = harvestNetwork(liveFeed, [probe('schedule-loop')]);

  it('keeps the first visit, drops the repeat, and flags the direction as a loop', () => {
    // A repeated atco_code in one direction violates
    // unique (route_direction_id, stop_id).
    const loop = direction(seed, '700', 'OUT');
    expect(loop.stops.map((s) => s.stopId)).toEqual(['701', '702', '703']);
    expect(loop.isLoop).toBe(true);
    expect(seed.report.loopDirections).toContainEqual({
      routeId: '700',
      directionCode: 'OUT',
      repeatedStopIds: ['701'],
    });
    expect(seed.report.droppedStops).toContainEqual(
      expect.objectContaining({ stopId: '701', reason: 'duplicate_stop_in_direction' }),
    );
  });
});

describe('geometry rejection', () => {
  const seed = harvestNetwork(liveFeed, [probe('schedule-bad-geometry')]);

  it('rejects a direction left with a single usable vertex', () => {
    expect(seed.routes.some((route) => route.id === '800')).toBe(false);
    expect(seed.report.skippedRoutes).toContainEqual(
      expect.objectContaining({ routeId: '800', reason: 'too_few_stops' }),
    );
  });

  it('rejects a direction with an implausible single leg', () => {
    expect(seed.routes.some((route) => route.id === '801')).toBe(false);
    expect(seed.report.skippedRoutes).toContainEqual(
      expect.objectContaining({ routeId: '801', reason: 'leg_distance_exceeds_limit' }),
    );
  });

  it('rejects the whole direction rather than persisting a partial shape', () => {
    expect(seed.routes).toHaveLength(0);
    expect(seed.stops).toHaveLength(0);
  });
});

describe('"Bus Not Assigned"', () => {
  it('records the skip and keeps going instead of aborting the run', () => {
    const seed = harvestNetwork(liveFeed, [
      probe('schedule-unassigned', { registrationNumber: 'UP11AA9999', routeName: 'ZZZ_1_ORD_OUT' }),
      probe('schedule-suffixed-pair'),
    ]);
    expect(seed.report.probesUnassigned).toBe(1);
    expect(seed.report.probesWithSchedule).toBe(1);
    expect(seed.report.skippedRoutes).toContainEqual(
      expect.objectContaining({ registrationNumber: 'UP11AA9999', reason: 'schedule_unassigned' }),
    );
    // The good probe still produced a route.
    expect(seed.routes.some((route) => route.id === '635')).toBe(true);
  });

  it('records a transport failure separately from an unassigned vehicle', () => {
    const seed = harvestNetwork(liveFeed, [
      probe('schedule-unassigned', { payload: null, error: 'Upstream timed out after 45000ms' }),
    ]);
    expect(seed.report.probesFailed).toBe(1);
    expect(seed.report.probesUnassigned).toBe(0);
    expect(seed.report.skippedRoutes[0]).toMatchObject({ reason: 'schedule_fetch_failed' });
  });
});

describe('policy, control points and rollout stage', () => {
  it('derives the target headway from the journey-start span', () => {
    const seed = harvestNetwork(liveFeed, [probe('schedule-same-direction-repeat')]);
    // 07:01:00 -> 13:30:00 is 23,340s over one gap.
    expect(direction(seed, '7762', 'SINGLE').policy.targetHeadwaySeconds).toBe(23_340);
  });

  it('falls back to the configured default when there is only one journey', () => {
    const seed = harvestNetwork(liveFeed, [probe('schedule-loop')], {
      defaultHeadwaySeconds: 900,
    });
    expect(direction(seed, '700', 'OUT').policy.targetHeadwaySeconds).toBe(900);
  });

  it('always writes kf / kb / self_equalizing_k', () => {
    // Both are nullable with no column default, and src/mpc/twoWayHold.ts
    // returns [] when kf or kb is null — silently degrading to self-equalizing.
    const seed = harvestNetwork(liveFeed, [probe('schedule-suffixed-pair')]);
    for (const route of seed.routes) {
      for (const built of route.directions) {
        expect(built.policy.kf).toBe(0.4);
        expect(built.policy.kb).toBe(0.2);
        expect(built.policy.selfEqualizingK).toBe(0.35);
      }
    }
  });

  it('honours overridden gains and rollout stage', () => {
    const seed = harvestNetwork(liveFeed, [probe('schedule-suffixed-pair')], {
      gains: { kf: 1, kb: 2, selfEqualizingK: 3 },
      rolloutStage: 'advisory',
    });
    const built = direction(seed, '635', 'OUT');
    expect(built.policy).toMatchObject({ kf: 1, kb: 2, selfEqualizingK: 3 });
    expect(built.rolloutStage).toBe('advisory');
  });

  it('defaults the rollout stage to observation (fail closed)', () => {
    const seed = harvestNetwork(liveFeed, [probe('schedule-suffixed-pair')]);
    expect(direction(seed, '635', 'OUT').rolloutStage).toBe('observation');
  });

  it('always produces sequence 0, and marks first / last / every 5th as a control point', () => {
    const seed = harvestNetwork(liveFeed, [probe('schedule-suffixed-pair')]);
    const built = direction(seed, '635', 'OUT');
    expect(built.stops[0]!.sequence).toBe(0);
    // stateStore.getTerminalStopId keys off sequence 0; without it Algorithm A
    // (terminal dispatch) can never fire.
    expect(built.stops[0]!.isControlPoint).toBe(true);
    expect(built.stops[built.stops.length - 1]!.isControlPoint).toBe(true);
    const controlSequences = built.stops.filter((s) => s.isControlPoint).map((s) => s.sequence);
    expect(controlSequences).toContain(5);
    for (const stop of built.stops) expect(stop.holdSuitable).toBe(stop.isControlPoint);
  });

  it('makes cumulative distance monotonic, zero-based and terminating at the total', () => {
    const seed = harvestNetwork(liveFeed, [probe('schedule-suffixed-pair')]);
    const built = direction(seed, '635', 'OUT');
    const cumulative = built.stops.map((s) => s.cumulativeDistanceMeters);
    expect(cumulative[0]).toBe(0);
    for (let index = 1; index < cumulative.length; index += 1) {
      expect(cumulative[index]!).toBeGreaterThanOrEqual(cumulative[index - 1]!);
    }
    expect(cumulative[cumulative.length - 1]).toBeCloseTo(built.totalDistanceMeters, 6);
  });
});

describe('route identity', () => {
  it('keys routes on line_id so a line’s two directions land on one route', () => {
    const seed = harvestNetwork(liveFeed, [probe('schedule-suffixed-pair')]);
    expect(seed.routes).toHaveLength(1);
    expect(seed.routes[0]!.id).toBe('635');
    expect(seed.routes[0]!.directions).toHaveLength(2);
  });

  it('merges the same line operated from two depots instead of duplicating it', () => {
    // Measured upstream fact: BBK_828_ORD_OUT and BRH_828_ORD_OUT are both
    // line_id 828 with identical stop lists — the prefix is the operating
    // depot. Keying on routename would create two routes for one road.
    const rows = [
      {
        vj_id: 1,
        atco_code: 11238,
        stop_sequence: 1,
        stop_name: 'BAHRAICH',
        RouteName: 'BBK_828_ORD_OUT',
        line_id: 828,
        scheduled_time: '04:15:00',
        Latitude: 27.56875,
        Longitude: 81.5878,
      },
      {
        vj_id: 1,
        atco_code: 13938,
        stop_sequence: 2,
        stop_name: 'KAISERBAGH',
        RouteName: 'BBK_828_ORD_OUT',
        line_id: 828,
        scheduled_time: '08:15:00',
        Latitude: 26.85286,
        Longitude: 80.92769,
      },
    ];
    // A separate departure two hours later, run out of the other depot.
    const mirrored = rows.map((row) => ({
      ...row,
      vj_id: 2,
      RouteName: 'BRH_828_ORD_OUT',
      scheduled_time: row.stop_sequence === 1 ? '06:15:00' : '10:15:00',
    }));
    const seed = harvestNetwork(liveFeed, [
      probe('schedule-unassigned', { payload: rows }),
      probe('schedule-unassigned', { payload: mirrored }),
    ]);
    expect(seed.routes).toHaveLength(1);
    expect(seed.routes[0]!.id).toBe('828');
    expect(seed.routes[0]!.directions).toHaveLength(1);
    expect(seed.routes[0]!.directions[0]!.sourceRouteNames).toEqual([
      'BBK_828_ORD_OUT',
      'BRH_828_ORD_OUT',
    ]);
    // Two depots running one line is a genuine headway pair: 04:15 -> 06:15.
    expect(seed.routes[0]!.directions[0]!.policy.targetHeadwaySeconds).toBe(7200);
  });

  it('collapses one working published twice, so H* is not halved', () => {
    // MEASURED: line 2086 publishes vj 7283 at 17:00:00 and vj 54457 at
    // 17:01:00 with identical stop sequences; line 2058 re-publishes its three
    // daily departures a minute or two later. Counted naively that turns a
    // 5-hour headway into 7,236s and a lone evening departure into a 60-second
    // one — and every threshold in src/headway/ is a ratio of H*.
    const journey = (vjId: number, startTime: string, secondTime: string) => [
      {
        vj_id: vjId,
        atco_code: 5001,
        stop_sequence: 1,
        stop_name: 'D1',
        RouteName: 'DUP_2058_ORD_OUT',
        line_id: 2058,
        scheduled_time: startTime,
        Latitude: 26.8,
        Longitude: 80.9,
      },
      {
        vj_id: vjId,
        atco_code: 5002,
        stop_sequence: 2,
        stop_name: 'D2',
        RouteName: 'DUP_2058_ORD_OUT',
        line_id: 2058,
        scheduled_time: secondTime,
        Latitude: 26.9,
        Longitude: 81.0,
      },
    ];
    const payload = [
      ...journey(7092, '08:30:00', '10:49:00'),
      ...journey(7093, '13:30:00', '15:48:00'),
      ...journey(52795, '08:31:00', '10:50:00'), // re-publication of 7092
      ...journey(52796, '13:31:00', '15:49:00'), // re-publication of 7093
    ];
    const seed = harvestNetwork(liveFeed, [probe('schedule-unassigned', { payload })]);
    const built = direction(seed, '2058', 'OUT');
    // 08:30 -> 13:30 over one real gap, not four apparent ones.
    expect(built.policy.targetHeadwaySeconds).toBe(18_000);
    expect(built.journeyIds).toEqual(['7092', '7093']);
    expect(seed.report.duplicateJourneys).toEqual([
      { routeId: '2058', directionCode: 'OUT', droppedJourneyIds: ['52795', '52796'] },
    ]);
  });

  it('keeps two departures far enough apart to be a real headway pair', () => {
    const seed = harvestNetwork(liveFeed, [probe('schedule-same-direction-repeat')]);
    // 07:01 and 13:30 over the same stops — same road, genuinely two workings.
    expect(seed.report.duplicateJourneys).toEqual([]);
    expect(direction(seed, '7762', 'SINGLE').journeyIds).toHaveLength(2);
  });

  it('prefers route_description as the public name', () => {
    const seed = harvestNetwork(liveFeed, [probe('schedule-loop')]);
    expect(seed.routes[0]!.publicName).toBe('H CIRCULAR');
  });
});

describe('determinism', () => {
  const probes = [
    probe('schedule-suffixed-pair', { registrationNumber: 'UP11AA0001' }),
    probe('schedule-missing-coords', { registrationNumber: 'UP11AA0002' }),
    probe('schedule-loop', { registrationNumber: 'UP11AA0003' }),
    probe('schedule-derived-pair', { registrationNumber: 'UP11AA0004' }),
  ];

  it('re-running over the same payloads produces an identical seed', () => {
    const first = harvestNetwork(liveFeed, probes);
    const second = harvestNetwork(liveFeed, probes);
    expect(JSON.stringify(second)).toEqual(JSON.stringify(first));
  });

  it('is independent of the order probe responses arrive in', () => {
    // Probes run concurrently, so completion order varies run to run; the seed
    // must not.
    const first = harvestNetwork(liveFeed, probes);
    const shuffled = harvestNetwork(liveFeed, [...probes].reverse());
    expect(JSON.stringify(shuffled.routes)).toEqual(JSON.stringify(first.routes));
    expect(JSON.stringify(shuffled.stops)).toEqual(JSON.stringify(first.stops));
  });
});

describe('scheduledTimeToSeconds', () => {
  it('parses upstream wall-clock times and rejects junk', () => {
    expect(scheduledTimeToSeconds('06:00:00')).toBe(21_600);
    expect(scheduledTimeToSeconds('13:30')).toBe(48_600);
    expect(scheduledTimeToSeconds(null)).toBeNull();
    expect(scheduledTimeToSeconds('')).toBeNull();
    expect(scheduledTimeToSeconds('not a time')).toBeNull();
    expect(scheduledTimeToSeconds('06:99:00')).toBeNull();
  });
});
