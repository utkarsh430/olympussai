import { describe, expect, it } from 'vitest';
import type { DepotBusView } from '@/lib/depot/api';
import { modelDuties } from '@/lib/depot/sim/duties';
import { modelBus } from '@/lib/depot/sim/fleetMaster';
import { modelOperatingDay, modelRouteLength } from '@/lib/depot/sim/operatingDay';
import { TYPICAL_ROUTE_LENGTH_KM } from '@/lib/depot/sim/operatingDayConfig';
import type { OperatingDay } from '@/lib/depot/sim/operatingDayTypes';
import type { ServiceClass } from '@/lib/depot/sim/types';
import type { BusOpState, DepotSummary } from '@/lib/depot/types';

const DAY = '2026-10-06';
const DEPOT = { id: '7', name: 'Kaushambi', kind: 'depot', fleet: 0 } as unknown as DepotSummary;

function bus(registrationNumber: string, state: BusOpState, routeName: string | null): DepotBusView {
  return { registrationNumber, state, routeName } as unknown as DepotBusView;
}

function day(
  buses: readonly DepotBusView[],
  peakRequirement: number,
  real: Readonly<Record<string, number>> = {},
  operatingDate: string = DAY,
  depot: DepotSummary = DEPOT,
): OperatingDay {
  return modelOperatingDay({
    depot,
    buses,
    peakRequirement,
    realLengthKm: new Map(Object.entries(real)),
    operatingDate,
  });
}

const tenths = (km: number): number => Math.round(km * 10);
const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

/*
 * The worked depot. Six buses: five available, one off the road. Two routes
 * are reported, both with a real profile:
 *   AGRA_EXP_1   100.04 km one way -> out and back 200.08 -> 200.1 km (2,001 tenths)
 *   KANPUR_ORD_2  80.5  km one way -> out and back 161.0 km         (1,610 tenths)
 * The peak requirement is 4, so there are 4 duties dealt round-robin in name
 * order: AGRA, KANPUR, AGRA, KANPUR = 2 duties on each route.
 * Five buses are available, so the first 4 in the day's order run and 1 does not;
 * the off-road bus does not run either: 4 ran, 2 did not.
 *   service km: AGRA 2 x 200.1 = 400.2; KANPUR 2 x 161.0 = 322.0; day 722.2 km.
 */
const WORKED: readonly DepotBusView[] = [
  bus('UP14A1', 'on_road', 'AGRA_EXP_1'),
  bus('UP14A2', 'standing', 'AGRA_EXP_1'),
  bus('UP14A3', 'in_service', 'KANPUR_ORD_2'),
  bus('UP14A4', 'standing', 'KANPUR_ORD_2'),
  bus('UP14A5', 'standing', null),
  bus('UP14A6', 'off_road', 'KANPUR_ORD_2'),
];
const WORKED_REAL = { AGRA_EXP_1: 100.04, KANPUR_ORD_2: 80.5 };

describe('modelOperatingDay, the worked depot', () => {
  const worked = day(WORKED, 4, WORKED_REAL);

  it('has the modelled duties, one trip each, and one bus per duty', () => {
    const routes = [...new Set(WORKED.flatMap((b) => (b.routeName ? [b.routeName] : [])))];
    const expected = modelDuties(
      DEPOT,
      routes.map((routeName) => ({ routeName, scheduledDurationMin: null })),
      4,
      DAY,
    );
    expect(worked.duties).toEqual(expected.duties);
    expect(worked.runs).toHaveLength(4);
    expect(worked.dutiesWithoutBus).toBe(0);
    expect(worked.fleet).toBe(6);
    expect(worked.availableBuses).toBe(5);
    expect(new Set(worked.runs.map((r) => r.registrationNumber)).size).toBe(4);
    expect(worked.notRun).toHaveLength(2);
    expect(worked.notRun).toContainEqual({ registrationNumber: 'UP14A6', reason: 'unavailable' });
    expect(worked.notRun.filter((b) => b.reason === 'no_duty')).toHaveLength(1);
  });

  it('gives each route its duties as trips and its real length out and back', () => {
    expect(worked.routes).toEqual([
      expect.objectContaining({
        routeName: 'AGRA_EXP_1',
        serviceClass: 'express',
        lengthKm: 100.04,
        lengthProvenance: 'derived',
        roundTripTenths: 2001,
        duties: 2,
        trips: 2,
        serviceKm: 400.2,
      }),
      expect.objectContaining({
        routeName: 'KANPUR_ORD_2',
        serviceClass: 'ordinary',
        lengthKm: 80.5,
        lengthProvenance: 'derived',
        roundTripTenths: 1610,
        duties: 2,
        trips: 2,
        serviceKm: 322,
      }),
    ]);
  });

  it('gives a bus that ran its route out and back, 722.2 km in all', () => {
    for (const run of worked.runs) {
      expect(run.distanceKm).toBe(run.routeName === 'AGRA_EXP_1' ? 200.1 : 161);
    }
    expect(sum(worked.runs.map((r) => tenths(r.distanceKm)))).toBe(7222);
    expect(sum(worked.routes.map((r) => tenths(r.serviceKm)))).toBe(7222);
  });

  it('states the shortfall when fewer buses are available than duties', () => {
    // 4 duties, 2 available buses: 2 ran, 2 duties have no bus, nobody is spare.
    const short = day(WORKED.slice(0, 2), 4, WORKED_REAL);
    expect(short.duties).toHaveLength(4);
    expect(short.runs).toHaveLength(2);
    expect(short.dutiesWithoutBus).toBe(2);
    expect(sum(short.routes.map((r) => r.trips))).toBe(2);
    expect(short.notRun).toEqual([]);
  });

  it('is empty, with every bus not run, when no bus reports a route', () => {
    const none = day([bus('X1', 'standing', null), bus('X2', 'dark', null)], 5);
    expect(none.duties).toEqual([]);
    expect(none.routes).toEqual([]);
    expect(none.runs).toEqual([]);
    expect(none.dutiesWithoutBus).toBe(0);
    expect(none.notRun.map((b) => b.reason)).toEqual(['no_duty', 'unavailable']);
  });
});

describe('modelRouteLength', () => {
  it('uses a real length as DERIVED and a seeded class figure as MODELLED otherwise', () => {
    expect(modelRouteLength('AGRA_EXP_1', 'express', 88.25)).toEqual({
      lengthKm: 88.25,
      lengthProvenance: 'derived',
    });
    for (const bad of [undefined, 0, -3, Number.NaN, Number.POSITIVE_INFINITY, 5000]) {
      const modelled = modelRouteLength('AGRA_EXP_1', 'express', bad);
      expect(modelled.lengthProvenance).toBe('modelled');
      expect(modelled).toEqual(modelRouteLength('AGRA_EXP_1', 'express', undefined));
    }
  });

  it('stays inside the class range, whole kilometres, for many routes', () => {
    const classes: readonly ServiceClass[] = ['ordinary', 'express', 'ac', 'premium'];
    for (let i = 0; i < 400; i += 1) {
      const serviceClass = classes[i % 4] as ServiceClass;
      const { lengthKm } = modelRouteLength(`ROUTE_${i}`, serviceClass, undefined);
      const range = TYPICAL_ROUTE_LENGTH_KM[serviceClass];
      expect(lengthKm).toBeGreaterThanOrEqual(range.from);
      expect(lengthKm).toBeLessThanOrEqual(range.to);
      expect(Number.isInteger(lengthKm)).toBe(true);
    }
  });
});

const STATES: readonly BusOpState[] = ['in_service', 'on_road', 'standing', 'dark', 'off_road'];
const ROUTES: readonly (string | null)[] = ['A_EXP_1', 'B_ORD_2', 'C_AC_3', 'D_VOLVO_4', 'E_5', null];

/** A seeded-looking but fully deterministic depot: sizes, states and routes vary with `n`. */
function depotOf(n: number): { buses: DepotBusView[]; peak: number; depot: DepotSummary } {
  const size = (n * 7) % 60;
  const buses = Array.from({ length: size }, (_, i) =>
    bus(`UP${n}Z${i}`, STATES[(i * 3 + n) % 5] as BusOpState, ROUTES[(i + n) % (2 + (n % 5))] ?? null),
  );
  return { buses, peak: (n * 11) % 45, depot: { ...DEPOT, id: `d${n}` } };
}

describe('modelOperatingDay over many depots and dates', () => {
  const cases = Array.from({ length: 120 }, (_, n) => ({
    ...depotOf(n),
    date: `2026-10-${String(1 + (n % 28)).padStart(2, '0')}`,
  }));

  it('reconciles duties, trips, buses that ran and distance', () => {
    for (const c of cases) {
      const d = day(c.buses, c.peak, { A_EXP_1: 61.37 }, c.date, c.depot);
      const available = c.buses.filter((b) => b.state !== 'off_road' && b.state !== 'dark');
      expect(d.availableBuses).toBe(available.length);
      expect(d.runs).toHaveLength(Math.min(d.duties.length, available.length));
      expect(d.dutiesWithoutBus).toBe(d.duties.length - d.runs.length);
      expect(sum(d.routes.map((r) => r.duties))).toBe(d.duties.length);
      expect(sum(d.routes.map((r) => r.trips))).toBe(d.runs.length);
      expect(d.runs.length + d.notRun.length).toBe(c.buses.length);
      expect(sum(d.runs.map((r) => tenths(r.distanceKm)))).toBe(
        sum(d.routes.map((r) => tenths(r.serviceKm))),
      );
      const ran = new Set(d.runs.map((r) => r.registrationNumber));
      expect(ran.size).toBe(d.runs.length);
      for (const reg of ran) expect(available.some((b) => b.registrationNumber === reg)).toBe(true);
      expect(new Set(d.runs.map((r) => r.dutyId)).size).toBe(d.runs.length);
    }
  });

  it('matches class wherever the buses that ran allow it', () => {
    let matchedSomewhere = 0;
    for (const c of cases) {
      const d = day(c.buses, c.peak, {}, c.date, c.depot);
      const classes: readonly ServiceClass[] = ['ordinary', 'express', 'ac', 'premium'];
      for (const serviceClass of classes) {
        const ofDuties = d.duties.filter((x) => x.serviceClass === serviceClass).length;
        const ofRunners = d.runs.filter((r) => r.busClass === serviceClass).length;
        const matched = d.runs.filter((r) => r.classMatched && r.busClass === serviceClass).length;
        expect(matched).toBe(Math.min(ofDuties, ofRunners));
        matchedSomewhere += matched;
      }
      for (const run of d.runs) {
        const view = c.buses.find((b) => b.registrationNumber === run.registrationNumber);
        expect(run.busClass).toBe(modelBus(run.registrationNumber, view?.routeName ?? null).serviceClass);
      }
    }
    expect(matchedSomewhere).toBeGreaterThan(100);
  });

  it('is deterministic, ignores input order, and changes who ran with the date', () => {
    const { buses, peak, depot } = depotOf(37);
    const a = day(buses, peak, {}, DAY, depot);
    expect(day([...buses].reverse(), peak, {}, DAY, depot)).toEqual(a);
    const b = day(buses, peak, {}, '2026-10-07', depot);
    expect(b.runs.map((r) => r.registrationNumber)).not.toEqual(a.runs.map((r) => r.registrationNumber));
    expect(b.routes.map((r) => r.lengthKm)).toEqual(a.routes.map((r) => r.lengthKm));
  });
});

describe('class matching considers every available bus', () => {
  it('never leaves a duty on a bus of another class while an idle bus of its class stands by', () => {
    let mismatches = 0;
    for (let n = 0; n < 160; n += 1) {
      const { buses, peak, depot } = depotOf(n);
      const date = `2026-10-${String(1 + (n % 28)).padStart(2, '0')}`;
      const d = day(buses, peak, {}, date, depot);
      const idleClasses = new Set(
        d.notRun
          .filter((idle) => idle.reason === 'no_duty')
          .map((idle) => {
            const view = buses.find((b) => b.registrationNumber === idle.registrationNumber);
            return modelBus(idle.registrationNumber, view?.routeName ?? null).serviceClass;
          }),
      );
      for (const run of d.runs) {
        if (!run.classMatched && idleClasses.has(run.dutyClass)) mismatches += 1;
      }
    }
    expect(mismatches).toBe(0);
  });

  it('gives the one AC duty the AC bus even when it comes last in the day order', () => {
    // Nine ordinary buses and one AC bus on an AC route, requirement 1: whatever the seeded
    // order, an AC duty takes the AC bus and the ordinary buses stand idle.
    const buses = [
      ...Array.from({ length: 9 }, (_, i) => bus(`UP70O${i}`, 'standing', 'KANPUR_ORD_2')),
      bus('UP70AC1', 'standing', 'LUCKNOW_AC_9'),
    ];
    for (const date of ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05']) {
      const d = day(buses, 1, {}, date, DEPOT);
      for (const run of d.runs.filter((r) => r.dutyClass === 'ac')) {
        expect(run.registrationNumber).toBe('UP70AC1');
      }
    }
  });
});
