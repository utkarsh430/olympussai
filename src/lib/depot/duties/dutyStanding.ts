import { formatCount } from '../format';
import type { MixedDescription } from '../provenanceLine';
import type { ServiceClass } from '../sim/types';
import type { BoardDuty, DutyBoardCounts } from './api';
import type { BusStandingNow } from './types';

/*
 * The duty page's words for how a matched bus stands now, its
 * service classes, its band captions and its header. Each value is worded once here.
 */

/** The page's one header sentence: the matching is a recommendation. */
export const DUTIES_DESCRIPTION =
  "The day's duties and the bus matched to each; nothing is assigned or dispatched.";

/**
 * How a matched bus stands now. "Standing in the yard", never "in the yard" alone:
 * only standing buses are meant. `standing` is a bus standing where the depot has
 * no yard established, so where it stands is not judged; its words are no longer than
 * the others', because a table cell never wraps and the column must hold them at 1024 px.
 */
export const STANDING_WORD: Readonly<Record<BusStandingNow, string>> = {
  on_road: 'On the road',
  in_yard: 'Standing in the yard',
  standing: 'Standing, no yard',
};

export const CLASS_WORD: Readonly<Record<ServiceClass, string>> = {
  ordinary: 'Ordinary',
  express: 'Express',
  ac: 'AC',
  premium: 'Premium',
};

/**
 * The bus's class, only where it differs from the duty's: class is a preference in
 * the matching, not a bar, so a bus of another class may take a duty.
 */
export function busClassWord(duty: Pick<BoardDuty, 'serviceClass' | 'busClass'>): string | null {
  const busClass = duty.busClass ?? null;
  return busClass === null || busClass === duty.serviceClass ? null : CLASS_WORD[busClass];
}

const CAPTION_PLACE: Readonly<Record<BusStandingNow, string>> = {
  on_road: 'on the road',
  in_yard: 'from the yard',
  standing: 'standing, no yard',
};
const CAPTION_ORDER: readonly BusStandingNow[] = ['on_road', 'in_yard', 'standing'];

/** The Matched figure's caption: the matched duties by where their bus stands now. */
export function matchedCaption(
  duties: readonly Pick<BoardDuty, 'registrationNumber' | 'busStanding'>[],
): string {
  const matched = duties.filter((d) => d.registrationNumber !== null);
  if (matched.length === 0) return 'no bus matched';
  const parts = CAPTION_ORDER.map((place) => ({
    place,
    n: matched.filter((d) => d.busStanding === place).length,
  })).filter((p) => p.n > 0);
  if (parts.length === 0) return 'a bus is proposed';
  return parts.map((p) => `${formatCount(p.n)} ${CAPTION_PLACE[p.place]}`).join(', ');
}

/** The Spare figure's caption, from `counts.spareByStanding`; no place without it. */
export function spareCaption(
  counts: Pick<DutyBoardCounts, 'assigned' | 'spare' | 'spareByStanding'>,
): string {
  if (counts.spare === 0) {
    return counts.assigned === 0 ? 'none eligible' : 'every eligible bus matched';
  }
  const split = counts.spareByStanding;
  if (split === undefined) return 'eligible, no duty';
  const parts = [
    split.inYard > 0 ? `${formatCount(split.inYard)} in the yard` : null,
    split.onRoad > 0 ? `${formatCount(split.onRoad)} on the road` : null,
    split.standing > 0 ? `${formatCount(split.standing)} standing, no yard` : null,
  ].filter((p): p is string => p !== null);
  return parts.length === 0 ? 'eligible, no duty' : parts.join(', ');
}

/** Said once above the chart when the feed has no clock (`recencyNotJudged`). */
export function recencySentence(notJudged: boolean | undefined): string | null {
  return notJudged === true
    ? 'The feed has no clock, so no bus could be judged by how recently it was heard.'
    : null;
}

/**
 * The page default: bus states are derived from the live feed; the duties and the
 * matching are modelled. The dated modelled-day sentence rides in the line's extension.
 */
export function dutyProvenance(modelledDay: string | undefined): MixedDescription {
  const base = {
    default: 'mixed' as const,
    derived: 'Bus states',
    modelled: 'duties and the matching',
  };
  return modelledDay === undefined ? base : { ...base, modelledDay };
}
