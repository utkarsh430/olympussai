import { FIXTURE_PROPOSALS } from './depot-service-fixtures';
import type {
  NetworkBandSummary,
  NetworkHourlyBody,
  NetworkProposal,
  NetworkRouteGap,
  ServiceBandKey,
} from '@/lib/depot/service/types';

/*
 * A network's day by band for the copilot's network facts and the daily brief, built to
 * the `NetworkHourlyBody` contract until the network view fills it: two depots, short and
 * over-served routes in the peaks, the route fixture's proposals spread over both depots.
 */

const gap = (
  routeName: string,
  value: number,
  depotId: string | null,
  observed = true,
): NetworkRouteGap => ({
  routeName,
  depotId,
  depotName: depotId === '101' ? 'KANPUR' : depotId === '102' ? 'ETAWAH' : null,
  gap: value,
  observed,
});

function band(
  key: ServiceBandKey,
  fromHour: number,
  toHour: number,
  shortRoutes: readonly NetworkRouteGap[],
  overRoutes: readonly NetworkRouteGap[],
): NetworkBandSummary {
  const sum = (rs: readonly NetworkRouteGap[]): number =>
    rs.reduce((s, r) => s + Math.abs(r.gap), 0);
  return {
    key,
    band: { fromHour, toHour },
    shortRoutes,
    overRoutes,
    busesShort: sum(shortRoutes),
    busesOver: sum(overRoutes),
  };
}

const BANDS: readonly NetworkBandSummary[] = [
  band('early', 4, 5, [], []),
  band(
    'morning_peak',
    6,
    9,
    [gap('VND_1613_ORD_OUT', 3.4, '101'), gap('LKO_204_EXP_IN', 2, '102'), gap('R_9', 1, '101'), gap('R_10', 1.2, null, false)],
    [gap('R_11', -2, '102')],
  ),
  band('midday', 10, 15, [], [gap('VND_1613_ORD_OUT', -1, '101'), gap('R_12', -1.5, '102')]),
  band('evening_peak', 16, 19, [gap('LKO_204_EXP_IN', 4, '102')], [gap('R_11', -1, '102')]),
  band('late', 20, 23, [], []),
];

const PROPOSALS: readonly NetworkProposal[] = FIXTURE_PROPOSALS.map((p, i) => ({
  ...p,
  routeName: i === 0 ? 'VND_1613_ORD_OUT' : 'LKO_204_EXP_IN',
  depotId: i === 0 ? '101' : '102',
}));

export function networkHoursFixture(overrides: Partial<NetworkHourlyBody> = {}): NetworkHourlyBody {
  return {
    operatingDate: '2026-10-06',
    currentHour: 11,
    observed: { since: '05:02', hours: 6, samples: 79 },
    bands: BANDS,
    proposals: PROPOSALS,
    moves: { withinDepots: 22, betweenDepots: 6 },
    decisions: { accepted: 2, declined: 1, open: 4 },
    ...overrides,
  };
}
