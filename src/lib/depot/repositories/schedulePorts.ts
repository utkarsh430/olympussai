import type { CrewRepository } from '../crew/types';
import { analyseSnapshot } from '../live/analysis';
import { routeDayInputsFor, routedShare, snapshotRouteShared } from '../live/routeHourlyBody';
import { routeTableOf } from '../live/routeInputs';
import { modelService } from '../maintenance/serviceModel';
import { DEFAULT_REBALANCE_PARAMS } from '../optimise/config';
import { deadKmFor } from '../routes/deadKm';
import { depotPositions } from '../routes/depotPositions';
import type { BusHold, DeadRunning, RouteNeedDay, RouteTiming, SchedulePorts } from '../schedule/ports';
import { routeDayOf } from '../service/routeDay';
import type { RouteHourlyBody } from '../service/types';
import { modelBus } from '../sim/fleetMaster';
import { HOURS_PER_DAY } from '../sim/hourlyDemandConfig';
import type { FleetSnapshotView, ServiceRepositories } from './types';

/*
 * The scheduler's ports as they are served today. Need and timing come from
 * the route page's own day (so the scheduler and the Service page agree),
 * dead running from the inferred yard and the cached profile, holds from the
 * service model. A real feed replaces any one of them here, nowhere else.
 */

const ZERO_HOURS: readonly number[] = Array.from({ length: HOURS_PER_DAY }, () => 0);

export function schedulePortsFor(
  view: FleetSnapshotView,
  services: ServiceRepositories,
  crew: CrewRepository,
): SchedulePorts {
  const shared = snapshotRouteShared(view);
  const coverage = routedShare(view);
  const bodies = new Map<string, Promise<RouteHourlyBody | null>>();
  const bodyOf = (routeName: string): Promise<RouteHourlyBody | null> => {
    const held = bodies.get(routeName);
    if (held) return held;
    const row = routeTableOf(view).find((r) => r.routeName === routeName);
    const started =
      row === undefined
        ? Promise.resolve(null)
        : routeDayInputsFor(view, row, services, coverage, shared).then(routeDayOf);
    bodies.set(routeName, started);
    return started;
  };
  return {
    need: {
      async needByHour(routeName): Promise<RouteNeedDay> {
        const body = await bodyOf(routeName);
        if (body === null) {
          const need = { routeName, serviceClass: 'ordinary', seatsPerBus: 0, journeyMinutes: 0, journeyMinutesProvenance: 'modelled', layoverMinutes: 0, targetLoad: 1, busiestStretchShare: 1 } as const;
          return { routeName, boardingsByHour: ZERO_HOURS, need, neededByHour: ZERO_HOURS, provenance: 'modelled' };
        }
        return {
          routeName,
          boardingsByHour: body.hours.map((h) => h.demand),
          need: body.need,
          neededByHour: body.hours.map((h) => h.needed),
          provenance: 'modelled',
        };
      },
    },
    timing: {
      async timingFor(routeName): Promise<RouteTiming> {
        const body = await bodyOf(routeName);
        const need = body?.need;
        const journeyMinutes = need?.journeyMinutes ?? 0;
        const layoverMinutes = need?.layoverMinutes ?? 0;
        return { journeyMinutes, layoverMinutes, cycleMinutes: journeyMinutes + layoverMinutes, provenance: need?.journeyMinutesProvenance ?? 'modelled' };
      },
    },
    deadRunning: {
      async deadKmFor(depotId, routeName): Promise<DeadRunning | null> {
        const analysis = analyseSnapshot(view);
        const depot = depotPositions(analysis.depots, analysis.yards).get(depotId);
        const profile = shared.profiles.get(routeName);
        if (depot === undefined || profile === undefined) return null;
        const dead = deadKmFor(depot.position, profile, DEFAULT_REBALANCE_PARAMS.detourFactor);
        return dead === null ? null : { outKm: dead.outKm, inKm: dead.inKm, provenance: 'derived' };
      },
    },
    crew,
    holds: {
      async holdsFor(_depot, buses): Promise<readonly BusHold[]> {
        return buses
          .filter((b) => modelService(modelBus(b.registrationNumber, b.routeName)).group === 'overdue')
          .map((b) => ({ registrationNumber: b.registrationNumber, reason: 'service_overdue', provenance: 'modelled' }));
      },
    },
  };
}
