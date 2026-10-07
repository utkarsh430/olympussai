import { formatCount } from '../format';
import { terminalsOf } from '../routes/deadKm';
import type { RouteProfile } from '../routes/types';
import { ADD_MIN_BUSES, ADD_MIN_SHARE } from './proposalConfig';
import { bandHours, serviceBand, type NetworkRouteDay } from './networkHours';
import { networkProposal } from './networkProposals';
import { tripsPerBusHour } from './need';
import { bandLabel, gapWords, hourLabel } from './serviceWording';
import type { NetworkProposal, RouteHourFigures, ServiceBandKey } from './types';

/*
 * Two findings across routes: peak spreading on one route (departures movable from an
 * over hour to the neighbouring short hour, no bus added), and the service on a corridor
 * (the routes sharing a terminal pair, either way, from the loaded route profiles). Pure.
 */

/** A corridor counts as over-served at a surplus of at least this many buses. */
export const CORRIDOR_MIN_OVER = 2;

const isMeasured = (h: RouteHourFigures): boolean => h.deployedBasis !== 'modelled';

interface Shift {
  readonly over: RouteHourFigures;
  readonly short: RouteHourFigures;
  readonly buses: number;
}

/** The neighbouring over and short hours of the route touching the band, the largest movable first. */
function bestShift(day: NetworkRouteDay, key: ServiceBandKey): Shift | null {
  const band = serviceBand(key);
  const byHour = new Map(day.day.hours.map((h) => [h.hour, h] as const));
  let best: Shift | null = null;
  for (let hour = Math.max(0, band.fromHour - 1); hour <= Math.min(22, band.toHour); hour += 1) {
    const a = byHour.get(hour);
    const b = byHour.get(hour + 1);
    if (a === undefined || b === undefined) continue;
    const [over, short] = a.gap < 0 ? [a, b] : [b, a];
    const buses = Math.min(Math.floor(-over.gap), Math.floor(short.gap));
    if (buses >= 1 && (best === null || buses > best.buses)) best = { over, short, buses };
  }
  return best;
}

/** Per route, the departures movable from an over hour to the neighbouring short hour. */
export function shiftDepartures(
  days: readonly NetworkRouteDay[],
  key: ServiceBandKey,
  operatingDate: string,
): NetworkProposal[] {
  return days.flatMap((d) => {
    const shift = bestShift(d, key);
    if (shift === null) return [];
    const { over, short, buses } = shift;
    const trips = Math.max(1, Math.round(buses * tripsPerBusHour(d.day.need)));
    const routeName = d.day.routeName;
    const band = { fromHour: Math.min(over.hour, short.hour), toHour: Math.max(over.hour, short.hour) };
    const reason = `On ${routeName}, about ${formatCount(trips)} departures could move from ${hourLabel(over.hour)} (${gapWords(over.gap).toLowerCase()}) to ${hourLabel(short.hour)} (${gapWords(short.gap).toLowerCase()}), spreading the peak without adding a bus.`;
    return [networkProposal({
      kind: 'shift_departures', operatingDate, subject: routeName, band, routeName,
      depotId: d.depotId, depotName: d.depotName, routes: [routeName], group: 'network', count: trips,
      deployed: (over.deployed + short.deployed) / 2, needed: (over.needed + short.needed) / 2,
      tier: isMeasured(over) && isMeasured(short) ? 'B' : 'C', reason,
    })];
  });
}

/** The corridor's key and its two ends, either direction the same. */
function corridorOf(profile: RouteProfile): { key: string; ends: [string, string] } | null {
  const terminals = terminalsOf(profile);
  if (terminals === null) return null;
  const ends = [terminals.first.name, terminals.last.name].sort() as [string, string];
  if (ends[0] === ends[1]) return null;
  return { key: `${ends[0]}|${ends[1]}`, ends };
}

const mean = (xs: readonly number[]): number => (xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length);

/** Corridors of two routes or more whose band gap together is short or over by enough to act on. */
export function corridorFindings(
  days: readonly NetworkRouteDay[],
  key: ServiceBandKey,
  operatingDate: string,
  profiles: ReadonlyMap<string, RouteProfile>,
): NetworkProposal[] {
  const groups = new Map<string, { ends: [string, string]; days: NetworkRouteDay[] }>();
  for (const d of days) {
    const profile = profiles.get(d.day.routeName);
    const corridor = profile === undefined ? null : corridorOf(profile);
    if (corridor === null) continue;
    const held = groups.get(corridor.key) ?? { ends: corridor.ends, days: [] };
    groups.set(corridor.key, { ...held, days: [...held.days, d] });
  }
  const band = serviceBand(key);
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .flatMap(([corridorKey, { ends, days: members }]) => {
      if (members.length < 2) return [];
      const hours = members.map((m) => bandHours(m.day, key));
      const gap = members.reduce((s, _, i) => s + Math.round(mean(hours[i]!.map((h) => h.gap))), 0);
      const needed = hours.reduce((s, hs) => s + mean(hs.map((h) => h.needed)), 0);
      const deployed = hours.reduce((s, hs) => s + mean(hs.map((h) => h.deployed)), 0);
      const under = gap >= Math.max(ADD_MIN_BUSES, ADD_MIN_SHARE * needed);
      if (!under && gap > -CORRIDOR_MIN_OVER) return [];
      const routes = members.map((m) => m.day.routeName).sort();
      const words = under ? `short by ${formatCount(gap)}` : `over by ${formatCount(-gap)}`;
      const reason = `The ${formatCount(routes.length)} routes between ${ends[0]} and ${ends[1]} are ${words} buses together in ${band.label.toLowerCase()} (${bandLabel(band)}).`;
      return [networkProposal({
        kind: under ? 'corridor_under_served' : 'corridor_over_served', operatingDate,
        subject: `corridor:${corridorKey}`, band, routeName: null, depotId: null, depotName: null,
        routes, group: 'findings', count: Math.abs(gap), deployed, needed,
        tier: hours.flat().every(isMeasured) ? 'B' : 'C', reason,
      })];
    });
}
