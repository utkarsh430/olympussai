import type { DepotDetailResponse } from '@/lib/depot/api';
import { buildAnswer } from '@/lib/depot/copilot/facts/answers';
import { buildDepotBriefing } from '@/lib/depot/copilot/facts/depot';
import { cleanName } from '@/lib/depot/copilot/facts/format';
import { buildNetworkBriefing } from '@/lib/depot/copilot/facts/network';
import { buildProposalRationale } from '@/lib/depot/copilot/facts/proposal';
import { buildTransferRationale } from '@/lib/depot/copilot/facts/transfer';
import type { CopilotQuery } from '@/lib/depot/copilot/queries';
import { scriptedRoute } from '@/lib/depot/copilot/router/scriptedRouter';
import type { CopilotRequest } from '@/lib/depot/copilot/types';
import type {
  CopilotAnswerScope,
  CopilotAnswerTable,
  CopilotScope,
} from '@/lib/depot/copilot/wire';
import { buildDepotDetail } from '@/lib/depot/live/depotView';
import { buildDistributionResponse } from '@/lib/depot/live/distributionView';
import { buildNetworkResponse } from '@/lib/depot/live/networkView';
import { routeTableOf } from '@/lib/depot/live/routeInputs';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';
import type { CopilotNetworkHours, RouteHourlyBody } from '@/lib/depot/service/types';
import { answerTable, interpretQuery } from '@/lib/depot/copilot/service/interpret';
import type { ValidCopilotRequest } from '@/lib/depot/copilot/service/schema';

export type Prepared =
  | {
      readonly ok: true;
      readonly request: CopilotRequest;
      readonly interpretedAs?: string;
      readonly table?: CopilotAnswerTable;
      readonly answerScope?: CopilotAnswerScope;
    }
  | { readonly ok: false; readonly status: 404 };

const NOT_FOUND = { ok: false, status: 404 } as const;

/**
 * The service views a request may need, loaded beforehand (they are read asynchronously)
 * by `loadServiceData`: the named route's day and the network's day by band.
 */
export interface ServiceAnswerData {
  readonly routeDay?: RouteHourlyBody;
  readonly networkHours?: CopilotNetworkHours;
}

/**
 * The catalogue query a question maps to, against the snapshot's depots and routes; null
 * when the asking depot is not in the snapshot. The question is used here and nowhere after.
 */
export function askQuery(
  question: string,
  scope: CopilotScope,
  view: FleetSnapshotView,
): CopilotQuery | null {
  const network = buildNetworkResponse(view);
  const scopeDepotId = scope.kind === 'depot' ? scope.depotId : undefined;
  if (scopeDepotId !== undefined && !network.depots.some((d) => d.id === scopeDepotId)) {
    return null;
  }
  const depots = network.depots.map((d) => ({ id: d.id, name: d.name }));
  const routes = routeTableOf(view).map((r) => r.routeName);
  return scriptedRoute(question, depots, scopeDepotId, routes);
}

/** The depots a query reads detail for; the answer builders look nothing else up. */
function depotIdsOf(query: CopilotQuery): string[] {
  switch (query.kind) {
    case 'depotSummary':
    case 'depotMeasure':
    case 'transfersFor':
    case 'exceptionsFor':
    case 'outshedStatus':
      return [query.depotId];
    case 'compareDepots':
      return [query.depotA, query.depotB];
    case 'hourProposals':
      return query.depotId === undefined ? [] : [query.depotId];
    default:
      return [];
  }
}

function prepareAsk(
  question: string,
  scope: CopilotScope,
  view: FleetSnapshotView,
  service: ServiceAnswerData,
): Prepared {
  const query = askQuery(question, scope, view);
  if (query === null) return NOT_FOUND;
  const network = buildNetworkResponse(view);
  const depots = network.depots.map((d) => ({ id: d.id, name: d.name }));
  const details: Readonly<Record<string, DepotDetailResponse>> = Object.fromEntries(
    depotIdsOf(query).flatMap((id) => {
      const detail = buildDepotDetail(view, id);
      return detail ? [[id, detail] as const] : [];
    }),
  );
  const request = buildAnswer(query, {
    network,
    details,
    distribution: buildDistributionResponse(view),
    ...service,
  });
  const nameOf = (id: string): string => depots.find((d) => d.id === id)?.name ?? id;
  const table = answerTable(query, request.facts);
  const answerScope = answerScopeOf(query, nameOf);
  return {
    ok: true,
    request,
    interpretedAs: interpretQuery(query, nameOf),
    ...(table ? { table } : {}),
    ...(answerScope ? { answerScope } : {}),
  };
}

/** The scope the answer is about, from the typed query; none for a refusal. */
function answerScopeOf(
  query: CopilotQuery,
  nameOf: (id: string) => string,
): CopilotAnswerScope | undefined {
  if (query.kind === 'unsupported') return undefined;
  const ids = depotIdsOf(query);
  const depots = ids.map((depotId) => ({ depotId, depotName: cleanName(nameOf(depotId)) }));
  const [only] = depots;
  if (depots.length === 1 && only) return { kind: 'depot', ...only };
  return depots.length > 1 ? { kind: 'depots', depots } : { kind: 'network' };
}

/**
 * Builds the core's request from a validated body and one snapshot, through
 * the live view builders only. The task is chosen here from the body's `task`;
 * nothing else in the body reaches the core. An unknown depot, a transfer
 * that is not in the current plan, or a proposal that is not in its route's day is a 404.
 */
export function prepareCopilotRequest(
  body: ValidCopilotRequest,
  view: FleetSnapshotView,
  service: ServiceAnswerData = {},
): Prepared {
  switch (body.task) {
    case 'briefing': {
      if (body.scope.kind === 'network') {
        return { ok: true, request: buildNetworkBriefing(buildNetworkResponse(view)) };
      }
      const detail = buildDepotDetail(view, body.scope.depotId);
      return detail ? { ok: true, request: buildDepotBriefing(detail) } : NOT_FOUND;
    }
    case 'rationale': {
      if ('proposalId' in body) {
        const day = service.routeDay;
        const proposal =
          day?.routeName === body.routeName
            ? day.proposals.find((p) => p.id === body.proposalId)
            : undefined;
        return day && proposal
          ? { ok: true, request: buildProposalRationale(proposal, day) }
          : NOT_FOUND;
      }
      const distribution = buildDistributionResponse(view);
      const transfer = distribution.plan.transfers.find((t) => t.id === body.transferId);
      return transfer
        ? { ok: true, request: buildTransferRationale(transfer, distribution) }
        : NOT_FOUND;
    }
    case 'ask':
      return prepareAsk(body.question, body.scope, view, service);
  }
}
