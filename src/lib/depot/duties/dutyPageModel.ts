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
 * A duty is left without a bus only once every eligible bus has one, so when no duty has
 * a bus no bus was eligible, and the line says so (review m-e). Class is a preference,
 * not a bar, so no class is named. Null when every duty has a bus.
 */
export function unmatchedLine(
  response: Pick<DutyBoardResponse, 'counts' | 'eligibilityIgnoredLocation'>,
): string | null {
  const { unassigned, assigned, excluded } = response.counts;
  if (unassigned <= 0) return null;
  const parts = heldOutParts(excluded, response.eligibilityIgnoredLocation === true);
  const lead = `No bus for ${formatCount(unassigned)} ${plural(unassigned, 'duty', 'duties')}:`;
  const held = parts.length === 0 ? '' : ` Held out of the matching: ${parts.join(' · ')}.`;
  if (assigned > 0) return `${lead} every eligible bus has another duty.${held}`;
  return parts.length === 0
    ? `${lead} the feed shows no bus for this depot.`
    : `${lead} no bus is eligible.${held}`;
}

/**
 * The server ignored location because no yard is established. Recency still applies
 * unless the feed has no clock (`recencyNotJudged`), when it is not claimed. A bus out
 * on the road is eligible as much as a standing one, so both are named (review m2).
 */
export function locationIgnoredSentence(
  ignored: boolean | undefined,
  recencyNotJudged: boolean | undefined,
): string | null {
  if (ignored !== true) return null;
  const who =
    recencyNotJudged === true
      ? 'every bus'
      : `every bus heard in the last ${REPORTING_WINDOW_MIN} minutes`;
  return (
    `No yard is established for this depot, so location is not used: ${who} that is not ` +
    'off the road or dark is eligible, standing or out on the road.'
  );
}

const BEFORE_FIRST_DUTY_YARD =
  'Before the first departure: buses in the yard are matched to the earliest duties; buses still out take the ones after.';
const BEFORE_FIRST_DUTY_NO_YARD =
  'Before the first departure: standing buses are matched to the earliest duties; buses still out take the ones after.';
const RECENCY_AND_YARD =
  `A bus not heard in the last ${REPORTING_WINDOW_MIN} minutes is held out of the matching, ` +
  'moving or standing; a standing bus must also be in the yard.';
const YARD_ONLY = 'A standing bus must be in the yard to be eligible.';

type EligibilityContext = Pick<
  DutyBoardResponse,
  'eligibilityIgnoredLocation' | 'recencyNotJudged' | 'planMode'
>;

/**
 * How eligibility was judged, true for the plan's mode, the feed clock and the yard
 * (rulings S55, S62b). Before the first duty the yard buses take the earliest duties,
 * said first; eligibility is then judged as on the feed clock. With no clock no
 * recency window is claimed (review m-d); with no yard location is not claimed.
 */
export function eligibilityNotes(response: EligibilityContext): readonly string[] {
  const noYard = response.eligibilityIgnoredLocation === true;
  const mode =
    response.planMode === 'before_first_duty'
      ? [noYard ? BEFORE_FIRST_DUTY_NO_YARD : BEFORE_FIRST_DUTY_YARD]
      : [];
  const noClock = response.recencyNotJudged === true;
  const location = noYard ? locationIgnoredSentence(true, noClock) : null;
  if (!noClock) return [...mode, location ?? RECENCY_AND_YARD];
  return [...mode, recencySentence(true), location ?? YARD_ONLY].filter(
    (note): note is string => note !== null,
  );
}

/** The notes said once above the chart: why duties have no bus, and how eligibility was judged. */
export function matchingNotes(
  response: Pick<DutyBoardResponse, 'counts'> & EligibilityContext,
): readonly string[] {
  const unmatched = unmatchedLine(response);
  return [...(unmatched === null ? [] : [unmatched]), ...eligibilityNotes(response)];
}

export function duplicateRowsSentence(dropped: number | undefined): string | null {
  if (!dropped || dropped <= 0) return null;
  return `${formatCount(dropped)} feed ${plural(dropped, 'row repeated a registration and was', 'rows repeated a registration and were')} left out.`;
}
