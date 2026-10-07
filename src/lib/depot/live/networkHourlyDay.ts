import { DEFAULT_REBALANCE_PARAMS } from '../optimise/config';
import { planHourlyReallocation, type ReallocationDepot } from '../optimise/hourlyReallocate';
import type { FleetSnapshotView, ServiceRepositories } from '../repositories/types';
import { depotPositions } from '../routes/depotPositions';
import type { RouteProfile } from '../routes/types';
import { feedMinuteOn } from '../sim/dayPlan';
import { operatingDateOf } from '../sim/seed';
import { corridorFindings, shiftDepartures } from '../service/networkFindings';
import {
  SERVICE_BANDS,
  bandGapOf,
  bandHours,
  bandSummaries,
  serviceBand,
  type NetworkRouteDay,
} from '../service/networkHours';
import { maintenanceWindows, reserveByHour, routeProposalsInBand } from '../service/networkProposals';
import { primaryDepotOf, routeDayOf } from '../service/routeDay';
import type {
  BandReallocation,
  NetworkProposal,
  ObservedDepotHour,
  ServiceBandKey,
  ServiceBandSummary,
} from '../service/types';
import type { Coverage } from '../types';
import { MINUTES_PER_HOUR } from '../units';
import { analyseSnapshot } from './analysis';
import { operatingDayFor } from './operatingDayView';
import { routedShare, routeDayInputsFor, snapshotRouteShared } from './routeHourlyBody';
import { routeTableOf } from './routeInputs';

/*
 * The network's whole day, built once per snapshot: every route's day through the same
 * `routeDayOf` the route page uses, the band tallies, and per band the hourly reallocation
 * and the proposals. The API's band, depot and page only select from it. No upstream call.
 */

export interface BandPlan {
  readonly reallocation: BandReallocation;
  readonly proposals: readonly NetworkProposal[];
}

export interface NetworkDay {
  readonly operatingDate: string;
  readonly currentHour: number | null;
  readonly days: readonly NetworkRouteDay[];
  readonly bands: readonly ServiceBandSummary[];
  readonly plans: ReadonlyMap<ServiceBandKey, BandPlan>;
  readonly depots: readonly { readonly depotId: string; readonly depotName: string }[];
  readonly observed: NetworkRouteDay['day']['observed'];
  readonly routeCoverage: Coverage;
}

const mean = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;

/**
 * A depot's standing pool in a band: the observed yard mean over the band's observed hours,
 * else in the hour before it; else the buses its modelled day leaves without a duty.
 */
function standingIn(key: ServiceBandKey, observed: readonly ObservedDepotHour[], idle: number): number {
  const band = serviceBand(key);
  const seen = (from: number, to: number): number[] =>
    observed
      .filter((h) => h.hour >= from && h.hour <= to && h.standingInYardMean !== null)
      .map((h) => h.standingInYardMean as number);
  const within = seen(band.fromHour, band.toHour);
  if (within.length > 0) return Math.floor(mean(within));
  const before = seen(band.fromHour - 1, band.fromHour - 1);
  return before.length > 0 ? Math.floor(mean(before)) : idle;
}

function bandPlan(
  key: ServiceBandKey,
  days: readonly NetworkRouteDay[],
  depots: readonly ReallocationDepot[],
  operatingDate: string,
  profiles: ReadonlyMap<string, RouteProfile>,
): BandPlan {
  const routes = days.map((d) => {
    const hours = bandHours(d.day, key);
    return {
      routeName: d.day.routeName,
      depotId: d.depotId,
      gap: bandGapOf(d.day, key),
      deployed: hours.length === 0 ? 0 : mean(hours.map((h) => h.deployed)),
      profile: profiles.get(d.day.routeName) ?? null,
    };
  });
  const reallocation = planHourlyReallocation({
    band: key,
    depots,
    routes,
    detourFactor: DEFAULT_REBALANCE_PARAMS.detourFactor,
  });
  const standing = new Map(depots.map((d) => [d.depotId, d.standing] as const));
  const proposals = [
    ...routeProposalsInBand(days, key),
    ...shiftDepartures(days, key, operatingDate),
    ...reserveByHour(days, key, operatingDate),
    ...maintenanceWindows(days, key, operatingDate, standing),
    ...corridorFindings(days, key, operatingDate, profiles),
  ];
  return { reallocation, proposals };
}

/** The network's day for this snapshot: every route's day, the tallies and each band's plan. */
export async function networkDayOf(view: FleetSnapshotView, services: ServiceRepositories): Promise<NetworkDay> {
  const analysis = analyseSnapshot(view);
  const operatingDate = operatingDateOf(view.feedNow, view.fetchedAt);
  const feedMinute = feedMinuteOn(view.feedNow, operatingDate);
  const rows = routeTableOf(view);
  const coverage = routedShare(view);
  const shared = snapshotRouteShared(view);
  const inputs = await Promise.all(
    rows.map((row) => routeDayInputsFor(view, row, services, coverage, shared)),
  );
  const days: NetworkRouteDay[] = inputs.map((input) => {
    const depotId = primaryDepotOf(input.row);
    const depotName = input.row.operators.find((o) => o.depotId === depotId)?.depotName ?? depotId;
    return { day: routeDayOf(input), depotId, depotName };
  });
  const running = [...new Set(days.map((d) => d.depotId).filter((id): id is string => id !== null))].sort();
  const positions = depotPositions(analysis.depots, analysis.yards);
  const observedByDepot = await Promise.all(
    running.map((id) => services.hourly.depotHours(id, operatingDate)),
  );
  const nameOf = (id: string): string =>
    analysis.depotsById.get(id)?.name ?? days.find((d) => d.depotId === id)?.depotName ?? id;
  const idleOf = (id: string): number =>
    operatingDayFor(view, id)?.notRun.filter((b) => b.reason === 'no_duty').length ?? 0;
  const profiles = shared.profiles;
  const plans = new Map(
    SERVICE_BANDS.map((band) => {
      const depots: ReallocationDepot[] = running.map((id, i) => ({
        depotId: id,
        depotName: nameOf(id),
        position: positions.get(id)?.position ?? null,
        standing: standingIn(band.key, observedByDepot[i] ?? [], idleOf(id)),
      }));
      return [band.key, bandPlan(band.key, days, depots, operatingDate, profiles)] as const;
    }),
  );
  return {
    operatingDate,
    currentHour: feedMinute === null ? null : Math.floor(feedMinute / MINUTES_PER_HOUR),
    days,
    bands: bandSummaries(days),
    plans,
    depots: running.map((id) => ({ depotId: id, depotName: nameOf(id) })),
    observed: await services.hourly.observedSummary(operatingDate),
    routeCoverage: coverage,
  };
}
