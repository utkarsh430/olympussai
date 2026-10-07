import type {
  HourBasis,
  HourReliability,
  Proposal,
  RouteHourFigures,
  RouteHourlyResponse,
} from '@/lib/depot/service/types';

/*
 * One plausible route's day for the "service by the hour" tests: observed from 05:00 to
 * 10:00, the current hour 11:00 (part observed), modelled from 12:00; scheduled trips known
 * for 12 of the 40 buses seen; a modelled demand curve with a morning and an evening peak;
 * and three proposals (add from an observed yard, hold, revise the running time).
 */

const OPERATING_DATE = '2026-10-06';
const ROUTE = 'KANPUR-LUCKNOW';
const CURRENT_HOUR = 11;

const DEMAND = [
  10, 5, 5, 10, 40, 120, 260, 420, 520, 480, 330, 280, 260, 270, 300, 380, 470, 560, 520, 400,
  260, 160, 80, 30,
] as const;
const NEEDED = [0, 0, 0, 1, 2, 4, 7, 11, 13, 12, 9, 8, 6, 6, 7, 10, 12, 14, 13, 10, 7, 5, 2, 1];
const DEPLOYED = [0, 0, 0, 1, 2, 5, 7, 8, 9, 9, 9, 10, 8, 8, 8, 9, 9, 9, 9, 8, 7, 5, 3, 1];
const SCHEDULED: readonly (number | null)[] = [
  null, null, null, null, 1, 2.5, 4, 5.5, 6, 6, 5, 4.5, 4, 4, 4.5, 5, 5.5, 6, 6, 5, 4, 3, 1.5,
  null,
];
/** Median delay and late share for the hours observed, 05:00 to 11:00. */
const DELAY: Readonly<Record<number, readonly [number, number, number]>> = {
  5: [2.5, 0.1, 3],
  6: [3, 0.15, 4],
  7: [6.5, 0.4, 5],
  8: [8, 0.5, 5],
  9: [7, 0.45, 5],
  10: [4, 0.2, 4],
  11: [3.5, 0.18, 4],
};
const BAND_SHARE = 0.25;

function basisOf(hour: number): HourBasis {
  if (hour === CURRENT_HOUR) return 'current';
  return hour >= 5 && hour < CURRENT_HOUR ? 'observed' : 'modelled';
}

function slotsOf(basis: HourBasis): number {
  if (basis === 'observed') return 12;
  return basis === 'current' ? 7 : 0;
}

function hourFigures(hour: number): RouteHourFigures {
  const demand = DEMAND[hour] ?? 0;
  const needed = NEEDED[hour] ?? 0;
  const deployed = DEPLOYED[hour] ?? 0;
  const basis = basisOf(hour);
  const delay = DELAY[hour];
  const scheduled = SCHEDULED[hour] ?? null;
  return {
    hour,
    deployed,
    deployedBasis: basis,
    slotsObserved: slotsOf(basis),
    scheduled,
    scheduledTripsStarting: scheduled === null ? null : Math.round(scheduled),
    demand,
    demandBand: {
      low: Math.round(demand * (1 - BAND_SHARE)),
      high: Math.round(demand * (1 + BAND_SHARE)),
    },
    needed,
    gap: needed - deployed,
    delayMedianMin: delay?.[0] ?? null,
    lateShare: delay?.[1] ?? null,
    delayCoverage: { n: delay?.[2] ?? 0, of: delay ? deployed : 0 },
  };
}

const IMPACT = {
  passengersPerDay: { low: 180, high: 320 },
  revenuePerDay: { low: 9400, high: 16800 },
  busKmPerDay: { low: 420, high: 510 },
  costPerDay: { low: 15100, high: 18300 },
  provenance: 'modelled',
} as const;

const PROPOSALS: readonly Proposal[] = [
  {
    id: 'p-add-07-10',
    kind: 'add_buses',
    routeName: ROUTE,
    operatingDate: OPERATING_DATE,
    band: { fromHour: 7, toHour: 10 },
    deployed: 8.8,
    scheduled: 5.6,
    needed: 11.8,
    change: 3,
    source: { depotId: 'dep-alambagh', depotName: 'Alambagh', standingInYard: 6, basis: 'observed' },
    tier: 'B',
    maybeCoveredByUnrouted: false,
    reason:
      'From 07:00 to 11:00 the route ran 8.8 buses against 11.8 needed; Alambagh had 6 standing in its yard in the hour before.',
    impact: IMPACT,
  },
  {
    id: 'p-hold-12-14',
    kind: 'hold_buses',
    routeName: ROUTE,
    operatingDate: OPERATING_DATE,
    band: { fromHour: 12, toHour: 14 },
    deployed: 8,
    scheduled: 4.2,
    needed: 6.3,
    change: -2,
    source: { depotId: 'dep-alambagh', depotName: 'Alambagh', standingInYard: null, basis: 'modelled' },
    tier: 'C',
    maybeCoveredByUnrouted: false,
    reason: 'From 12:00 to 15:00 the modelled day runs 8 buses against 6.3 needed.',
    impact: {
      passengersPerDay: { low: 0, high: 0 },
      revenuePerDay: { low: 0, high: 0 },
      busKmPerDay: { low: -330, high: -270 },
      costPerDay: { low: -11800, high: -9600 },
      provenance: 'modelled',
    },
  },
  {
    id: 'p-run-07-09',
    kind: 'revise_running_time',
    routeName: ROUTE,
    operatingDate: OPERATING_DATE,
    band: { fromHour: 7, toHour: 9 },
    deployed: 8.7,
    scheduled: 5.8,
    needed: 12,
    change: 0,
    source: null,
    tier: 'A',
    maybeCoveredByUnrouted: false,
    reason:
      'From 07:00 to 10:00 the median delay was above 5 min in every hour; the running time may be too short.',
    impact: null,
  },
];

/** Punctuality from the feed's journeys: the observed hours' delays, placed by scheduled start. */
function reliabilityAt(hour: number): HourReliability {
  const delay = DELAY[hour];
  if (delay === undefined) return { hour, delayMedianMin: null, lateShare: null, coverage: { n: 0, of: 0 } };
  const [medianMin, lateShare, covered] = delay;
  return { hour, delayMedianMin: medianMin, lateShare, coverage: { n: covered, of: covered } };
}

/** The 40 buses seen on the route, the first 12 with a recorded day (the scheduled coverage). */
export const FIXTURE_BUSES: readonly string[] = Array.from(
  { length: 40 },
  (_, i) => `UP78AB${String(1000 + i)}`,
);

/** A full response for the route; any field may be replaced. */
export function routeHourlyFixture(
  overrides: Partial<RouteHourlyResponse> = {},
): RouteHourlyResponse {
  return {
    routeName: ROUTE,
    routeDescription: 'Kanpur to Lucknow via Unnao',
    serviceClass: 'ordinary',
    operatingDate: OPERATING_DATE,
    currentHour: CURRENT_HOUR,
    hours: Array.from({ length: 24 }, (_, hour) => hourFigures(hour)),
    need: {
      routeName: ROUTE,
      serviceClass: 'ordinary',
      seatsPerBus: 52,
      journeyMinutes: 110,
      journeyMinutesProvenance: 'derived',
      layoverMinutes: 15,
      targetLoad: 0.85,
      busiestStretchShare: 0.6,
    },
    observed: { since: '2026-10-06T05:02:00Z', hours: 6, samples: 79 },
    scheduledCoverage: { n: 12, of: 40 },
    routeCoverage: { n: 10, of: 14 },
    standingNow: 4,
    proposals: PROPOSALS,
    demandBasis:
      'Seats offered for the day times the modelled load factor of an ordinary service, spread by its hour-of-day shape.',
    reliability: Array.from({ length: 24 }, (_, hour) => reliabilityAt(hour)),
    busesOnRoute: FIXTURE_BUSES,
    busesWithDay: FIXTURE_BUSES.slice(0, 12),
    timetableBorrowedFrom: [],
    feedNow: '2026-10-06T11:24:00Z',
    fetchedAt: '2026-10-06T05:54:10.000Z',
    source: 'live',
    stale: false,
    ...overrides,
  };
}

/** The fixture's proposals, for a test that builds a longer list. */
export const FIXTURE_PROPOSALS = PROPOSALS;
