import { ph } from '@/lib/depot/copilot/facts/format';
import { bandCountSentences } from '@/lib/depot/copilot/facts/answers/hourProposals';
import { answer, unavailable } from '@/lib/depot/copilot/facts/answers/shared';
import {
  MAX_BAND_PROPOSALS,
  bandAt,
  bandFacts,
  briefDayFacts,
  briefProposalFacts,
} from '@/lib/depot/copilot/facts/networkHours';
import { DEMAND_NOTE, RECOMMENDATION_ONLY } from '@/lib/depot/copilot/facts/serviceText';
import type { CopilotRequest } from '@/lib/depot/copilot/types';
import type { CopilotBandSummary, CopilotNetworkHours } from '@/lib/depot/service/types';

/** Without a feed clock the brief looks at the morning peak, the day's first demanding band. */
function bandInFocus(body: CopilotNetworkHours): CopilotBandSummary | undefined {
  const now = body.currentHour === null ? undefined : bandAt(body, body.currentHour);
  return now ?? body.bands.find((b) => b.key === 'morning_peak') ?? body.bands[0];
}

function observedSentence(body: CopilotNetworkHours): string {
  return body.observed === null
    ? 'This server has not yet observed the feed today, so the deployed figures come from the modelled plan.'
    : `This server has observed the feed since ${ph('brief.observed_since')}.`;
}

function proposalSentence(count: number): string {
  if (count === 0) return `No proposal is made across all depots today. ${RECOMMENDATION_ONLY}`;
  const lines = Array.from({ length: Math.min(count, MAX_BAND_PROPOSALS) }, (_, i) =>
    ph(`brief.p.${i + 1}`),
  ).join('; ');
  return `Leading proposals by modelled passengers carried: ${lines}. ${RECOMMENDATION_ONLY}`;
}

const DECISIONS = `Proposals accepted: ${ph('brief.accepted')}; declined: ${ph('brief.declined')}; still open: ${ph('brief.open')}.`;

const OTHER_DATE = answer('the service brief', [], {
  headline: 'That date is not available',
  paragraphs: ['The brief covers the current operating date of the feed only.'],
});

/**
 * The daily brief: what was observed, the band in focus (short and over-served routes),
 * the reallocation's moves, the leading proposals by modelled passengers, and the
 * decisions recorded when a trail exists. Every figure is a placeholder.
 */
export function serviceBriefAnswer(body: CopilotNetworkHours | undefined, date?: string): CopilotRequest {
  if (body === undefined) return unavailable('the service brief');
  if (date !== undefined && date !== body.operatingDate) return OTHER_DATE;
  const band = bandInFocus(body);
  const facts = [
    ...briefDayFacts(body),
    ...(band ? bandFacts(band) : []),
    ...briefProposalFacts(body),
  ];
  const focus = band ? `Band in focus: ${ph('band.label')}. ${bandCountSentences()}` : null;
  const moves = `Moves in the plan within depots: ${ph('brief.moves_within')}; between depots: ${ph('brief.moves_between')}.`;
  return answer('the service brief', facts, {
    headline: `Service brief: ${ph('brief.date')}`,
    paragraphs: [
      observedSentence(body),
      ...(focus === null ? [] : [focus]),
      moves,
      proposalSentence(body.proposals.length),
      body.decisions === null ? DEMAND_NOTE : `${DECISIONS} ${DEMAND_NOTE}`,
    ],
  });
}
