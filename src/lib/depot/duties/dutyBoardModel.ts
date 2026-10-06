import { formatCount, formatFeedTime } from '../format';
import { modelledDaySentence, type ModelledDayReference } from '../sim/operatingDayWording';
import type { BoardDuty, DutyBlockers, DutyBoardCounts, DutyState } from './api';
import type { SpareByStanding } from './types';

/** The timeline axis: 04:00 to 24:00 in the feed's local time. */
export const AXIS_START_MIN = 240;
export const AXIS_END_MIN = 1440;
const AXIS_SPAN_MIN = AXIS_END_MIN - AXIS_START_MIN;
const TICK_EVERY_MIN = 120;
const MIN_BAR_WIDTH_PCT = 0.8;
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 1440;
const PERCENT = 100;

export const MODEL_NOTICE =
  'Duties are a model until a timetable is supplied, and their lengths are generated, not timetabled. The matching of buses to duties is a recommendation: nothing is assigned or dispatched.';

/** Wording follows `assignDuties`: cost is age in years x duty hours; classes never mix. */
export const COST_SENTENCE =
  'The matching minimises total wear: a bus costs its age in years times the duty length in whole hours, so longer duties go to younger buses. A bus is never matched to a duty of another service class.';

export const STATE_WORD: Readonly<Record<DutyState, string>> = {
  assigned: 'Assigned',
  no_bus: 'Unmatched',
  bus_not_in_yard: 'Unmatched',
};

export interface BarGeometry {
  /** Offset from the axis start, percent of the axis. */
  readonly leftPct: number;
  readonly widthPct: number;
  readonly startsBeforeAxis: boolean;
  readonly endsAfterAxis: boolean;
}

export interface AxisTick {
  readonly label: string;
  readonly leftPct: number;
}

export interface BoardRow {
  readonly id: string;
  readonly routeName: string;
  readonly serviceClass: string;
  /** Minutes from midnight; the end may pass 1440. */
  readonly startMin: number;
  readonly endMin: number;
  readonly timeText: string;
  readonly registrationNumber: string | null;
  readonly state: DutyState;
  readonly stateWord: string;
  /** Why an unassigned duty has no bus; null when assigned. */
  readonly reason: string | null;
  readonly geometry: BarGeometry;
  /** The text equivalent of the bar. */
  readonly ariaLabel: string;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** HH:MM for a minute count; a minute past 24:00 is written on the next day. */
export function formatMinute(minute: number): string {
  const nextDay = minute >= MINUTES_PER_DAY;
  const inDay = nextDay ? minute - MINUTES_PER_DAY : minute;
  const text = `${pad2(Math.floor(inDay / MINUTES_PER_HOUR))}:${pad2(inDay % MINUTES_PER_HOUR)}`;
  return nextDay ? `${text} next day` : text;
}

// Multiply before dividing so whole-minute offsets give clean percentages (30, not 30.000000000000004).
const pctOfAxis = (minute: number): number => ((minute - AXIS_START_MIN) * PERCENT) / AXIS_SPAN_MIN;

/** Ticks every two hours, from 04:00 to 24:00. */
export function axisTicks(): readonly AxisTick[] {
  const ticks: AxisTick[] = [];
  for (let m = AXIS_START_MIN; m <= AXIS_END_MIN; m += TICK_EVERY_MIN) {
    ticks.push({
      label: `${pad2(Math.floor(m / MINUTES_PER_HOUR))}:${pad2(m % MINUTES_PER_HOUR)}`,
      leftPct: pctOfAxis(m),
    });
  }
  return ticks;
}

/**
 * Where a bar sits on the axis. Anything beyond the axis is clipped to it and
 * flagged, so a duty past midnight stops at 24:00 and says it goes on. A bar is
 * never thinner than a visible sliver, and never pokes out of the axis.
 */
export function barGeometry(startMin: number, endMin: number): BarGeometry {
  const startsBeforeAxis = startMin < AXIS_START_MIN;
  const endsAfterAxis = endMin > AXIS_END_MIN;
  const clippedStart = Math.min(Math.max(startMin, AXIS_START_MIN), AXIS_END_MIN);
  const clippedEnd = Math.min(Math.max(endMin, AXIS_START_MIN), AXIS_END_MIN);
  // Widths are measured in minutes first so exact fractions stay exact.
  const widthPct = Math.max(
    ((clippedEnd - clippedStart) * PERCENT) / AXIS_SPAN_MIN,
    MIN_BAR_WIDTH_PCT,
  );
  const leftPct = Math.min(pctOfAxis(clippedStart), PERCENT - widthPct);
  return { leftPct, widthPct, startsBeforeAxis, endsAfterAxis };
}

/**
 * Minutes from midnight read off the feed's clock digits. The digits are Indian
 * time (upstream stamps IST with a misleading `Z`), so there is no zone shift;
 * `formatFeedTime` owns that rule and its pattern, and is reused here.
 */
function feedMinutes(feedNow: string | null): number | null {
  const text = formatFeedTime(feedNow);
  const [hour, minute] = text.split(':').map(Number);
  if (hour === undefined || minute === undefined || Number.isNaN(hour)) return null;
  return hour * MINUTES_PER_HOUR + minute;
}

/** The now line's offset on the axis, or null when there is no clock or it is off the axis. */
export function nowLinePct(feedNow: string | null): number | null {
  const minutes = feedMinutes(feedNow);
  if (minutes === null || minutes < AXIS_START_MIN || minutes > AXIS_END_MIN) return null;
  return pctOfAxis(minutes);
}

export function nowSentence(feedNow: string | null): string {
  const minutes = feedMinutes(feedNow);
  if (minutes === null) return 'The feed has no clock, so there is no now line.';
  const base = `Now ${formatMinute(minutes)}, the feed clock in Indian time`;
  return minutes < AXIS_START_MIN
    ? `${base}; it is before the 04:00 start of the axis.`
    : `${base}.`;
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/**
 * Why no bus is spare, from the number of duties given a bus. Both sentences
 * below read it, so one cannot say "every eligible bus has a duty" while the
 * other says the matching proposed none. Null when that number is not known.
 */
function noSpareReason(assigned: number | null): string | null {
  if (assigned === null) return null;
  return assigned === 0 ? 'no bus is eligible for a duty' : 'every eligible bus has a duty';
}

export function summarySentence(counts: DutyBoardCounts): string {
  const some = `${formatCount(counts.spare)} ${plural(counts.spare, 'bus is', 'buses are')} spare`;
  const none = counts.assigned === 0 ? 'no bus is eligible, so none is spare' : 'no bus is spare';
  const spare = counts.spare > 0 ? some : none;
  return (
    `MODELLED: ${formatCount(counts.duties)} ${plural(counts.duties, 'duty', 'duties')}. ` +
    `The matching proposes a bus for ${formatCount(counts.assigned)} and leaves ` +
    `${formatCount(counts.unassigned)} without one; ${spare}.`
  );
}

export function emptyDutiesSentence(input: {
  readonly routeCount: number;
  readonly peakRequirement: number;
}): string {
  // The shared "no duties" sentence (crossReferenceSentence) says that there are none;
  // this says only why, so an empty board never carries two "no duties" sentences.
  if (input.routeCount === 0) {
    return 'None of its buses reports a route in the live feed, so there is nothing to run a duty on.';
  }
  return 'The modelled peak requirement is zero buses.';
}

export function routesWithoutDutySentence(routes: readonly string[]): string | null {
  if (routes.length === 0) return null;
  return (
    'The modelled requirement is smaller than the number of routes, so ' +
    `${formatCount(routes.length)} ${plural(routes.length, 'route has', 'routes have')} no duty: ` +
    `${routes.join(', ')}.`
  );
}

/** What the footer needs beside the spare list: both come from the same response. */
export interface SpareContext {
  /** `counts.assigned`: duties the matching gave a bus. */
  readonly assigned: number;
  /** `eligibilityIgnoredLocation`: no yard, so "in the yard" cannot be said. */
  readonly locationIgnored: boolean;
  /** `counts.spareByStanding`: where the spare buses stand. Without it, no place is said. */
  readonly byStanding?: SpareByStanding;
}

/**
 * How many buses have no duty and, when the response says, where they stand
 * (ruling S55): a spare bus may be out on the road, so they are never all
 * called "in the yard". Without the split no place is claimed.
 */
export function spareSentence(spare: readonly string[], context?: SpareContext): string {
  if (spare.length === 0) {
    const reason = noSpareReason(context?.assigned ?? null);
    return reason === null ? 'No bus is spare.' : `No bus is spare: ${reason}.`;
  }
  const n = spare.length;
  const split = context?.byStanding;
  const parts = split === undefined ? [] : [
    split.inYard > 0 ? { n: split.inYard, where: 'in the yard' } : null,
    split.standing > 0 ? { n: split.standing, where: 'standing' } : null,
    split.onRoad > 0 ? { n: split.onRoad, where: 'on the road' } : null,
  ].filter((p): p is { n: number; where: string } => p !== null);
  const only = parts.length === 1 ? parts[0] : undefined;
  if (only !== undefined && only.n === n) {
    return `${formatCount(n)} ${plural(n, 'bus is', 'buses are')} ${only.where} with no duty.`;
  }
  const head = `${formatCount(n)} ${plural(n, 'bus has', 'buses have')} no duty`;
  if (parts.length === 0) return `${head}.`;
  return `${head}: ${parts.map((p) => `${formatCount(p.n)} ${p.where}`).join(', ')}.`;
}

/**
 * Buses held out of the matching, counted. "Not heard recently" is its own
 * reason, moving or standing (ruling S55). With no yard established the server
 * ignores location, so a "not in the yard" count is then worded as "not
 * standing on a recent report" (`eligibilityIgnoredLocation`).
 */
export function heldOutParts(blockers: DutyBlockers, locationIgnored = false): readonly string[] {
  const where = locationIgnored ? 'not standing on a recent report' : 'not in the yard';
  const notHeard = blockers.notHeard ?? 0;
  return [
    notHeard > 0 ? `${formatCount(notHeard)} not heard recently` : null,
    blockers.notInYard > 0 ? `${formatCount(blockers.notInYard)} ${where}` : null,
    blockers.offRoad > 0 ? `${formatCount(blockers.offRoad)} off the road` : null,
    blockers.dark > 0 ? `${formatCount(blockers.dark)} dark` : null,
  ].filter((p): p is string => p !== null);
}

/**
 * Why a duty has no bus; null for an assigned duty. Class is a cost, not a bar
 * (ruling S47), so a duty is left without a bus only when no eligible bus of
 * ANY class is left, and the held-out counts are of every class (ruling S55).
 */
export function reasonSentence(duty: BoardDuty, locationIgnored = false): string | null {
  if (duty.registrationNumber !== null) return null;
  const head = 'No eligible bus is left: every eligible bus has another duty';
  const held =
    duty.blockers === null ? '' : heldOutParts(duty.blockers, locationIgnored).join(', ');
  if (held === '') return `${head}, or the depot has none.`;
  return `${head}. Held out of the matching: ${held}.`;
}

function describe(duty: BoardDuty, timeText: string, stateWord: string): string {
  const who = duty.registrationNumber === null ? '' : `: ${duty.registrationNumber}`;
  return `Route ${duty.routeName}, ${duty.serviceClass}, ${timeText} (modelled). ${stateWord}${who}.`;
}

const byStartThenId = (a: BoardDuty, b: BoardDuty): number =>
  a.startMin - b.startMin || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** One row per duty, ordered by start; the chart and the table both render these. */
export function buildBoardRows(
  duties: readonly BoardDuty[],
  locationIgnored = false,
): readonly BoardRow[] {
  return [...duties].sort(byStartThenId).map((duty) => {
    const timeText = `${formatMinute(duty.startMin)} to ${formatMinute(duty.endMin)}`;
    const stateWord = STATE_WORD[duty.state];
    return {
      id: duty.id,
      routeName: duty.routeName,
      serviceClass: duty.serviceClass,
      startMin: duty.startMin,
      endMin: duty.endMin,
      timeText,
      registrationNumber: duty.registrationNumber,
      state: duty.state,
      stateWord,
      reason: reasonSentence(duty, locationIgnored),
      geometry: barGeometry(duty.startMin, duty.endMin),
      ariaLabel: describe(duty, timeText, stateWord),
    };
  });
}

/** Space one character of the bar text needs, and the padding around it, in pixels. */
const TEXT_CHAR_PX = 7;
const TEXT_PAD_PX = 12;
/** The track is never narrower than this (the chart's minimum width less its label column). */
const MIN_TRACK_PX = 700;

export type TextPlacement = 'inside' | 'right' | 'left';

/**
 * Where a bar's text goes. It stays inside when the bar is wide enough for the
 * text, otherwise beside the bar: to the right while it fits before the axis
 * end, else to the left.
 */
export function barTextPlacement(input: {
  readonly leftPct: number;
  readonly widthPct: number;
  readonly textLength: number;
}): TextPlacement {
  const neededPct = ((input.textLength * TEXT_CHAR_PX + TEXT_PAD_PX) * PERCENT) / MIN_TRACK_PX;
  if (input.widthPct >= neededPct) return 'inside';
  return input.leftPct + input.widthPct + neededPct <= PERCENT ? 'right' : 'left';
}

export type BoardView = 'chart' | 'table';

/** Text on or beside a bar: the registration when a bus is proposed, else the state word. */
export function barLabel(row: Pick<BoardRow, 'registrationNumber' | 'stateWord'>): string {
  return row.registrationNumber ?? row.stateWord;
}

/** The label at the top of the now line, or null when there is no line. */
export function nowLabel(feedNow: string | null): string | null {
  const minutes = feedMinutes(feedNow);
  if (minutes === null || nowLinePct(feedNow) === null) return null;
  return `Now ${formatMinute(minutes)}`;
}

export function viewAnnouncement(view: BoardView, dutyCount: number): string {
  return `Showing the ${view}, ${dutyCount} ${plural(dutyCount, 'duty', 'duties')}`;
}

/** The shared cross-reference to the modelled day; the words are built in one place for every page. */
export function crossReferenceSentence(reference: ModelledDayReference): string {
  return modelledDaySentence(reference);
}
