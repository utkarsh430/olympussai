import type { DepotDetailResponse } from '@/lib/depot/api';
import { buildAnswer } from '@/lib/depot/copilot/facts/answers';
import { buildDepotBriefing } from '@/lib/depot/copilot/facts/depot';
import { buildNetworkBriefing } from '@/lib/depot/copilot/facts/network';
import { buildTransferRationale } from '@/lib/depot/copilot/facts/transfer';
import type { CopilotQuery } from '@/lib/depot/copilot/queries';
import { scriptedRoute } from '@/lib/depot/copilot/router/scriptedRouter';
import type { CopilotRequest } from '@/lib/depot/copilot/types';
import type { CopilotAnswerTable, CopilotScope } from '@/lib/depot/copilot/wire';
import { buildDepotDetail } from '@/lib/depot/live/depotView';
import { buildDistributionResponse } from '@/lib/depot/live/distributionView';
import { buildNetworkResponse } from '@/lib/depot/live/networkView';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';
import { answerTable, interpretQuery } from '@/lib/depot/copilot/service/interpret';
import type { ValidCopilotRequest } from '@/lib/depot/copilot/service/schema';

export type Prepared =
  | {
      readonly ok: true;
      readonly request: CopilotRequest;
      readonly interpretedAs?: string;
      readonly table?: CopilotAnswerTable;
    }
  | { readonly ok: false; readonly status: 404 };

const NOT_FOUND = { ok: false, status: 404 } as const;

/** The depots a query reads detail for; the answer builders look nothing else up. */
function depotIdsOf(query: CopilotQuery): string[] {
  switch (query.kind) {
    case 'depotSummary':
    case 'transfersFor':
    case 'exceptionsFor':
    case 'outshedStatus':
      return [query.depotId];
    case 'compareDepots':
      return [query.depotA, query.depotB];
    default:
      return [];
  }
}

function prepareAsk(question: string, scope: CopilotScope, view: FleetSnapshotView): Prepared {
  const network = buildNetworkResponse(view);
  const scopeDepotId = scope.kind === 'depot' ? scope.depotId : undefined;
  if (scopeDepotId !== undefined && !network.depots.some((d) => d.id === scopeDepotId)) {
    return NOT_FOUND;
  }
  const depots = network.depots.map((d) => ({ id: d.id, name: d.name }));
  // The question is used here, to pick a catalogue query, and nowhere after.
  const query = scriptedRoute(question, depots, scopeDepotId);
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
  });
  const nameOf = (id: string): string => depots.find((d) => d.id === id)?.name ?? id;
  const table = answerTable(query, request.facts);
  return {
    ok: true,
    request,
    interpretedAs: interpretQuery(query, nameOf),
    ...(table ? { table } : {}),
  };
}

/**
 * Builds the core's request from a validated body and one snapshot, through
 * the live view builders only. The task is chosen here from the body's `task`;
 * nothing else in the body reaches the core. An unknown depot or a transfer
 * that is not in the current plan is a 404.
 */
export function prepareCopilotRequest(
  body: ValidCopilotRequest,
  view: FleetSnapshotView,
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
      const distribution = buildDistributionResponse(view);
      const transfer = distribution.plan.transfers.find((t) => t.id === body.transferId);
      return transfer
        ? { ok: true, request: buildTransferRationale(transfer, distribution) }
        : NOT_FOUND;
    }
    case 'ask':
      return prepareAsk(body.question, body.scope, view);
  }
}
