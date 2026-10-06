// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { activeHoursOf, routeHourFigures, unroutedCoverGuard } from '@/lib/depot/service/gap';
import { busesNeeded } from '@/lib/depot/service/need';
import type {
  ModelledRouteHour,
  NeedInputs,
  ObservedDepotHour,
  ObservedRouteHour,
  RouteHourDemand,
  ScheduledRouteHour,
} from '@/lib/depot/service/types';

const DATE = '2026-10-06';
const need: NeedInputs = {
  routeName: 'R1',
  serviceClass: 'ordinary',
  seatsPerBus: 52,
  journeyMinutes: 105,
  journeyMinutesProvenance: 'derived',
  layoverMinutes: 15,
  targetLoad: 0.75,
  busiestStretchShare: 0.6,
};
const states = { inService: 0, onRoad: 0, standing: 0, offRoad: 0, dark: 0 };

function observed(hour: number, deployedMean: number, slotsObserved = 12): ObservedRouteHour {
  return {
    routeName: 'R1',
    operatingDate: DATE,
    hour,
    slotsObserved,
    deployedMean,
    deployedMax: Math.ceil(deployedMean),
    inServiceMean: deployedMean,
    states,
    delayMedianMin: 6,
    lateShare: 0.25,
    delayCoverage: { n: 4, of: 5 },
    operators: { D1: deployedMean },
  };
}
const modelled = (hour: number, deployed: number): ModelledRouteHour => ({
  routeName: 'R1',
  operatingDate: DATE,
  hour,
  deployed,
});
const demand: RouteHourDemand[] = Array.from({ length: 24 }, (_, hour) => ({
  routeName: 'R1',
  operatingDate: DATE,
  hour,
  boardings: hour >= 6 && hour <= 21 ? 260 : 0,
  band: { low: 0, high: 0 },
  provenance: 'modelled',
  basis: 'x',
}));
const scheduled = (hour: number, busHours: number): ScheduledRouteHour => ({
  routeName: 'R1',
  operatingDate: DATE,
  hour,
  tripsStarting: 2,
  busHours,
  coverage: { n: 3, of: 9 },
  fromFeedRowsOnly: true,
});

const base = {
  observed: [observed(7, 5.25), observed(8, 3, 4)],
  modelled: Array.from({ length: 24 }, (_, h) => modelled(h, h >= 6 && h <= 21 ? 6 : 0)),
  current: null,
  scheduled: [scheduled(7, 4.5)],
  demand,
  need,
};

describe('routeHourFigures', () => {
  const hours = routeHourFigures(base);

  it('answers 24 hours with need from the formula and the gap as needed minus deployed', () => {
    expect(hours).toHaveLength(24);
    expect(hours[10]?.needed).toBe(busesNeeded(260, need));
    expect(hours[10]?.gap).toBe((hours[10]?.needed ?? 0) - 6);
    expect(hours[2]?.needed).toBe(0);
  });

  it('takes an observed hour over the modelled one, with its delay figures', () => {
    expect(hours[7]).toMatchObject({
      deployed: 5.3,
      deployedBasis: 'observed',
      slotsObserved: 12,
      delayMedianMin: 6,
      lateShare: 0.25,
      delayCoverage: { n: 4, of: 5 },
    });
  });

  it('treats an hour with too few slots as not observed', () => {
    expect(hours[8]).toMatchObject({ deployed: 6, deployedBasis: 'modelled', slotsObserved: 4 });
    expect(hours[8]?.delayMedianMin).toBeNull();
    expect(hours[8]?.delayCoverage).toEqual({ n: 0, of: 0 });
  });

  it('uses the live figure for the feed clock hour', () => {
    const current = { hour: 7, deployed: 9, delayMedianMin: 3, lateShare: 0, delayCoverage: { n: 2, of: 9 } };
    const live = routeHourFigures({ ...base, current });
    expect(live[7]).toMatchObject({ deployed: 9, deployedBasis: 'current', delayMedianMin: 3 });
    expect(live[7]?.slotsObserved).toBe(12);
  });

  it('shows scheduled supply where known and null where not', () => {
    expect(hours[7]).toMatchObject({ scheduled: 4.5, scheduledTripsStarting: 2 });
    expect(hours[9]?.scheduled).toBeNull();
    expect(hours[9]?.scheduledTripsStarting).toBeNull();
  });

  it('counts zero deployed for an hour neither observed nor modelled', () => {
    const bare = routeHourFigures({ ...base, observed: [], modelled: [] });
    expect(bare[10]).toMatchObject({ deployed: 0, deployedBasis: 'modelled' });
  });
});

describe('activeHoursOf', () => {
  it('marks every hour any layer deployed a bus in', () => {
    const active = activeHoursOf(
      [observed(4, 1)],
      [modelled(6, 2), modelled(7, 0)],
      { hour: 23, deployed: 1, delayMedianMin: null, lateShare: null, delayCoverage: { n: 0, of: 0 } },
    );
    expect(active).toEqual([4, 6, 23]);
  });
});

describe('unroutedCoverGuard', () => {
  const depotHour = (unroutedOnRoadMean: number): ObservedDepotHour => ({
    depotId: 'D1',
    operatingDate: DATE,
    hour: 9,
    slotsObserved: 12,
    standingInYardMean: 4,
    unroutedOnRoadMean,
  });

  it('holds when the depot has as many unrouted buses on the road as the gap', () => {
    expect(unroutedCoverGuard(3, depotHour(3))).toBe(true);
    expect(unroutedCoverGuard(3, depotHour(2.9))).toBe(false);
  });

  it('never holds without a gap or without an observed depot hour', () => {
    expect(unroutedCoverGuard(0, depotHour(10))).toBe(false);
    expect(unroutedCoverGuard(-2, depotHour(10))).toBe(false);
    expect(unroutedCoverGuard(3, null)).toBe(false);
  });
});
