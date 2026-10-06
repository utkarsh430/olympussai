import { describe, it, expect } from 'vitest';
import { distanceM } from '@/lib/depot/infer/geo';
import { MOVING_SPEED_KMPH } from '@/lib/depot/infer/thresholds';
import {
  inferYard,
  inferYardGroup,
  inferYards,
  YARD_CORE_MIN_NEIGHBOURS,
  YARD_DOMINANCE_RATIO,
  YARD_LINK_M,
  YARD_MAX_SPAN_M,
  YARD_MIN_CLUSTER,
  YARD_MIN_RADIUS_M,
  YARD_MIN_SHARE,
  YARD_RADIUS_PAD_M,
} from '@/lib/depot/infer/yard';
import {
  blob,
  busAt,
  row,
  centreOf,
  far,
  file,
  membersOf,
  ORIGIN,
  regs,
  scattered,
} from './depot-yard.fixtures';

const HERE = { x: 0, y: 0 };

describe('the yard rule', () => {
  // Screens build their sentences from these, so the ruled values are pinned by name.
  it('exports the ruled values', () => {
    expect([YARD_LINK_M, YARD_CORE_MIN_NEIGHBOURS, YARD_MIN_CLUSTER]).toEqual([150, 4, 6]);
    expect([YARD_MIN_SHARE, YARD_DOMINANCE_RATIO, YARD_MAX_SPAN_M]).toEqual([0.25, 1.5, 1500]);
    expect([YARD_MIN_RADIUS_M, YARD_RADIUS_PAD_M]).toEqual([120, 40]);
  });

  it('learns a compact yard where the buses stand, and names every bus in it', () => {
    const rows = blob('A', 10, { x: 400, y: -250 });
    const group = inferYardGroup(rows)!;
    expect(group.members).toEqual(regs(rows));
    expect(group.yard).toMatchObject({ parked: 10, inCluster: 10 });
    const centre = centreOf(group.yard);
    expect(Math.hypot(centre.x - 400, centre.y + 250)).toBeLessThan(20);
    expect(inferYard(rows)).toEqual(group.yard);
  });

  it('claims no yard from five buses standing together, and one from six', () => {
    expect(inferYard(blob('A', 5, HERE))).toBeNull();
    expect(inferYard(blob('A', 6, HERE))).toMatchObject({ inCluster: 6 });
  });

  it('links buses standing within 150 m of each other and no further', () => {
    // Two threes: together six buses each with six in reach, apart nobody has four.
    const threes = (gap: number) => [
      ...file('A', 3, HERE, { x: 1, y: 0 }),
      ...file('B', 3, { x: gap + 2, y: 0 }, { x: 1, y: 0 }),
    ];
    expect(inferYard(threes(146))).toMatchObject({ inCluster: 6 });
    expect(inferYard(threes(151))).toBeNull();
  });

  it('needs a quarter of the parked buses in the yard: 6 of 24 is enough, 6 of 25 is not', () => {
    // The other buses each stand alone, so there is no rival and only the share rule decides.
    const atQuarter = [...blob('A', 6, HERE), ...scattered('N', 18)];
    const underQuarter = [...blob('A', 6, HERE), ...scattered('N', 19)];
    expect(inferYard(atQuarter)).toMatchObject({ parked: 24, inCluster: 6 });
    expect(inferYard(underQuarter)).toBeNull();
  });

  it('takes the share over standing buses with a position, not over every row', () => {
    // Moving and unpositioned buses are not candidates: they must not dilute the quarter.
    const others = [
      ...blob('MOV', 9, { x: 9_000, y: 9_000 }, 20, { speedKmph: 40 }),
      ...Array.from({ length: 9 }, (_, i) =>
        row({ registrationNumber: `UNP${i}`, latitude: null, longitude: null }),
      ),
    ];
    const rows = [...blob('A', 6, HERE), ...scattered('N', 18), ...others];
    expect(inferYard(rows)).toMatchObject({ parked: 24, inCluster: 6 });
  });

  it('makes a bus with exactly three others in reach a core bus', () => {
    // Two hubs 140 m apart, each with two more buses in reach that reach nobody else.
    // Each hub has exactly three others within the link distance; nobody has more.
    const hubs = [busAt('H1', { x: 0, y: 0 }), busAt('H2', { x: 140, y: 0 })];
    const spokes = [
      busAt('P1', { x: -140, y: 0 }),
      busAt('P2', { x: 0, y: 140 }),
      busAt('P3', { x: 280, y: 0 }),
      busAt('P4', { x: 140, y: -140 }),
    ];
    expect(inferYard([...hubs, ...spokes])).toMatchObject({ parked: 6, inCluster: 6 });
    // Without P4 the second hub has two others, is not core, and P3 borders nothing.
    expect(inferYard([...hubs, ...spokes.slice(0, 3)])).toBeNull();
  });

  it.each([
    ['30 km away', far(30)],
    ['400 m away', { x: 400, y: 0 }],
  ])('needs 1.5 times the second stand %s: 9 against 6 is enough, 8 against 6 is not', (_, site) => {
    const enough = [...blob('A', 9, HERE), ...blob('B', 6, site)];
    expect(membersOf(enough)).toEqual(regs(blob('A', 9, HERE)));
    expect(inferYard(enough)).toMatchObject({ parked: 15, inCluster: 9 });
    expect(inferYard([...blob('A', 8, HERE), ...blob('B', 6, site)])).toBeNull();
  });

  it.each([
    ['compact, 30 km away', blob('B', 8, far(30))],
    ['compact, 400 m away', blob('B', 8, { x: 400, y: 0 })],
    ['one bus every 100 m in two files', [
      ...file('B', 4, { x: 3000, y: 0 }, { x: 100, y: 0 }),
      ...file('C', 4, { x: 3000, y: 100 }, { x: 100, y: 0 }),
    ]],
    ['a queue with a bus every 70 m', file('B', 8, { x: 3000, y: 0 }, { x: 70, y: 0 })],
  ])('claims no yard for 8 against an equal stand (%s), and never a midpoint', (_, stand) => {
    expect(membersOf(stand)).toEqual(regs(stand));
    expect(inferYard([...blob('A', 8, HERE), ...stand])).toBeNull();
  });

  it('does not count a single file with a bus every 100 m as a stand at all', () => {
    // Each bus has only itself and its two neighbours within the link distance: no core bus.
    const single = file('B', 8, { x: 3000, y: 0 }, { x: 100, y: 0 });
    expect(inferYard(single)).toBeNull();
    const rows = [...blob('A', 8, HERE), ...single];
    expect(membersOf(rows)).toEqual(regs(blob('A', 8, HERE)));
    expect(inferYard(rows)).toMatchObject({ parked: 16, inCluster: 8 });
  });

  it('accepts a yard 1485 m long and refuses one 1515 m long', () => {
    const intervals = 30;
    const under = file('A', intervals + 1, HERE, { x: 1485 / intervals, y: 0 });
    const over = file('A', intervals + 1, HERE, { x: 1515 / intervals, y: 0 });
    expect(inferYard(under)).toMatchObject({ inCluster: 31 });
    expect(inferYard(over)).toBeNull();
  });

  it('measures the span to the outermost bus, even one that only borders the yard', () => {
    const line = file('A', 29, HERE, { x: 50, y: 0 });
    const inside = [...line, busAt('E', { x: 1400 + 90, y: 0 })];
    const outside = [...line, busAt('E', { x: 1400 + 140, y: 0 })];
    expect(membersOf(inside)).toEqual(regs(inside));
    expect(membersOf(line)).toEqual(regs(line));
    expect(inferYard(outside)).toBeNull();
  });
});

describe('which buses are evidence', () => {
  it('counts a bus at the moving threshold as parked and one above it as moving', () => {
    const five = blob('A', 5, HERE);
    const sixth = (speedKmph: number) => busAt('M', { x: 5, y: 5 }, { speedKmph });
    expect(inferYard([...five, sixth(MOVING_SPEED_KMPH)])).toMatchObject({ parked: 6 });
    expect(inferYard([...five, sixth(MOVING_SPEED_KMPH + 0.1)])).toBeNull();
  });

  it.each([
    ['no latitude', { latitude: null }],
    ['no longitude', { longitude: null }],
    ['(0, 0)', { latitude: 0, longitude: 0 }],
    ['a latitude that is not a number', { latitude: Number.NaN }],
    ['unknown speed', { speedKmph: null }],
  ])('ignores a bus with %s', (_, over) => {
    const unusable = busAt('U', { x: 5, y: 5 }, over);
    expect(inferYard([...blob('A', 5, HERE), unusable])).toBeNull();
    expect(inferYard([...blob('A', 8, HERE), unusable])).toMatchObject({ parked: 8, inCluster: 8 });
  });

  it('never places a yard at (0, 0) however many buses report it', () => {
    const noFix = Array.from({ length: 12 }, (_, i) =>
      busAt(`Z${i}`, HERE, { latitude: 0, longitude: 0 }),
    );
    expect(inferYard(noFix)).toBeNull();
    expect(membersOf([...blob('A', 8, HERE), ...noFix])).toEqual(regs(blob('A', 8, HERE)));
  });

  it('counts dark buses that still carry a position as parked evidence', () => {
    const dark = blob('D', 6, HERE, 20, { vehicleStatus: 'no_signal' });
    expect(inferYard(dark)).toMatchObject({ inCluster: 6 });
  });

  it('returns null for no rows', () => {
    expect(inferYardGroup([])).toBeNull();
  });
});

describe('inferYards', () => {
  it('groups by depot id, skips buses with no home depot, omits depots without a yard', () => {
    const rows = [
      ...blob('A', 8, HERE, 20, { depotId: '1' }),
      ...blob('B', 8, far(20), 20, { depotId: '2' }),
      ...blob('C', 2, far(40), 20, { depotId: '3' }),
      ...blob('U', 12, far(60), 20, { depotId: null }),
    ];
    const yards = inferYards(rows);
    expect([...yards.keys()]).toEqual(['1', '2']);
    expect(yards.get('2')).toEqual(inferYard(blob('B', 8, far(20))));
    expect(Math.abs(centreOf(yards.get('2')!).x - 20_000)).toBeLessThan(20);
  });

  it('gives two depots standing in one yard a yard each, built from their own buses', () => {
    const rows = [
      ...blob('A', 8, HERE, 20, { depotId: '1' }),
      ...blob('B', 12, HERE, 40, { depotId: '2' }),
    ];
    const yards = inferYards(rows);
    expect(yards.get('1')).toMatchObject({ parked: 8, inCluster: 8 });
    expect(yards.get('2')).toMatchObject({ parked: 12, inCluster: 12 });
    const [a, b] = [yards.get('1')!, yards.get('2')!];
    expect(distanceM(a.lat, a.lng, ORIGIN.lat, ORIGIN.lng)).toBeLessThan(20);
    expect(distanceM(b.lat, b.lng, ORIGIN.lat, ORIGIN.lng)).toBeLessThan(40);
  });
});
