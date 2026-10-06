import { formatCount } from '../format';
import type { DutyBoardResponse } from './api';
import { heldOutParts } from './dutyBoardModel';

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

export interface DutyFigure {
  readonly label: string;
  readonly value: string;
  readonly caption: string;
}

/** The band: duties, matched, unmatched, spare buses. All modelled, as the page is. */
export function dutyFigures(
  response: Pick<DutyBoardResponse, 'counts' | 'spareBuses'>,
): readonly DutyFigure[] {
  const { counts } = response;
  return [
    { label: 'Duties', value: formatCount(counts.duties), caption: 'in the modelled day' },
    { label: 'Matched', value: formatCount(counts.assigned), caption: 'a bus is proposed' },
    { label: 'Unmatched', value: formatCount(counts.unassigned), caption: 'no bus proposed' },
    {
      label: 'Spare buses',
      value: formatCount(response.spareBuses.length),
      caption:
        counts.assigned === 0 && response.spareBuses.length === 0
          ? 'none eligible'
          : 'eligible, no duty',
    },
  ];
}

/**
 * Why duties have no bus, said once above the chart as counts of the buses held out
 * of the matching: "No bus for 116 duties. Held out: 66 not in the yard · 8 off the
 * road · 34 dark." Null when every duty has a bus.
 */
export function unmatchedLine(
  response: Pick<DutyBoardResponse, 'counts' | 'eligibilityIgnoredLocation'>,
): string | null {
  const { unassigned, excluded } = response.counts;
  if (unassigned <= 0) return null;
  const head = `No bus for ${formatCount(unassigned)} ${plural(unassigned, 'duty', 'duties')}.`;
  const parts = heldOutParts(excluded, response.eligibilityIgnoredLocation === true);
  if (parts.length === 0) return `${head} Every eligible bus of the class is on another duty.`;
  return `${head} Held out of the matching: ${parts.join(' · ')}.`;
}

/** The server ignored location because no yard is established; said in one sentence. */
export function locationIgnoredSentence(ignored: boolean | undefined): string | null {
  return ignored
    ? 'No yard is established for this depot, so location was not used: every standing bus heard in the last 30 minutes was eligible.'
    : null;
}

export function duplicateRowsSentence(dropped: number | undefined): string | null {
  if (!dropped || dropped <= 0) return null;
  return `${formatCount(dropped)} feed ${plural(dropped, 'row repeated a registration and was', 'rows repeated a registration and were')} left out.`;
}
