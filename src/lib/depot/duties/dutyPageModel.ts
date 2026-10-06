import { formatCount } from '../format';
import { REPORTING_WINDOW_MIN } from '../infer/thresholds';
import type { DutyBoardResponse } from './api';
import { heldOutParts } from './dutyBoardModel';
import { matchedCaption, recencySentence, spareCaption } from './dutyStanding';

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

export interface DutyFigure {
  readonly label: string;
  readonly value: string;
  readonly caption: string;
}

/**
 * The band: duties, matched, unmatched, spare buses. Under the MODELLED timeline label.
 * The matched caption splits by how the bus stands now; the spare caption by
 * `counts.spareByStanding`, so the spare buses are never all called "in the yard".
 */
export function dutyFigures(
  response: Pick<DutyBoardResponse, 'counts' | 'duties'>,
): readonly DutyFigure[] {
  const { counts } = response;
  return [
    { label: 'Duties', value: formatCount(counts.duties), caption: 'in the modelled day' },
    { label: 'Matched', value: formatCount(counts.assigned), caption: matchedCaption(response.duties) },
    { label: 'Unmatched', value: formatCount(counts.unassigned), caption: 'no bus' },
    { label: 'Spare buses', value: formatCount(counts.spare), caption: spareCaption(counts) },
  ];
}

/**
 * Why duties have no bus, said once above the chart, as counts by reason of the buses
 * held out of the matching, of every class (ruling S55): "No bus for 116 duties: every
 * eligible bus has another duty. Held out of the matching: 12 not heard recently · …".
 * Class is a preference, not a bar, so no class is named. Null when every duty has a bus.
 */
export function unmatchedLine(
  response: Pick<DutyBoardResponse, 'counts' | 'eligibilityIgnoredLocation'>,
): string | null {
  const { unassigned, excluded } = response.counts;
  if (unassigned <= 0) return null;
  const head =
    `No bus for ${formatCount(unassigned)} ${plural(unassigned, 'duty', 'duties')}: ` +
    'every eligible bus has another duty.';
  const parts = heldOutParts(excluded, response.eligibilityIgnoredLocation === true);
  return parts.length === 0 ? head : `${head} Held out of the matching: ${parts.join(' · ')}.`;
}

/**
 * The server ignored location because no yard is established. Recency still applies
 * unless the feed has no clock (`recencyNotJudged`), when it is not claimed.
 */
export function locationIgnoredSentence(
  ignored: boolean | undefined,
  recencyNotJudged: boolean | undefined,
): string | null {
  if (ignored !== true) return null;
  const who =
    recencyNotJudged === true
      ? 'every standing bus'
      : `every standing bus heard in the last ${REPORTING_WINDOW_MIN} minutes`;
  return `No yard is established for this depot, so location is not used: ${who} is eligible.`;
}

/** The notes said once above the chart: why duties have no bus, and how eligibility was judged. */
export function matchingNotes(
  response: Pick<
    DutyBoardResponse,
    'counts' | 'eligibilityIgnoredLocation' | 'recencyNotJudged'
  >,
): readonly string[] {
  return [
    unmatchedLine(response),
    locationIgnoredSentence(response.eligibilityIgnoredLocation, response.recencyNotJudged),
    recencySentence(response.recencyNotJudged),
  ].filter((note): note is string => note !== null);
}

export function duplicateRowsSentence(dropped: number | undefined): string | null {
  if (!dropped || dropped <= 0) return null;
  return `${formatCount(dropped)} feed ${plural(dropped, 'row repeated a registration and was', 'rows repeated a registration and were')} left out.`;
}
