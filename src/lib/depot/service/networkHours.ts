import type {
  BandTally,
  DepotBandTally,
  NetworkRouteStrip,
  RouteHourFigures,
  RouteHourlyBody,
  ServiceBand,
  ServiceBandKey,
  ServiceBandSummary,
} from './types';

/*
 * The network's day hour by hour, from every route's own day (`routeDayOf`): per band of
 * the day, the routes short and over and the buses short and over, across the network and
 * per depot; and per route a strip of 24 gaps for the heat map. Pure.
 */

/** A route's day with the depot running most of its buses (its proposals' and tally's depot). */
export interface NetworkRouteDay {
  readonly day: RouteHourlyBody;
  readonly depotId: string | null;
  readonly depotName: string | null;
}

/**
 * The five bands, REFERENCE: early 04–06, morning peak 06–10, midday 10–16, evening peak
 * 16–20, late 20–24 (end exclusive). Hours 00 to 03 carry almost no service and belong to none.
 */
export const SERVICE_BANDS: readonly ServiceBand[] = [
  { key: 'early', label: 'Early', fromHour: 4, toHour: 5 },
  { key: 'morning_peak', label: 'Morning peak', fromHour: 6, toHour: 9 },
  { key: 'midday', label: 'Midday', fromHour: 10, toHour: 15 },
  { key: 'evening_peak', label: 'Evening peak', fromHour: 16, toHour: 19 },
  { key: 'late', label: 'Late', fromHour: 20, toHour: 23 },
];

const BAND_KEYS: ReadonlySet<string> = new Set(SERVICE_BANDS.map((b) => b.key));

export function isServiceBandKey(value: unknown): value is ServiceBandKey {
  return typeof value === 'string' && BAND_KEYS.has(value);
}

export function serviceBand(key: ServiceBandKey): ServiceBand {
  return SERVICE_BANDS.find((b) => b.key === key) as ServiceBand;
}

const MORNING_PEAK_END = serviceBand('morning_peak').toHour;
const EVENING_PEAK_END = serviceBand('evening_peak').toHour;

/** The peak now or next by the feed clock: the morning's until it ends, then the evening's, then tomorrow's morning. */
export function nextPeakBand(currentHour: number | null): ServiceBandKey {
  if (currentHour === null || currentHour <= MORNING_PEAK_END) return 'morning_peak';
  return currentHour <= EVENING_PEAK_END ? 'evening_peak' : 'morning_peak';
}

const TENTHS = 10;
const oneDecimal = (n: number): number => Math.round(n * TENTHS) / TENTHS + 0;

export function bandHours(day: RouteHourlyBody, key: ServiceBandKey): readonly RouteHourFigures[] {
  const band = serviceBand(key);
  return day.hours.filter((h) => h.hour >= band.fromHour && h.hour <= band.toHour);
}

/** The band's mean gap, one decimal; 0 for a band with no hours. */
export function bandGapOf(day: RouteHourlyBody, key: ServiceBandKey): number {
  const hours = bandHours(day, key);
  if (hours.length === 0) return 0;
  return oneDecimal(hours.reduce((s, h) => s + h.gap, 0) / hours.length);
}

/** The route's row of the heat map: 24 gaps, measured or modelled, and the band's peak. */
export function routeStrip(route: NetworkRouteDay, key: ServiceBandKey): NetworkRouteStrip {
  const byHour = new Map(route.day.hours.map((h) => [h.hour, h] as const));
  const hours = Array.from({ length: 24 }, (_, h) => byHour.get(h));
  const peak = bandHours(route.day, key).reduce<RouteHourFigures | null>(
    (best, h) => (h.gap > 0 && (best === null || h.gap > best.gap) ? h : best),
    null,
  );
  return {
    routeName: route.day.routeName,
    depotId: route.depotId,
    depotName: route.depotName,
    gaps: hours.map((h) => h?.gap ?? 0),
    bases: hours.map((h) => (h !== undefined && h.deployedBasis !== 'modelled' ? 'measured' : 'modelled')),
    bandGap: bandGapOf(route.day, key),
    peakGap: peak?.gap ?? 0,
    peakHour: peak?.hour ?? null,
  };
}

const EMPTY: BandTally = { shortRoutes: 0, overRoutes: 0, busesShort: 0, busesOver: 0 };

/** One route added to a tally: short or over by the band's mean gap, rounded. */
function tallied(tally: BandTally, gap: number): BandTally {
  const whole = Math.round(gap);
  if (whole > 0) return { ...tally, shortRoutes: tally.shortRoutes + 1, busesShort: tally.busesShort + whole };
  if (whole < 0) return { ...tally, overRoutes: tally.overRoutes + 1, busesOver: tally.busesOver - whole };
  return tally;
}

function depotTallies(routes: readonly NetworkRouteDay[], key: ServiceBandKey): DepotBandTally[] {
  const byDepot = new Map<string, DepotBandTally>();
  for (const r of routes) {
    if (r.depotId === null) continue;
    const held = byDepot.get(r.depotId) ?? { depotId: r.depotId, depotName: r.depotName ?? r.depotId, ...EMPTY };
    byDepot.set(r.depotId, { ...held, ...tallied(held, bandGapOf(r.day, key)) });
  }
  return [...byDepot.values()].sort((a, b) => (a.depotId < b.depotId ? -1 : a.depotId > b.depotId ? 1 : 0));
}

/** Every band's tally across the network and per depot. */
export function bandSummaries(routes: readonly NetworkRouteDay[]): ServiceBandSummary[] {
  return SERVICE_BANDS.map((band) => {
    const tally = routes.reduce((t, r) => tallied(t, bandGapOf(r.day, band.key)), EMPTY);
    return {
      band: band.key,
      label: band.label,
      fromHour: band.fromHour,
      toHour: band.toHour,
      ...tally,
      byDepot: depotTallies(routes, band.key),
    };
  });
}
