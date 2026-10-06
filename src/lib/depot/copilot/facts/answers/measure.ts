import type { DepotDetailResponse } from '@/lib/depot/api';
import type { AnswerData } from '@/lib/depot/copilot/facts/answers';
import { answer, unavailable } from '@/lib/depot/copilot/facts/answers/shared';
import { depotDraft, depotFacts } from '@/lib/depot/copilot/facts/depot';
import {
  busCount,
  cleanName,
  countPhrase,
  makeFact,
  onRoadCount,
  ph,
} from '@/lib/depot/copilot/facts/format';
import { MAX_PROVIDER_PARAGRAPHS } from '@/lib/depot/copilot/limits';
import type { DepotMeasure } from '@/lib/depot/copilot/queries';
import type { CopilotFact, CopilotRequest } from '@/lib/depot/copilot/types';

/**
 * The answer to one measure at one depot. The measure's figure comes
 * first, in its own paragraph; the depot's briefing follows as evidence. A
 * measure the snapshot does not establish (no yard, not ranked) leads with the
 * briefing paragraph that says so, never with a guess.
 */

const NO_YARD = 'No yard is established for this depot, so yard occupancy is not described here.';

interface MeasureWording {
  readonly headline: string;
  /** The figure sentence, or null when the snapshot does not establish the measure. */
  readonly sentence: (detail: DepotDetailResponse) => string | null;
}

const name = ph('depot.name');
const verb = (n: number, phrase: string): string =>
  countPhrase(n, `is ${phrase}`, `are ${phrase}`);
const ranked = (detail: DepotDetailResponse): boolean =>
  detail.score?.ranked === true && detail.score.index !== null && detail.score.rank !== null;

const WORDING: Readonly<Record<DepotMeasure, MeasureWording>> = {
  dark: {
    headline: `Dark buses at ${name}`,
    sentence: ({ depot }) =>
      `At ${name}, ${ph('depot.dark')} ${verb(depot.states.dark, 'dark')} (${ph('depot.dark_share')}).`,
  },
  offRoad: {
    headline: `Buses off the road at ${name}`,
    sentence: ({ depot }) =>
      `At ${name}, ${ph('depot.off_road')} ${verb(depot.states.offRoad, 'off the road')} (${ph('depot.off_road_share')}).`,
  },
  powerCut: {
    headline: `Main power at ${name}`,
    sentence: () => `At ${name}, main power reads off on ${ph('depot.power_cut')}.`,
  },
  inYard: {
    headline: `The yard at ${name}`,
    sentence: (detail) =>
      detail.yard.value ? `At ${name}, the yard currently holds ${ph('depot.in_yard')}.` : NO_YARD,
  },
  onRoad: {
    headline: `Buses on the road at ${name}`,
    sentence: ({ depot }) =>
      `At ${name}, ${ph('depot.on_road')} ${verb(onRoadCount(depot.states), 'on the road')} (${ph('depot.on_road_share')}).`,
  },
  standing: {
    headline: `Standing buses at ${name}`,
    sentence: () => `Buses standing here: ${ph('depot.standing')}.`,
  },
  fleet: {
    headline: `The fleet of ${name}`,
    sentence: () => `${name} has a fleet of ${ph('depot.fleet')}.`,
  },
  index: {
    headline: `Efficiency index of ${name}`,
    sentence: (detail) =>
      ranked(detail)
        ? `${name} stands at efficiency ${ph('depot.index')} and ${ph('depot.rank')} among ${ph('depot.peer_group')}.`
        : null,
  },
  rank: {
    headline: `Peer rank of ${name}`,
    sentence: (detail) =>
      ranked(detail)
        ? `${name} holds ${ph('depot.rank')} among ${ph('depot.peer_group')}, at efficiency ${ph('depot.index')}.`
        : null,
  },
  visitors: {
    headline: `Visiting buses at ${name}`,
    sentence: (detail) =>
      detail.yard.value
        ? `Visitors from other depots in the yard: ${ph('depot.visitors')}.`
        : NO_YARD,
  },
};

/** The briefing's facts plus the two a measure may need that the briefing leaves out. */
function measureFacts(detail: DepotDetailResponse): CopilotFact[] {
  const facts = depotFacts(detail);
  const extra = [makeFact('depot.standing', 'Standing', busCount(detail.depot.states.standing), 'derived')];
  if (detail.yard.value && !facts.some((f) => f.id === 'depot.visitors')) {
    extra.push(makeFact('depot.visitors', 'Visitors', busCount(detail.visitors.length), 'derived'));
  }
  return [...facts, ...extra];
}

export function measureAnswer(
  data: AnswerData,
  depotId: string,
  measure: DepotMeasure,
): CopilotRequest {
  const detail = data.details?.[depotId];
  if (!detail) return unavailable('that depot');
  const wording = WORDING[measure];
  const lead = wording.sentence(detail);
  const evidence = depotDraft(detail).paragraphs.filter((p) => p !== lead);
  return answer(cleanName(detail.depot.name), measureFacts(detail), {
    headline: wording.headline,
    paragraphs: [...(lead === null ? [] : [lead]), ...evidence].slice(0, MAX_PROVIDER_PARAGRAPHS),
  });
}
