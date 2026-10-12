import type {
  DepotDetailResponse,
  DepotDistributionResponse,
  DepotNetworkResponse,
} from '@/lib/depot/api';
import type { CopilotQuery } from '@/lib/depot/copilot/queries';
import { balanceList } from '@/lib/depot/copilot/facts/answers/balance';
import { compareAnswer } from '@/lib/depot/copilot/facts/answers/compare';
import { measureAnswer } from '@/lib/depot/copilot/facts/answers/measure';
import { exceptionsAnswer } from '@/lib/depot/copilot/facts/answers/exceptions';
import { hourProposalsAnswer } from '@/lib/depot/copilot/facts/answers/hourProposals';
import { routeHourAnswer } from '@/lib/depot/copilot/facts/answers/routeHour';
import { routeProposalsAnswer } from '@/lib/depot/copilot/facts/answers/routeProposals';
import { serviceBriefAnswer } from '@/lib/depot/copilot/facts/answers/serviceBrief';
import { outshedAnswer } from '@/lib/depot/copilot/facts/answers/outshed';
import { rankAnswer } from '@/lib/depot/copilot/facts/answers/rank';
import { answer, nameOf, unavailable } from '@/lib/depot/copilot/facts/answers/shared';
import { transfersAnswer } from '@/lib/depot/copilot/facts/answers/transfers';
import {
  scheduleShiftCoverAnswer,
  scheduleSummaryAnswer,
  scheduleUncoveredAnswer,
  schedulerSummaryAnswer,
  type SchedulePlanBody,
} from '@/lib/depot/copilot/facts/schedule';
import type { SchedulerRollupResponse } from '@/lib/depot/schedule/api';
import { breakdownSummaryAnswer, replacementForAnswer } from '@/lib/depot/copilot/facts/incident';
import type { IncidentView, IncidentsResponse } from '@/lib/depot/incident/api';
import { buildDepotBriefing } from '@/lib/depot/copilot/facts/depot';
import { buildNetworkBriefing } from '@/lib/depot/copilot/facts/network';
import { dataSourceOf } from '@/lib/depot/copilot/service/stale';
import type { CopilotRequest } from '@/lib/depot/copilot/types';
import type { CopilotDataSource } from '@/lib/depot/copilot/wire';
import type { CopilotNetworkHours, RouteHourlyBody } from '@/lib/depot/service/types';

/** The views a query may need. Only `network` is always present. */
export interface AnswerData {
  readonly network: DepotNetworkResponse;
  readonly details?: Readonly<Record<string, DepotDetailResponse>>;
  readonly distribution?: DepotDistributionResponse;
  /** The named route's day, for the route kinds. */
  readonly routeDay?: RouteHourlyBody;
  /** The network's day by band, for the hour and brief kinds. */
  readonly networkHours?: CopilotNetworkHours;
  /** A depot's schedule plan, by depot id, for the schedule kinds. */
  readonly schedule?: Readonly<Record<string, SchedulePlanBody>>;
  /** Every depot's plan rolled up, for the scheduler kind. */
  readonly scheduler?: SchedulerRollupResponse | null;
  /** A depot's suspected breakdowns, by depot id. */
  readonly incidents?: Readonly<Record<string, IncidentsResponse>>;
  /** The plan for one declared bus, when the question names one not in the suspected list. */
  readonly declaredIncident?: IncidentView | null;
}

const SCOPE_SENTENCE =
  'This assistant can answer questions about the whole fleet, a named depot, depot rankings, depots in deficit or surplus, proposed transfers, exceptions, comparisons between depots, departures from the yard, a named route at a given time of day or across its day, the routes short or in surplus in a band of the day, the service brief for today, the schedule plan of a depot, and the buses of a depot that may have a breakdown.';

type UnsupportedReason = Extract<CopilotQuery, { kind: 'unsupported' }>['reason'];

/**
 * What a supported question would be answered from, in the words the pages' provenance
 * line uses for each source: the saved sample and last-good data are never called live.
 */
const ANSWERED_FROM: Readonly<Record<CopilotDataSource | 'live', string>> = {
  live: 'the live data',
  sample: 'sample data',
  last_good: 'the last good data',
};

function unsupported(reason: UnsupportedReason, network: DepotNetworkResponse): CopilotRequest {
  if (reason === 'unknown_route') {
    return answer('an unsupported question', [], {
      headline: 'That route is not in the current feed',
      paragraphs: [
        'No route with that name is reporting in the current feed. The Routes page lists the routes the feed carries.',
      ],
    });
  }
  if (reason === 'ambiguous_depot') {
    return answer('an unsupported question', [], {
      headline: 'That depot name is not specific enough',
      paragraphs: ["That name matches several depots. The depot's full name would settle which depot is meant."],
    });
  }
  const offer = `A question on any topic above would be answered from ${
    ANSWERED_FROM[dataSourceOf(network) ?? 'live']
  }.`;
  const closing =
    reason === 'people' ? `Questions about people are outside that scope. ${offer}` : offer;
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
    case 'depotMeasure':
      return measureAnswer(data, query.depotId, query.measure);
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
    case 'routeHour':
      return routeHourAnswer(data.routeDay, query.hour);
    case 'routeProposals':
      return routeProposalsAnswer(data.routeDay);
    case 'hourProposals': {
      if (query.depotId === undefined) return hourProposalsAnswer(data.networkHours, query.hour);
      const name = nameOf(data, query.depotId);
      if (name === null) return unavailable('that depot');
      return hourProposalsAnswer(data.networkHours, query.hour, { id: query.depotId, name });
    }
    case 'serviceBrief':
      return serviceBriefAnswer(data.networkHours, query.date);
    case 'scheduleSummary':
      return scheduleSummaryAnswer(data.schedule?.[query.depotId]);
    case 'scheduleShiftCover':
      return scheduleShiftCoverAnswer(data.schedule?.[query.depotId]);
    case 'scheduleUncovered':
      return scheduleUncoveredAnswer(data.schedule?.[query.depotId]);
    case 'schedulerSummary':
      return schedulerSummaryAnswer(data.scheduler);
    case 'breakdownSummary':
      return breakdownSummaryAnswer(data.incidents?.[query.depotId]);
    case 'replacementFor': {
      const body = data.incidents?.[query.depotId];
      const key = query.registrationNumber.trim().toLowerCase();
      const found = body?.incidents.find((v) => v.incident.registrationNumber.toLowerCase() === key) ?? data.declaredIncident ?? null;
      return replacementForAnswer(found, body?.depotName ?? nameOf(data, query.depotId) ?? query.depotId, query.depotId);
    }
    case 'unsupported':
      return unsupported(query.reason, data.network);
  }
}
