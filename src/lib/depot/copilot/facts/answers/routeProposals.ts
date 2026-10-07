import { cleanName, ph } from '@/lib/depot/copilot/facts/format';
import { answer, unavailable } from '@/lib/depot/copilot/facts/answers/shared';
import {
  MAX_ROUTE_PROPOSALS,
  routeDayFacts,
  routeNameFact,
} from '@/lib/depot/copilot/facts/routeDay';
import { DEMAND_NOTE, RECOMMENDATION_ONLY } from '@/lib/depot/copilot/facts/serviceText';
import type { CopilotFact, CopilotRequest } from '@/lib/depot/copilot/types';
import type { RouteHourlyBody } from '@/lib/depot/service/types';

const ROUTE = ph('route.name');

function observedSentence(body: RouteHourlyBody): string {
  return body.observed === null
    ? 'This server has not observed this route today, so its deployed figures come from the modelled plan.'
    : `This server has observed the feed since ${ph('day.observed_since')}.`;
}

function gapSentences(facts: readonly CopilotFact[]): string {
  const day = `On modelled passenger demand, ${ROUTE} is short for ${ph('day.short_hours')}; it holds a surplus for ${ph('day.over_hours')}.`;
  return facts.some((f) => f.id === 'day.peak_hour')
    ? `${day} The largest gap is at ${ph('day.peak_hour')}; there it is short by ${ph('day.peak_gap')}.`
    : day;
}

function proposalSentences(body: RouteHourlyBody): string {
  const shown = body.proposals.slice(0, MAX_ROUTE_PROPOSALS);
  if (shown.length === 0) return 'No proposal is made for this route today.';
  const lines = shown.map((_, i) => ph(`p.${i + 1}.line`)).join('; ');
  const more =
    body.proposals.length > shown.length
      ? ` These are the leading entries; the plan holds ${ph('p.total')}.`
      : '';
  return `Proposals in the plan: ${lines}.${more} ${RECOMMENDATION_ONLY}`;
}

/** One route's day so far: hours short and in surplus, the largest gap, and its proposals. */
export function routeProposalsAnswer(body: RouteHourlyBody | undefined): CopilotRequest {
  if (body === undefined) return unavailable('that route');
  const facts = [routeNameFact(body), ...routeDayFacts(body)];
  return answer(cleanName(body.routeName), facts, {
    headline: `The day of ${ROUTE}`,
    paragraphs: [observedSentence(body), gapSentences(facts), proposalSentences(body), DEMAND_NOTE],
  });
}
