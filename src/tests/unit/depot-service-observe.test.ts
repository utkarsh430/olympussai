// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { loadFleetFixture } from '@/lib/upsrtc/fleetFixture';
import { normalizeDepotRows } from '@/lib/upsrtc/depotNormalizer';
import type { DepotBusRow } from '@/models/depotLive';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';
import { analyseSnapshot, resetAnalysisForTests } from '@/lib/depot/live/analysis';
import {
  depotHourFromSlots,
  hourFromSlots,
  observedHourCount,
  slotOf,
  slotSampleOf,
} from '@/lib/depot/service/observe';
import type { RouteSlotSample, SlotSample } from '@/lib/depot/service/types';

const rows = normalizeDepotRows(loadFleetFixture()).rows;
const FEED_NOW = '2026-10-06T08:00:00.000Z';
const ROUTE = 'VND_1613_ORD_OUT';

function viewOf(r: readonly DepotBusRow[], feedNow: string | null): FleetSnapshotView {
  return {
    rows: r,
    feedNow,
    fetchedAt: '2026-10-06T02:30:00.000Z',
    source: 'live',
    stale: false,
    recordCount: r.length,
  };
}

describe('slotOf', () => {
  it('reads the date and the 5-minute slot off the feed digits, with no conversion', () => {
    expect(slotOf('2026-10-06T08:07:59.000Z')).toEqual({ operatingDate: '2026-10-06', slot: 97 });
    expect(slotOf('2026-10-06T23:59:00Z')).toEqual({ operatingDate: '2026-10-06', slot: 287 });
  });

  it('puts midnight in slot 0 of its own date', () => {
    expect(slotOf('2026-10-07T00:00:00.000Z')).toEqual({ operatingDate: '2026-10-07', slot: 0 });
    expect(slotOf('2026-10-07T00:04:59.999Z')).toEqual({ operatingDate: '2026-10-07', slot: 0 });
  });

  it('gives null for no feed clock or one that does not parse', () => {
    expect(slotOf(null)).toBeNull();
    expect(slotOf('')).toBeNull();
    expect(slotOf('not a time')).toBeNull();
    expect(slotOf('2026-13-40T08:00:00Z')).toBeNull();
    expect(slotOf('2026-10-06T25:00:00Z')).toBeNull();
  });
});

describe('slotSampleOf on the recorded sample', () => {
  beforeEach(() => resetAnalysisForTests());

  const sampleOf = (): SlotSample => {
    const view = viewOf(rows, FEED_NOW);
    const sample = slotSampleOf(view, analyseSnapshot(view));
    if (sample === null) throw new Error('no sample');
    return sample;
  };

  it('stamps the slot and counts the rows', () => {
    const sample = sampleOf();
    expect(sample).toMatchObject({ operatingDate: '2026-10-06', slot: 96, feedNow: FEED_NOW });
    expect(sample.totalRows).toBe(rows.length);
    expect(sample.routedRows).toBe(rows.filter((r) => r.routeName).length);
  });

  it("counts a known route's buses, states and operators by depot", () => {
    const route = sampleOf().routes.find((r) => r.routeName === ROUTE);
    const members = rows.filter((r) => r.routeName === ROUTE);
    expect(route?.buses).toBe(members.length);
    expect(route?.buses).toBe(21);
    const operators: Record<string, number> = {};
    for (const m of members) if (m.depotId) operators[m.depotId] = (operators[m.depotId] ?? 0) + 1;
    expect(route?.operators).toEqual(operators);
    const s = route!.states;
    expect(s.inService + s.onRoad + s.standing + s.dark + s.offRoad).toBe(21);
    expect(route!.delayCovered).toBeLessThanOrEqual(21);
    expect(route!.late).toBeLessThanOrEqual(route!.delayCovered);
  });

  it('holds only routes that carry buses', () => {
    const sample = sampleOf();
    expect(sample.routes.every((r) => r.buses > 0)).toBe(true);
    expect(sample.routes.find((r) => r.routeName === 'NO_SUCH_ROUTE')).toBeUndefined();
    expect(new Set(sample.routes.map((r) => r.routeName)).size).toBe(sample.routes.length);
  });

  it("counts a depot's standing buses inside its own yard and its unrouted buses on the road", () => {
    const view = viewOf(rows, FEED_NOW);
    const analysis = analyseSnapshot(view);
    const sample = slotSampleOf(view, analysis)!;
    const withYard = sample.depots.filter((d) => analysis.yards.has(d.depotId));
    expect(withYard.length).toBeGreaterThan(0);
    for (const depot of withYard) {
      const own = rows.filter((r) => r.depotId === depot.depotId);
      const standing = own.filter(
        (r) => analysis.stateOf(r) === 'standing' && analysis.locate(r).location === 'in_yard',
      ).length;
      const unrouted = own.filter(
        (r) =>
          (analysis.stateOf(r) === 'on_road' || analysis.stateOf(r) === 'in_service') &&
          (r.routeName === null || r.routeName.trim() === ''),
      ).length;
      expect(depot.standingInYard).toBe(standing);
      expect(depot.unroutedOnRoad).toBe(unrouted);
      expect(depot.fleet).toBe(analysis.depotsById.get(depot.depotId)?.fleet);
    }
    expect(withYard.some((d) => (d.standingInYard ?? 0) > 0)).toBe(true);
    for (const depot of sample.depots.filter((d) => !analysis.yards.has(d.depotId))) {
      expect(depot.standingInYard).toBeNull();
    }
  });

  it('gives null without a feed clock', () => {
    const view = viewOf(rows, null);
    expect(slotSampleOf(view, analyseSnapshot(view))).toBeNull();
  });
});

const ZERO = { inService: 0, onRoad: 0, standing: 0, dark: 0, offRoad: 0 };

function routeSample(partial: Partial<RouteSlotSample>): RouteSlotSample {
  return {
    routeName: 'R1',
    buses: 0,
    states: ZERO,
    delayMedianMin: null,
    late: 0,
    delayCovered: 0,
    operators: {},
    ...partial,
  };
}

function slotSample(slot: number, routes: readonly RouteSlotSample[]): SlotSample {
  const hh = String(Math.floor((slot * 5) / 60)).padStart(2, '0');
  const mm = String((slot * 5) % 60).padStart(2, '0');
  return {
    operatingDate: '2026-10-06',
    slot,
    feedNow: `2026-10-06T${hh}:${mm}:00.000Z`,
    totalRows: 100,
    routedRows: 20,
    routes,
    depots: [
      { depotId: 'D1', fleet: 50, states: ZERO, standingInYard: slot % 2, unroutedOnRoad: 3 },
    ],
  };
}

/** Seven slots of hour 8 (slots 96 to 102): 2, 3, 4, 5, 6, 0 (absent) and 1 deployed buses. */
function hourEight(): SlotSample[] {
  const deployed = [2, 3, 4, 5, 6, 0, 1];
  return deployed.map((n, i) =>
    slotSample(
      96 + i,
      n === 0
        ? []
        : [
            routeSample({
              buses: n + 1,
              states: { inService: n - 1, onRoad: 1, standing: 0, dark: 1, offRoad: 0 },
              delayMedianMin: n,
              late: 1,
              delayCovered: 2,
              operators: { D1: n, D2: 1 },
            }),
          ],
    ),
  );
}

describe('hourFromSlots', () => {
  it('takes means and the max over the seven slots observed, a missing route counting zero', () => {
    const hour = hourFromSlots('R1', '2026-10-06', 8, hourEight());
    expect(hour).not.toBeNull();
    expect(hour).toMatchObject({ routeName: 'R1', operatingDate: '2026-10-06', hour: 8 });
    expect(hour!.slotsObserved).toBe(7);
    expect(hour!.deployedMean).toBeCloseTo(21 / 7, 2);
    expect(hour!.deployedMax).toBe(6);
    expect(hour!.inServiceMean).toBeCloseTo(15 / 7, 2);
    expect(hour!.states.dark).toBeCloseTo(6 / 7, 2);
    expect(hour!.operators.D1).toBeCloseTo(21 / 7, 2);
    expect(hour!.operators.D2).toBeCloseTo(6 / 7, 2);
    expect(hour!.delayMedianMin).toBeCloseTo((2 + 3 + 4 + 5 + 6 + 1) / 6, 1);
  });

  it('gives the late share and delay coverage over the bus-slots', () => {
    const hour = hourFromSlots('R1', '2026-10-06', 8, hourEight())!;
    expect(hour.lateShare).toBeCloseTo(6 / 12, 4);
    expect(hour.delayCoverage).toEqual({ n: 12, of: 27 });
  });

  it('ignores slots of another hour or date', () => {
    const slots = [...hourEight(), slotSample(108, [routeSample({ buses: 9 })])];
    const other = { ...slotSample(97, [routeSample({ buses: 9 })]), operatingDate: '2026-10-05' };
    const hour = hourFromSlots('R1', '2026-10-06', 8, [...slots, other])!;
    expect(hour.slotsObserved).toBe(7);
    expect(hour.deployedMax).toBe(6);
  });

  it('is not an observed hour with fewer than six slots', () => {
    expect(hourFromSlots('R1', '2026-10-06', 8, hourEight().slice(0, 5))).toBeNull();
    expect(hourFromSlots('R1', '2026-10-06', 8, hourEight().slice(0, 6))).not.toBeNull();
  });

  it('has no delay figure when no bus carried one', () => {
    const slots = hourEight().map((s) => ({
      ...s,
      routes: s.routes.map((r) => ({ ...r, delayMedianMin: null, late: 0, delayCovered: 0 })),
    }));
    const hour = hourFromSlots('R1', '2026-10-06', 8, slots)!;
    expect(hour.delayMedianMin).toBeNull();
    expect(hour.lateShare).toBeNull();
    expect(hour.delayCoverage).toEqual({ n: 0, of: 27 });
  });
});

describe('depotHourFromSlots and observedHourCount', () => {
  it("means a depot's standing pool and unrouted buses over the hour", () => {
    const hour = depotHourFromSlots('D1', '2026-10-06', 8, hourEight());
    expect(hour).toEqual({
      depotId: 'D1',
      operatingDate: '2026-10-06',
      hour: 8,
      slotsObserved: 7,
      standingInYardMean: expect.closeTo(3 / 7, 2),
      unroutedOnRoadMean: 3,
    });
    expect(depotHourFromSlots('D1', '2026-10-06', 8, hourEight().slice(0, 5))).toBeNull();
  });

  it('has a null standing pool when the depot had no yard in any slot', () => {
    const slots = hourEight().map((s) => ({
      ...s,
      depots: s.depots.map((d) => ({ ...d, standingInYard: null })),
    }));
    expect(depotHourFromSlots('D1', '2026-10-06', 8, slots)?.standingInYardMean).toBeNull();
  });

  it('counts the hours with enough slots', () => {
    const nine = [0, 1, 2, 3, 4].map((i) => slotSample(108 + i, []));
    expect(observedHourCount('2026-10-06', [...hourEight(), ...nine])).toBe(1);
    expect(observedHourCount('2026-10-06', [...hourEight(), ...nine, slotSample(113, [])])).toBe(2);
  });
});
