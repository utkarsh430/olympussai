import type {
  DepotDetailResponse,
  DepotDistributionResponse,
  DepotNetworkResponse,
} from '@/lib/depot/api';
import type { CopilotQuery } from '@/lib/depot/copilot/queries';
import { balanceList } from '@/lib/depot/copilot/facts/answers/balance';
import { compareAnswer } from '@/lib/depot/copilot/facts/answers/compare';
import { exceptionsAnswer } from '@/lib/depot/copilot/facts/answers/exceptions';
import { outshedAnswer } from '@/lib/depot/copilot/facts/answers/outshed';
import { rankAnswer } from '@/lib/depot/copilot/facts/answers/rank';
import { answer, unavailable } from '@/lib/depot/copilot/facts/answers/shared';
import { transfersAnswer } from '@/lib/depot/copilot/facts/answers/transfers';
import { buildDepotBriefing } from '@/lib/depot/copilot/facts/depot';
import { buildNetworkBriefing } from '@/lib/depot/copilot/facts/network';
import type { CopilotRequest } from '@/lib/depot/copilot/types';

/** The views a query may need. Only `network` is always present. */
export interface AnswerData {
  readonly network: DepotNetworkResponse;
  readonly details?: Readonly<Record<string, DepotDetailResponse>>;
  readonly distribution?: DepotDistributionResponse;
}

const SCOPE_SENTENCE =
  'This assistant can answer questions about the network as a whole, a named depot, depot rankings, depots in deficit or surplus, proposed transfers, exceptions, comparisons between depots, and departures from the yard.';

type UnsupportedReason = Extract<CopilotQuery, { kind: 'unsupported' }>['reason'];

function unsupported(reason: UnsupportedReason): CopilotRequest {
  if (reason === 'ambiguous_depot') {
    return answer('an unsupported question', [], {
      headline: 'That depot name is not specific enough',
      paragraphs: ["That name matches several depots. The depot's full name would settle which depot is meant."],
    });
  }
  const closing =
    reason === 'people'
      ? 'Questions about people are outside that scope. A question on any topic above would be answered from the live data.'
      : 'A question on any topic above would be answered from the live data.';
  return answer('an unsupported question', [], {
    headline: 'That question is outside what can be answered here',
    paragraphs: [SCOPE_SENTENCE, closing],
  });
}

// ---- entry point --------------------------------------------------------

export function buildAnswer(query: CopilotQuery, data: AnswerData): CopilotRequest {
  switch (query.kind) {
    case 'networkSummary':
      return { ...buildNetworkBriefing(data.network), task: 'answer' };
    case 'depotSummary': {
      const detail = data.details?.[query.depotId];
      return detail ? { ...buildDepotBriefing(detail), task: 'answer' } : unavailable('that depot');
    }
    case 'rankDepots':
      return rankAnswer(data, query.metric, query.order, query.limit);
    case 'depotsInDeficit':
      return balanceList(data, 'deficit');
    case 'depotsInSurplus':
      return balanceList(data, 'surplus');
    case 'transfersFor':
      return transfersAnswer(data, query.depotId);
    case 'exceptionsFor':
      return exceptionsAnswer(data, query.depotId);
    case 'compareDepots':
      return compareAnswer(data, query.depotA, query.depotB);
    case 'outshedStatus':
      return outshedAnswer(data, query.depotId);
    case 'unsupported':
      return unsupported(query.reason);
  }
}
