import type { CopilotQuery } from '@/lib/depot/copilot/queries';
import { askQuery, type ServiceAnswerData } from '@/lib/depot/copilot/service/prepare';
import type { ValidCopilotRequest } from '@/lib/depot/copilot/service/schema';
import { buildRouteHourlyResponse } from '@/lib/depot/live/routeHourlyView';
import type { FleetSnapshotView, ServiceRepositories } from '@/lib/depot/repositories/types';
import type { CopilotNetworkHours, RouteHourlyBody } from '@/lib/depot/service/types';
import type { SchedulePlanBody } from '@/lib/depot/copilot/facts/schedule';
import type { SchedulerRollupResponse } from '@/lib/depot/schedule/api';

/** The network's day by band for a snapshot; null when it cannot be built. */
export type NetworkHoursLoader = (view: FleetSnapshotView) => Promise<CopilotNetworkHours | null>;

export interface ServiceSources {
  readonly services: ServiceRepositories;
  /** The network's day (`live/copilotNetworkHours.ts`); absent, the hour and brief kinds say the data is not available. */
  readonly networkHours?: NetworkHoursLoader;
  /** A depot's held schedule plan (`live/scheduleView.ts`); absent, the schedule kinds say the plan is not available. */
  readonly schedulePlan?: (view: FleetSnapshotView, depotId: string) => Promise<SchedulePlanBody | null>;
  /** Every depot's plan rolled up (`live/schedulerView.ts`). */
  readonly schedulerRollup?: (view: FleetSnapshotView) => Promise<SchedulerRollupResponse | null>;
}

/** The route a request needs the day of: a route question's, or a proposal rationale's. */
function routeOf(body: ValidCopilotRequest, query: CopilotQuery | null): string | null {
  if (body.task === 'rationale') return 'proposalId' in body ? body.routeName : null;
  if (query?.kind === 'routeHour' || query?.kind === 'routeProposals') return query.routeName;
  return null;
}

const needsNetwork = (query: CopilotQuery | null): boolean =>
  query?.kind === 'hourProposals' || query?.kind === 'serviceBrief';

/** The depot whose schedule plan a request needs: a schedule question's, or a schedule rationale's. */
function scheduleDepotOf(body: ValidCopilotRequest, query: CopilotQuery | null): string | null {
  if (body.task === 'rationale') return 'scheduleDepotId' in body ? body.scheduleDepotId : null;
  if (query?.kind === 'scheduleSummary' || query?.kind === 'scheduleShiftCover' || query?.kind === 'scheduleUncovered') return query.depotId;
  return null;
}

async function routeDayOf(
  view: FleetSnapshotView,
  routeName: string,
  services: ServiceRepositories,
): Promise<RouteHourlyBody | undefined> {
  const result = await buildRouteHourlyResponse(view, { routeName, date: null }, services);
  return result.status === 200 ? result.body : undefined;
}

/**
 * Loads, before the facts are built, the service views the request needs: the route day
 * through the route view (held per snapshot, no upstream call) and the network's day by
 * band through its loader. Every other request needs neither and loads nothing.
 */
export async function loadServiceData(
  body: ValidCopilotRequest,
  view: FleetSnapshotView,
  sources: ServiceSources,
): Promise<ServiceAnswerData> {
  const query = body.task === 'ask' ? askQuery(body.question, body.scope, view) : null;
  const routeName = routeOf(body, query);
  const scheduleDepot = scheduleDepotOf(body, query);
  const [routeDay, networkHours, schedulePlan, scheduler] = await Promise.all([
    routeName === null ? undefined : routeDayOf(view, routeName, sources.services),
    needsNetwork(query) && sources.networkHours ? sources.networkHours(view) : null,
    scheduleDepot !== null && sources.schedulePlan ? sources.schedulePlan(view, scheduleDepot) : null,
    query?.kind === 'schedulerSummary' && sources.schedulerRollup ? sources.schedulerRollup(view) : undefined,
  ]);
  return {
    ...(routeDay === undefined ? {} : { routeDay }),
    ...(networkHours === null ? {} : { networkHours }),
    ...(schedulePlan === null || scheduleDepot === null ? {} : { schedule: { [scheduleDepot]: schedulePlan } }),
    ...(scheduler === undefined ? {} : { scheduler }),
  };
}
