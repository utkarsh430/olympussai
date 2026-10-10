import { cleanName, nameFact, ph } from '@/lib/depot/copilot/facts/format';
import { answer, unavailable } from '@/lib/depot/copilot/facts/answers/shared';
import {
  MAX_BAND_PROPOSALS,
  MAX_BAND_ROUTES,
  bandAt,
  bandFacts,
  bandProposalFacts,
  bandProposals,
  bandSubset,
} from '@/lib/depot/copilot/facts/networkHours';
import { DEMAND_NOTE, RECOMMENDATION_ONLY } from '@/lib/depot/copilot/facts/serviceText';
import type { CopilotRequest } from '@/lib/depot/copilot/types';
import type { CopilotBandSummary, CopilotNetworkHours } from '@/lib/depot/service/types';

/** The band's route counts and bus totals, in two sentences with no figure in the prose. */
export function bandCountSentences(): string {
  return (
    `Routes short in this band: ${ph('band.short_routes')}; buses short across them: ${ph('band.buses_short')}. ` +
    `Routes in surplus: ${ph('band.over_routes')}; buses in surplus across them: ${ph('band.buses_over')}.`
  );
}

function routeList(band: CopilotBandSummary): string | null {
  const list = (prefix: 'short' | 'over', count: number, words: string): string =>
    Array.from({ length: Math.min(count, MAX_BAND_ROUTES) }, (_, i) =>
      `${ph(`${prefix}.${i + 1}.name`)}, ${words} ${ph(`${prefix}.${i + 1}.gap`)}`,
    ).join('; ');
  const parts = [
    ...(band.shortRoutes.length > 0 ? [`Shortest: ${list('short', band.shortRoutes.length, 'short by')}.`] : []),
    ...(band.overRoutes.length > 0
      ? [`Largest surplus: ${list('over', band.overRoutes.length, 'in surplus by')}.`]
      : []),
  ];
  return parts.length === 0 ? null : parts.join(' ');
}

function proposalSentence(count: number): string {
  if (count === 0) return 'No proposal in the plan covers this band.';
  const lines = Array.from({ length: Math.min(count, MAX_BAND_PROPOSALS) }, (_, i) =>
    ph(`band.p.${i + 1}`),
  ).join('; ');
  return `Proposals in the plan for this band: ${lines}. ${RECOMMENDATION_ONLY}`;
}

const NO_BAND = answer('an hour outside the bands', [], {
  headline: 'No band covers that time',
  paragraphs: ['The plan groups the day into bands from early to late; that time falls outside them.'],
});

/**
 * The network's short and over-served routes in the band that holds the hour, optionally
 * one depot's, with the band's proposals. `depotName` is the depot's name when one is asked.
 */
export function hourProposalsAnswer(
  body: CopilotNetworkHours | undefined,
  hour: number,
  depot?: { readonly id: string; readonly name: string },
): CopilotRequest {
  if (body === undefined) return unavailable('the service by band');
  const whole = bandAt(body, hour);
  if (whole === undefined) return NO_BAND;
  const band = bandSubset(whole, depot?.id);
  const proposals = bandProposals(body, whole, depot?.id);
  const facts = [
    ...(depot ? [nameFact('depot.name', 'Depot', cleanName(depot.name), 'live')] : []),
    ...bandFacts(band),
    ...bandProposalFacts(proposals),
  ];
  const routes = routeList(band);
  return answer(depot ? cleanName(depot.name) : 'the whole fleet', facts, {
    headline: depot
      ? `Routes of ${ph('depot.name')} short and in surplus: ${ph('band.label')}`
      : `Routes short and in surplus: ${ph('band.label')}`,
    paragraphs: [
      bandCountSentences(),
      ...(routes === null ? [] : [routes]),
      proposalSentence(proposals.length),
      DEMAND_NOTE,
    ],
  });
}
