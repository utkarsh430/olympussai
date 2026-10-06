import { describe, expect, it } from 'vitest';
import type { DepotBusView } from '@/lib/depot/api';
import type { BusLocation } from '@/lib/depot/infer/types';
import { modelOperatingDay } from '@/lib/depot/sim/operatingDay';
import type { OperatingDay, OperatingDayInput } from '@/lib/depot/sim/operatingDayTypes';
import type { BusOpState, DepotSummary } from '@/lib/depot/types';
import { SeededRandom } from '@/lib/simulation/seededRandom';

/*
 * Ruling S47 as properties over seeded random depots: the day keeps the live
 * fleet's working buses running, on their own routes where it can, never runs
 * a bus off the road or dark, and does not depend on the order or repetition
 * of the feed's rows. Every expectation is read off the inputs, never off the
 * function under test.
 */

const STATES: readonly BusOpState[] = ['in_service', 'on_road', 'standing', 'standing', 'dark', 'off_road'];
const LOCATIONS: readonly BusLocation[] = ['in_yard', 'in_yard', 'away'];
const ROUTES = ['A_EXP_1', 'B_ORD_2', 'C_AC_3', 'D_ORD_4'];

function bus(rng: SeededRandom, i: number): DepotBusView {
  return {
    registrationNumber: `UP${i}`,
    state: rng.pick(STATES),
    location: rng.pick(LOCATIONS),
    routeName: rng.bool(0.85) ? rng.pick(ROUTES) : null,
    gpsAgeMin: rng.bool(0.9) ? rng.int(0, 10) : 120,
    notHeardMin: null,
  } as unknown as DepotBusView;
}

function depotCase(n: number): OperatingDayInput {
  const rng = new SeededRandom(`s47-${n}`);
  const size = rng.int(1, 45);
  return {
    depot: { id: `d${n}`, name: `Depot ${n}`, kind: 'depot', fleet: size } as unknown as DepotSummary,
    buses: Array.from({ length: size }, (_, i) => bus(rng, i)),
    peakRequirement: rng.int(0, 50),
    realLengthKm: new Map(),
    operatingDate: `2026-10-${String(1 + (n % 28)).padStart(2, '0')}`,
    feedMinute: rng.int(0, 1439),
  };
}

const CASES = Array.from({ length: 150 }, (_, n) => depotCase(n));
/** Out working AND heard within the reporting window: a bus last heard long ago is not (S55). */
const onTheRoad = (b: DepotBusView): boolean =>
  (b.state === 'in_service' || b.state === 'on_road') && (b.gpsAgeMin ?? Infinity) <= 30;

/**
 * The feed's day has begun once its first duty has started (ruling S62); before
 * that buses are matched as they stand in the yard. The duties do not depend on
 * the matching, so reading the first start off the day is reading an input.
 */
const dayHasBegun = (input: OperatingDayInput, day: OperatingDay): boolean =>
  day.duties.length > 0 &&
  (input.feedMinute ?? -1) >= Math.min(...day.duties.map((d) => d.startMin));

function liveRouteOf(input: OperatingDayInput): Map<string, string | null> {
  return new Map(input.buses.map((b) => [b.registrationNumber, b.routeName]));
}

describe('the modelled day keeps to the live fleet (ruling S47)', () => {
  it('runs every bus in service or on the road, heard recently, whenever the duties are at least those', () => {
    let checked = 0;
    for (const input of CASES) {
      const day = modelOperatingDay(input);
      const working = input.buses.filter(onTheRoad);
      if (!dayHasBegun(input, day) || day.duties.length < working.length) continue;
      checked += 1;
      const ran = new Set(day.runs.map((r) => r.registrationNumber));
      for (const b of working) expect(ran.has(b.registrationNumber)).toBe(true);
    }
    expect(checked).toBeGreaterThan(30);
  });

  it('before the first duty runs the yard buses on the earliest duties, then buses still out (S62b)', () => {
    let checked = 0;
    let withBusesOut = 0;
    for (const input of CASES) {
      const day = modelOperatingDay(input);
      if (day.duties.length === 0 || dayHasBegun(input, day)) continue;
      checked += 1;
      const heard = (b: DepotBusView): boolean => (b.gpsAgeMin ?? Infinity) <= 30;
      const yard = input.buses.filter(
        (b) => b.state === 'standing' && b.location === 'in_yard' && heard(b),
      );
      const yardRegs = new Set(yard.map((b) => b.registrationNumber));
      const out = new Set(input.buses.filter(onTheRoad).map((b) => b.registrationNumber));
      const ran = new Set(day.runs.map((r) => r.registrationNumber));
      for (const reg of ran) expect(yardRegs.has(reg) || out.has(reg)).toBe(true);
      // Every yard bus runs, and on the earliest duties, before a bus still out does.
      const yardRan = day.runs.filter((r) => yardRegs.has(r.registrationNumber));
      expect(yardRan).toHaveLength(Math.min(yard.length, day.duties.length));
      const earliest = new Set(day.duties.slice(0, yardRan.length).map((d) => d.id));
      for (const run of yardRan) expect(earliest.has(run.dutyId)).toBe(true);
      // A bus still out runs whenever a duty is left after the yard's.
      const outRan = day.runs.filter((r) => out.has(r.registrationNumber)).length;
      expect(outRan).toBe(Math.min(out.size, day.duties.length - yardRan.length));
      if (outRan > 0) withBusesOut += 1;
    }
    expect(checked).toBeGreaterThan(5);
    expect(withBusesOut).toBeGreaterThan(0);
  });

  it('runs every bus in service, heard recently, whenever the duties are at least those (S55, N5)', () => {
    let checked = 0;
    for (const input of CASES) {
      const day = modelOperatingDay(input);
      const inService = input.buses.filter((b) => b.state === 'in_service' && onTheRoad(b));
      if (!dayHasBegun(input, day) || day.duties.length < inService.length) continue;
      checked += 1;
      const ran = new Set(day.runs.map((r) => r.registrationNumber));
      for (const b of inService) expect(ran.has(b.registrationNumber)).toBe(true);
    }
    expect(checked).toBeGreaterThan(30);
  });

  it('puts a bus that runs on its live route whenever that route has a free duty', () => {
    for (const input of CASES) {
      const day = modelOperatingDay(input);
      const live = liveRouteOf(input);
      const held = new Map(day.runs.map((r) => [r.dutyId, r.registrationNumber]));
      // Before the first duty the yard buses hold the earliest duties and the buses
      // still out the rest (S62b); the live route ranks below that, within each group.
      const begun = dayHasBegun(input, day);
      const standing = new Set(
        input.buses.filter((b) => b.state === 'standing').map((b) => b.registrationNumber),
      );
      const yardRuns = day.runs.filter((r) => standing.has(r.registrationNumber)).length;
      const earliest = new Set(day.duties.slice(0, yardRuns).map((d) => d.id));
      for (const run of day.runs) {
        const own = live.get(run.registrationNumber) ?? null;
        if (own === null || own === run.routeName) continue;
        const group = (id: string): boolean =>
          begun || earliest.has(id) === standing.has(run.registrationNumber);
        // A duty on its own route that no bus of that route holds would be free for it.
        const free = day.duties.filter((d) => {
          const holder = held.get(d.id);
          return (
            d.routeName === own && group(d.id) && (holder === undefined || live.get(holder) !== own)
          );
        });
        expect(free).toEqual([]);
      }
    }
  });

  it('never runs a bus off the road or dark, and counts every bus once', () => {
    for (const input of CASES) {
      const day = modelOperatingDay(input);
      const barred = new Set(
        input.buses.filter((b) => b.state === 'off_road' || b.state === 'dark').map((b) => b.registrationNumber),
      );
      for (const run of day.runs) expect(barred.has(run.registrationNumber)).toBe(false);
      expect(day.runs.length + day.notRun.length).toBe(input.buses.length);
    }
  });

  it('is unchanged by shuffled or repeated rows, and the same inputs give the same day twice', () => {
    for (const input of CASES.slice(0, 60)) {
      const day: OperatingDay = modelOperatingDay(input);
      expect(modelOperatingDay(input)).toEqual(day);
      const rng = new SeededRandom(`shuffle-${input.depot.id}`);
      const repeated = input.buses.flatMap((b) =>
        rng.bool(0.3) ? [b, { ...b, registrationNumber: `${b.registrationNumber} ` }, b] : [b],
      );
      const shuffled = [...repeated]
        .map((b) => ({ b, key: rng.float(0, 1) }))
        .sort((x, y) => x.key - y.key)
        .map((x) => x.b);
      expect(modelOperatingDay({ ...input, buses: shuffled })).toEqual(day);
    }
  });
});
