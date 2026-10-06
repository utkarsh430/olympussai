import { formatCount, formatFeedTime } from '../format';
import type { BoardDuty, DutyBlockers, DutyState } from './api';
import { CLASS_WORD, STANDING_WORD, busClassWord } from './dutyStanding';
import type { BusStandingNow, SpareByStanding } from './types';

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

/**
 * Wording follows `assignDuties`' tiers in order: class is a
 * preference, not a bar, so a bus of another class can take a duty. Before the day's
 * first duty how the buses stand and the feed time do not count, so those tiers are
 * said to apply once it has started; the page's notes say which mode the plan is in.
 */
export const COST_SENTENCE =
  'Once the day’s first duty has started, the matching gives duties first to buses already out on the road, buses in service before buses merely moving, then to standing buses. It gives a route’s duties to buses running that route and prefers a bus of the duty’s service class; once the day has begun it also fits buses to the feed time. Among what is left it minimises total wear: a bus costs its age in years times the duty length in whole hours, so longer duties go to younger buses.';

/**
 * Who `assignDuties` never matches, in every mode. Who else is held out depends on
 * the plan's mode, the feed clock and the yard, so the page's notes say it
 * (`eligibilityNotes`): a fixed sentence here could contradict them.
 */
export const ELIGIBILITY_SENTENCE = 'A bus off the road or dark is never matched to a duty.';

/** "Matched", never "Assigned": the matching is a recommendation and nothing is assigned. */
export const STATE_WORD: Readonly<Record<DutyState, string>> = {
  assigned: 'Matched',
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
  /** The duty's service class in title case. */
  readonly classWord: string;
  /** Minutes from midnight; the end may pass 1440. */
  readonly startMin: number;
  readonly endMin: number;
  readonly timeText: string;
  /** The same span short enough for the timeline's label column (`formatSpanShort`). */
  readonly spanText: string;
  readonly registrationNumber: string | null;
  readonly state: DutyState;
  readonly stateWord: string;
  /** How the matched bus stands now; null when the duty has no bus or the server did not say. */
  readonly busStanding: BusStandingNow | null;
  readonly standingWord: string | null;
  /** The bus's class, only where it differs from the duty's. */
  readonly busClassWord: string | null;
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

/**
 * A duty's span for the timeline's narrow label column: "07:00–10:00", or
 * "17:15–01:25 +1 day" when it ends after midnight. The full words ("… to 01:25 next
 * day") stay in the row's title, its accessible name and its expander.
 */
export function formatSpanShort(startMin: number, endMin: number): string {
  const clock = (minute: number): string => formatMinute(minute % MINUTES_PER_DAY);
  const nextDay = endMin >= MINUTES_PER_DAY ? ' +1 day' : '';
  return `${clock(startMin)}–${clock(endMin)}${nextDay}`;
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

/** Within this share of either axis end the now flag is anchored to its line's edge. */
const NOW_FLAG_EDGE_PCT = 6;

/** How the now flag hangs from its line, so it never leaves the axis near 04:00 or 24:00. */
export function nowLabelAnchor(pct: number): 'start' | 'middle' | 'end' {
  if (pct < NOW_FLAG_EDGE_PCT) return 'start';
  return pct > PERCENT - NOW_FLAG_EDGE_PCT ? 'end' : 'middle';
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
 * Why no bus is spare, from the number of duties given a bus, so the footer cannot
 * say "every eligible bus has a duty" beside a matching that proposed none. Null
 * when that number is not known.
 */
function noSpareReason(assigned: number | null): string | null {
  if (assigned === null) return null;
  return assigned === 0 ? 'no bus is eligible for a duty' : 'every eligible bus has a duty';
}

export function emptyDutiesSentence(input: {
  readonly routeCount: number;
  readonly peakRequirement: number;
}): string {
  // The shared "no duties" sentence (modelledDaySentence) says that there are none;
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
 * How many buses have no duty and, when the response says, where they stand:
 * a spare bus may be out on the road, so they are never all
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
 * reason, moving or standing. With no yard established the server
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

/** "an" before a class word that starts with a vowel sound (Express, Ordinary, AC), else "a". */
const articleFor = (word: string): string => (/^[aeiou]/i.test(word) ? 'an' : 'a');

/**
 * A row's text equivalent. No reason on an unmatched row: it is the same for every
 * one and is said once above the chart. Under the MODELLED section label, so no tag.
 */
function describe(row: Omit<BoardRow, 'ariaLabel' | 'geometry'>): string {
  const head = `Route ${row.routeName}, ${row.classWord}, ${row.timeText}. ${row.stateWord}`;
  if (row.registrationNumber === null) return `${head}.`;
  const now = row.standingWord === null ? '' : `, ${row.standingWord.toLowerCase()} now`;
  const word = row.busClassWord;
  const other = word === null ? '' : `, ${articleFor(word)} ${word} bus`;
  return `${head}: ${row.registrationNumber}${now}${other}.`;
}

const byStartThenId = (a: BoardDuty, b: BoardDuty): number =>
  a.startMin - b.startMin || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** One row per duty, ordered by start; the chart and the table both render these. */
export function buildBoardRows(duties: readonly BoardDuty[]): readonly BoardRow[] {
  return [...duties].sort(byStartThenId).map((duty) => {
    const busStanding = duty.registrationNumber === null ? null : (duty.busStanding ?? null);
    const fields = {
      id: duty.id,
      routeName: duty.routeName,
      classWord: CLASS_WORD[duty.serviceClass],
      startMin: duty.startMin,
      endMin: duty.endMin,
      timeText: `${formatMinute(duty.startMin)} to ${formatMinute(duty.endMin)}`,
      spanText: formatSpanShort(duty.startMin, duty.endMin),
      registrationNumber: duty.registrationNumber,
      state: duty.state,
      stateWord: STATE_WORD[duty.state],
      busStanding,
      standingWord: busStanding === null ? null : STANDING_WORD[busStanding],
      busClassWord: busClassWord(duty),
    };
    return {
      ...fields,
      geometry: barGeometry(duty.startMin, duty.endMin),
      ariaLabel: describe(fields),
    };
  });
}

/** Space one character of the bar text needs, and the padding around it, in pixels. */
const TEXT_CHAR_PX = 7;
const TEXT_PAD_PX = 12;
/**
 * The narrowest track the bar text is measured against. From 640 px the chart fits its
 * frame (04:00 to 24:00, nothing cut): 640 less two 16 px gutters, the 160 px duty column
 * and the track's two 16 px insets. Below 640 the chart keeps a 900 px minimum and scrolls
 * inside its frame, so its track is wider than this.
 */
export const MIN_TRACK_PX = 640 - 32 - 160 - 32;

/** The view the board opens in until the reader picks one. */
export function defaultBoardView(narrow: boolean): BoardView {
  return narrow ? 'table' : 'chart';
}

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

/**
 * Text on or beside a bar: the registration of the matched bus. An unmatched bar
 * carries no word: its dashed outline and the legend say it.
 */
export function barLabel(row: Pick<BoardRow, 'registrationNumber'>): string | null {
  return row.registrationNumber;
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
