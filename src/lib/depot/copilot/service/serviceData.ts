import type { CopilotQuery } from '@/lib/depot/copilot/queries';
import { askQuery, type ServiceAnswerData } from '@/lib/depot/copilot/service/prepare';
import type { ValidCopilotRequest } from '@/lib/depot/copilot/service/schema';
import { buildRouteHourlyResponse } from '@/lib/depot/live/routeHourlyView';
import type { FleetSnapshotView, ServiceRepositories } from '@/lib/depot/repositories/types';
import type { NetworkHourlyBody, RouteHourlyBody } from '@/lib/depot/service/types';

/** The network's day by band for a snapshot; null when it cannot be built. */
export type NetworkHoursLoader = (view: FleetSnapshotView) => Promise<NetworkHourlyBody | null>;

export interface ServiceSources {
  readonly services: ServiceRepositories;
  /** Absent until the network view is wired in: the hour and brief kinds then say they are not available. */
  readonly networkHours?: NetworkHoursLoader;
}

/** The route a request needs the day of: a route question's, or a proposal rationale's. */
function routeOf(body: ValidCopilotRequest, query: CopilotQuery | null): string | null {
  if (body.task === 'rationale') return 'proposalId' in body ? body.routeName : null;
  if (query?.kind === 'routeHour' || query?.kind === 'routeProposals') return query.routeName;
  return null;
}

const needsNetwork = (query: CopilotQuery | null): boolean =>
  query?.kind === 'hourProposals' || query?.kind === 'serviceBrief';

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
  const [routeDay, networkHours] = await Promise.all([
    routeName === null ? undefined : routeDayOf(view, routeName, sources.services),
    needsNetwork(query) && sources.networkHours ? sources.networkHours(view) : null,
  ]);
  return {
    ...(routeDay === undefined ? {} : { routeDay }),
    ...(networkHours === null ? {} : { networkHours }),
  };
}
