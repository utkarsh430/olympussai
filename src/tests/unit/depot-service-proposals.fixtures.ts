import type { ProposalContext } from '@/lib/depot/service/proposals';
import type {
  HourBasis,
  LedgerJourney,
  NeedInputs,
  ObservedDepotHour,
  RouteHourFigures,
} from '@/lib/depot/service/types';

export const DATE = '2026-10-06';

export const NEED: NeedInputs = {
  routeName: 'R1',
  serviceClass: 'ordinary',
  seatsPerBus: 52,
  journeyMinutes: 105,
  journeyMinutesProvenance: 'derived',
  layoverMinutes: 15,
  targetLoad: 0.75,
  busiestStretchShare: 0.6,
};

/** One hour; demand is set so the impact model sees the same shortfall the gap states. */
export function hour(
  h: number,
  deployed: number,
  needed: number,
  over: Partial<RouteHourFigures> = {},
): RouteHourFigures {
  return {
    hour: h,
    deployed,
    deployedBasis: 'observed' as HourBasis,
    slotsObserved: 12,
    scheduled: null,
    scheduledTripsStarting: null,
    demand: needed * 32.5,
    demandBand: { low: 0, high: 0 },
    needed,
    gap: needed - deployed,
    delayMedianMin: null,
    lateShare: null,
    delayCoverage: { n: 0, of: 0 },
    ...over,
  };
}

/** 24 hours: deployed and needed per hour from the two maps, 6 and 6 otherwise. */
export function day(
  deployed: Readonly<Record<number, number>>,
  needed: Readonly<Record<number, number>>,
  over: Partial<RouteHourFigures> = {},
): RouteHourFigures[] {
  return Array.from({ length: 24 }, (_, h) => hour(h, deployed[h] ?? 6, needed[h] ?? 6, over));
}

export function depotHour(h: number, over: Partial<ObservedDepotHour> = {}): ObservedDepotHour {
  return {
    depotId: 'D1',
    operatingDate: DATE,
    hour: h,
    slotsObserved: 12,
    standingInYardMean: 7.4,
    unroutedOnRoadMean: 0,
    ...over,
  };
}

export function journey(id: string, over: Partial<LedgerJourney> = {}): LedgerJourney {
  return {
    operatingDate: DATE,
    journeyId: id,
    routeName: 'R1',
    registrationNumber: `UP32AB${id}`,
    scheduledStart: '07:00',
    scheduledEnd: '08:45',
    actualStart: '07:02',
    delayMinutes: 2,
    lastSeen: '07:30',
    ...over,
  };
}

export function context(over: Partial<ProposalContext> = {}): ProposalContext {
  return {
    routeName: 'R1',
    operatingDate: DATE,
    feedMinute: 12 * 60,
    hours: day({}, {}),
    need: NEED,
    ledger: [],
    depot: { depotId: 'D1', depotName: 'Charbagh' },
    depotHours: [],
    modelledIdleBuses: null,
    lengthKm: 40,
    deadKmPerTrip: null,
    ...over,
  };
}
