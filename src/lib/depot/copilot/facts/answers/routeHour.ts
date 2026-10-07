import { cleanName, ph } from '@/lib/depot/copilot/facts/format';
import { answer, unavailable } from '@/lib/depot/copilot/facts/answers/shared';
import {
  gapSide,
  proposalAt,
  proposalLineFact,
  routeHourFacts,
  routeNameFact,
} from '@/lib/depot/copilot/facts/routeDay';
import {
  DEMAND_NOTE,
  MAYBE_COVERED,
  RECOMMENDATION_ONLY,
  TIER_WORDS,
} from '@/lib/depot/copilot/facts/serviceText';
import type { CopilotRequest } from '@/lib/depot/copilot/types';
import type { HourBasis, RouteHourFigures, RouteHourlyBody } from '@/lib/depot/service/types';

const ROUTE = ph('route.name');
const SPAN = ph('hour.span');

/** Where the deployed figure comes from, said once after it. */
const DEPLOYED_SENTENCE: Readonly<Record<HourBasis, string>> = {
  observed: `At ${SPAN}, ${ROUTE} had ${ph('hour.deployed')} running. That figure comes from what this server observed in the feed.`,
  current: `At ${SPAN}, ${ROUTE} has ${ph('hour.deployed')} running. That figure is from the latest feed snapshot.`,
  modelled: `At ${SPAN}, ${ROUTE} has ${ph('hour.deployed')} running on the modelled plan. This server did not observe the feed at that time.`,
};

function supplySentences(figures: RouteHourFigures): string {
  const scheduled =
    figures.scheduled === null
      ? 'No scheduled trip is known for that time.'
      : `Scheduled on the timetable known so far: ${ph('hour.scheduled')}.`;
  return `${scheduled} Modelled passengers at that time: ${ph('hour.demand')}. Needed on modelled passenger demand: ${ph('hour.needed')}.`;
}

const GAP_SENTENCE: Readonly<Record<ReturnType<typeof gapSide>, string>> = {
  short: `On these figures ${ROUTE} is short by ${ph('hour.gap')}.`,
  over: `On these figures ${ROUTE} holds a surplus of ${ph('hour.gap')}.`,
  level: `On these figures ${ROUTE} runs level with its need.`,
};

/** One route at one hour: what ran, what was scheduled, what was needed, the gap and the band's proposal. */
export function routeHourAnswer(body: RouteHourlyBody | undefined, hour: number): CopilotRequest {
  const figures = body?.hours.find((h) => h.hour === hour);
  if (body === undefined || figures === undefined) return unavailable('that route');
  const proposal = proposalAt(body, hour);
  const facts = [
    routeNameFact(body),
    ...routeHourFacts(figures),
    ...(proposal ? [proposalLineFact(proposal, 'p.line', 'Proposal')] : []),
  ];
  const proposalSentences = proposal
    ? [
        `The plan holds a proposal for that time: ${ph('p.line')}.`,
        TIER_WORDS[proposal.tier],
        ...(proposal.maybeCoveredByUnrouted ? [MAYBE_COVERED] : []),
        RECOMMENDATION_ONLY,
      ].join(' ')
    : 'No proposal covers that time.';
  return answer(cleanName(body.routeName), facts, {
    headline: `${ROUTE} at ${SPAN}`,
    paragraphs: [
      DEPLOYED_SENTENCE[figures.deployedBasis],
      supplySentences(figures),
      GAP_SENTENCE[gapSide(figures.gap)],
      proposalSentences,
      DEMAND_NOTE,
    ],
  });
}
