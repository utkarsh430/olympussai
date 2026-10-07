import { formatCount, formatPercent } from '../format';
import { releasableBuses } from '../optimise/hourlyReallocate';
import { DEFAULT_SPARE_RATIO } from '../optimise/config';
import { proposalId } from './bands';
import { bandHours, serviceBand, type NetworkRouteDay } from './networkHours';
import { bandLabel } from './serviceWording';
import type {
  HourBand,
  NetworkProposal,
  NetworkProposalGroup,
  ProposalKind,
  ProposalTier,
  ServiceBandKey,
} from './types';

/*
 * The network page's proposals: each route's own (add, hold, a timetable finding) in the
 * chosen band, and the depot kinds, a reserve held through the band and a maintenance
 * window in a quiet band. Pure; every threshold is a REFERENCE planning choice.
 */

/** Idle buses a depot needs in a band before a maintenance window is worth naming. */
export const MAINTENANCE_MIN_IDLE = 3;
/** A band is quiet when the depot's need in it is at most this share of its peak band's. */
export const MAINTENANCE_LOW_DEMAND_SHARE = 0.6;
/** The bands a maintenance window is looked for in: never a peak. */
const QUIET_BANDS: ReadonlySet<ServiceBandKey> = new Set(['early', 'midday', 'late']);
const PEAK_BANDS: readonly ServiceBandKey[] = ['morning_peak', 'evening_peak'];

const TENTHS = 10;
const oneDecimal = (n: number): number => Math.round(n * TENTHS) / TENTHS + 0;
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export interface NetworkProposalSeed {
  readonly kind: ProposalKind;
  readonly operatingDate: string;
  /** What the id is keyed on besides the kind and band: a depot, a route or a corridor. */
  readonly subject: string;
  readonly band: HourBand;
  readonly routeName: string | null;
  readonly depotId: string | null;
  readonly depotName: string | null;
  readonly routes: readonly string[];
  readonly group: NetworkProposalGroup;
  readonly count: number;
  readonly deployed: number;
  readonly needed: number;
  readonly tier: ProposalTier;
  readonly reason: string;
}

/** A network kind's proposal: it moves no bus by itself, names no source and carries no impact. */
export function networkProposal(seed: NetworkProposalSeed): NetworkProposal {
  const { subject, operatingDate, ...rest } = seed;
  return {
    ...rest,
    id: proposalId(operatingDate, seed.kind, subject, seed.band),
    operatingDate,
    deployed: oneDecimal(seed.deployed),
    needed: oneDecimal(seed.needed),
    scheduled: null,
    change: 0,
    source: null,
    maybeCoveredByUnrouted: false,
    impact: null,
  };
}

/** The mean over the band's hours of a figure summed across the routes. */
function bandMean(days: readonly NetworkRouteDay[], key: ServiceBandKey, pick: 'needed' | 'deployed'): number {
  const band = serviceBand(key);
  const hours = band.toHour - band.fromHour + 1;
  const total = days.reduce((s, d) => s + bandHours(d.day, key).reduce((t, h) => t + h[pick], 0), 0);
  return total / hours;
}

function byDepot(days: readonly NetworkRouteDay[]): [string, string, NetworkRouteDay[]][] {
  const grouped = new Map<string, NetworkRouteDay[]>();
  for (const d of days) {
    if (d.depotId !== null) grouped.set(d.depotId, [...(grouped.get(d.depotId) ?? []), d]);
  }
  return [...grouped.entries()]
    .sort(([a], [b]) => byText(a, b))
    .map(([id, ds]) => [id, ds[0]?.depotName ?? id, ds]);
}

/** Per depot, the spare ratio of the band's need held in reserve, rounded up. */
export function reserveByHour(
  days: readonly NetworkRouteDay[],
  key: ServiceBandKey,
  operatingDate: string,
): NetworkProposal[] {
  const band = serviceBand(key);
  return byDepot(days).flatMap(([depotId, depotName, ds]) => {
    const needed = bandMean(ds, key, 'needed');
    const reserve = Math.ceil(oneDecimal(needed * DEFAULT_SPARE_RATIO));
    if (reserve < 1) return [];
    const reason = `Keep ${formatCount(reserve)} buses in reserve at ${depotName} through ${band.label.toLowerCase()} (${bandLabel(band)}): ${formatPercent(DEFAULT_SPARE_RATIO)} of its routes’ need of ${formatCount(Math.round(needed))} buses.`;
    return [networkProposal({
      kind: 'reserve_by_hour', operatingDate, subject: `depot:${depotId}`, band, routeName: null,
      depotId, depotName, routes: [], group: 'network', count: reserve,
      deployed: bandMean(ds, key, 'deployed'), needed, tier: 'C', reason,
    })];
  });
}

/**
 * Per depot, a quiet band (not a peak) with idle buses: its standing pool plus what its
 * over-served routes could release. Quiet means its need is at most a share of its peak's.
 */
export function maintenanceWindows(
  days: readonly NetworkRouteDay[],
  key: ServiceBandKey,
  operatingDate: string,
  standing: ReadonlyMap<string, number>,
): NetworkProposal[] {
  if (!QUIET_BANDS.has(key)) return [];
  const band = serviceBand(key);
  return byDepot(days).flatMap(([depotId, depotName, ds]) => {
    const needed = bandMean(ds, key, 'needed');
    const peak = Math.max(...PEAK_BANDS.map((p) => bandMean(ds, p, 'needed')));
    const released = ds.reduce((s, d) => {
      const hours = bandHours(d.day, key);
      const gap = hours.reduce((t, h) => t + h.gap, 0) / Math.max(1, hours.length);
      const deployed = hours.reduce((t, h) => t + h.deployed, 0) / Math.max(1, hours.length);
      return s + releasableBuses({ gap, deployed });
    }, 0);
    const idle = Math.floor(standing.get(depotId) ?? 0) + released;
    const share = peak > 0 ? needed / peak : 0;
    if (idle < MAINTENANCE_MIN_IDLE || peak <= 0 || share > MAINTENANCE_LOW_DEMAND_SHARE) return [];
    const reason = `${band.label} (${bandLabel(band)}): ${formatCount(idle)} buses of ${depotName} are idle while its need is ${formatPercent(share)} of its peak, a window for scheduled maintenance.`;
    return [networkProposal({
      kind: 'maintenance_window', operatingDate, subject: `depot:${depotId}`, band, routeName: null,
      depotId, depotName, routes: [], group: 'network', count: idle,
      deployed: bandMean(ds, key, 'deployed'), needed, tier: 'C', reason,
    })];
  });
}

/** Each route's own proposals whose hours meet the band, carrying the route's depot. */
export function routeProposalsInBand(days: readonly NetworkRouteDay[], key: ServiceBandKey): NetworkProposal[] {
  const band = serviceBand(key);
  return days.flatMap((d) =>
    d.day.proposals
      .filter((p) => p.band.toHour >= band.fromHour && p.band.fromHour <= band.toHour)
      .map((p) => ({
        ...p,
        depotId: d.depotId,
        depotName: d.depotName,
        routes: [p.routeName],
        group: p.change === 0 ? ('findings' as const) : ('changes' as const),
        count: null,
      })),
  );
}
