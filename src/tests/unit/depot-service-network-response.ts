import { bandSummaries, routeStrip } from '@/lib/depot/service/networkHours';
import type { NetworkHourlyResponse, NetworkProposal } from '@/lib/depot/service/types';
import { FIXTURE_PROPOSALS } from './depot-service-fixtures';
import { craftedDay } from './depot-service-network-fixtures';

/*
 * One network answer for the page tests: three routes (one short at the morning peak with
 * measured hours, one over, one even), the route fixture's proposals as the short route's
 * own, a reserve, a maintenance window and a corridor, and a band's reallocation with a
 * move each way and one deficit left.
 */

const NEEDED = Array.from({ length: 24 }, (_, h) => (h >= 6 && h <= 9 ? 10 : h >= 4 ? 4 : 0));
const DAYS = [
  craftedDay({ routeName: 'KANPUR-LUCKNOW', depotId: '12', depotName: 'Alambagh', deployed: 6, needed: NEEDED, measured: [6, 7, 8, 9, 10] }),
  craftedDay({ routeName: 'AGRA-MATHURA', depotId: '34', depotName: 'Agra Fort', deployed: 8, needed: 4 }),
  craftedDay({ routeName: 'DELHI-NOIDA', depotId: '34', depotName: 'Agra Fort', deployed: 4, needed: 4 }),
];

const own: NetworkProposal[] = FIXTURE_PROPOSALS.map((p) => ({
  ...p, depotId: '12', depotName: 'Alambagh', routes: [p.routeName],
  group: p.change === 0 ? 'findings' : 'changes', count: null,
}));

const base = { operatingDate: '2026-10-06', scheduled: null, change: 0, source: null, maybeCoveredByUnrouted: false, impact: null, deployed: 12, needed: 14, tier: 'C' } as const;
const network: NetworkProposal[] = [
  { ...base, id: 'p-0000000a', kind: 'reserve_by_hour', routeName: null, depotId: '12', depotName: 'Alambagh', routes: [], group: 'network', count: 2, band: { fromHour: 6, toHour: 9 }, reason: 'Keep 2 buses in reserve at Alambagh through morning peak (06:00–10:00): 8% of its routes’ need of 14 buses.' },
  { ...base, id: 'p-0000000b', kind: 'maintenance_window', routeName: null, depotId: '34', depotName: 'Agra Fort', routes: [], group: 'network', count: 4, band: { fromHour: 10, toHour: 15 }, reason: 'Midday (10:00–16:00): 4 buses of Agra Fort are idle while its need is 40% of its peak, a window for scheduled maintenance.' },
  { ...base, id: 'p-0000000c', kind: 'corridor_under_served', routeName: null, depotId: null, depotName: null, routes: ['KANPUR-LUCKNOW', 'LUCKNOW-KANPUR'], group: 'findings', count: 5, band: { fromHour: 6, toHour: 9 }, reason: 'The 2 routes between Kanpur and Lucknow are short by 5 buses together in morning peak (06:00–10:00).' },
];

export function networkHourlyFixture(over: Partial<NetworkHourlyResponse> = {}): NetworkHourlyResponse {
  const rows = DAYS.map((d) => routeStrip(d, 'morning_peak'));
  return {
    operatingDate: '2026-10-06',
    currentHour: 11,
    band: 'morning_peak',
    nextPeak: 'evening_peak',
    depotId: null,
    depots: [{ depotId: '12', depotName: 'Alambagh' }, { depotId: '34', depotName: 'Agra Fort' }],
    bands: bandSummaries(DAYS),
    routes: { total: rows.length, page: 0, pageSize: 25, rows },
    proposals: [...own, ...network],
    reallocation: {
      band: 'morning_peak',
      moves: [
        { fromDepotId: '12', fromDepotName: 'Alambagh', toDepotId: '12', toDepotName: 'Alambagh', routeName: 'KANPUR-LUCKNOW', buses: 1, withinDepot: true, deadKmPerBus: 0 },
        { fromDepotId: '34', fromDepotName: 'Agra Fort', toDepotId: '12', toDepotName: 'Alambagh', routeName: 'KANPUR-LUCKNOW', buses: 2, withinDepot: false, deadKmPerBus: 28.4 },
      ],
      uncovered: [{ routeName: 'KANPUR-LUCKNOW', depotId: '12', buses: 1, reason: 'insufficient_surplus' }],
      busesWithin: 1,
      busesBetween: 2,
      deadKm: 56.8,
    },
    totals: {
      busesShort: 4, busesOver: 4, movesWithin: 1, movesBetween: 2, uncovered: 1,
      passengersPerDay: { low: 300, high: 500 }, busKmPerDay: { low: 200, high: 340 },
    },
    observed: { since: '2026-10-06T05:02:00Z', hours: 6, samples: 79 },
    routeCoverage: { n: 10, of: 14 },
    demandBasis: 'Modelled from the seats offered and a load factor.',
    feedNow: '2026-10-06T11:24:00Z',
    fetchedAt: '2026-10-06T05:54:10.000Z',
    source: 'live',
    stale: false,
    ...over,
  } as NetworkHourlyResponse;
}
