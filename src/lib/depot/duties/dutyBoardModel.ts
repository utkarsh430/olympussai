import { formatCount, formatFeedTime } from '../format';
import type { BoardDuty, DutyBlockers, DutyBoardCounts, DutyState } from './api';

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
  no_bus: 'No bus',
  bus_not_in_yard: 'Bus not in yard',
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

export function summarySentence(counts: DutyBoardCounts): string {
  const spare = `${formatCount(counts.spare)} ${plural(counts.spare, 'bus is', 'buses are')} spare`;
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
  const head = 'No duties are modelled for this depot:';
  if (input.routeCount === 0) {
    return `${head} none of its buses reports a route in the live feed, so there is nothing to run a duty on.`;
  }
  return `${head} the modelled peak requirement is zero buses.`;
}

export function routesWithoutDutySentence(routes: readonly string[]): string | null {
  if (routes.length === 0) return null;
  return (
    'The modelled requirement is smaller than the number of routes, so ' +
    `${formatCount(routes.length)} ${plural(routes.length, 'route has', 'routes have')} no duty: ` +
    `${routes.join(', ')}.`
  );
}

export function spareSentence(spare: readonly string[]): string {
  if (spare.length === 0) return 'No bus is spare: every eligible bus has a duty.';
  return `${formatCount(spare.length)} ${plural(spare.length, 'bus is', 'buses are')} in the yard with no duty.`;
}

function heldOut(blockers: DutyBlockers): string {
  const parts = [
    blockers.notInYard > 0 ? `${blockers.notInYard} not in the yard` : null,
    blockers.offRoad > 0 ? `${blockers.offRoad} off road` : null,
    blockers.dark > 0 ? `${blockers.dark} dark` : null,
  ].filter((p): p is string => p !== null);
  return parts.join(', ');
}

/** Why a duty has no bus; null for an assigned duty. */
export function reasonSentence(duty: BoardDuty): string | null {
  if (duty.registrationNumber !== null) return null;
  const head = `No free ${duty.serviceClass} bus.`;
  const held = duty.blockers === null ? '' : heldOut(duty.blockers);
  if (held === '') {
    return `${head} Every ${duty.serviceClass} bus the depot has is on another duty, or it has none.`;
  }
  return `${head} Held out of the matching: ${held}. Every other ${duty.serviceClass} bus is on another duty.`;
}

function describe(duty: BoardDuty, timeText: string, stateWord: string): string {
  const who = duty.registrationNumber === null ? '' : `: ${duty.registrationNumber}`;
  return `Route ${duty.routeName}, ${duty.serviceClass}, ${timeText} (modelled). ${stateWord}${who}.`;
}

const byStartThenId = (a: BoardDuty, b: BoardDuty): number =>
  a.startMin - b.startMin || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** One row per duty, ordered by start; the chart and the table both render these. */
export function buildBoardRows(duties: readonly BoardDuty[]): readonly BoardRow[] {
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
      reason: reasonSentence(duty),
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

/** Above this many duties the chart is several screens tall, so the table opens first. */
export const CHART_DUTY_LIMIT = 60;

export type BoardView = 'chart' | 'table';

export function defaultView(dutyCount: number): BoardView {
  return dutyCount > CHART_DUTY_LIMIT ? 'table' : 'chart';
}

export function largeBoardSentence(dutyCount: number): string {
  return (
    `This depot has ${dutyCount} duties, more than ${CHART_DUTY_LIMIT}, so the table is shown ` +
    'first because the chart would be very tall. The chart is one button away.'
  );
}

export function viewAnnouncement(view: BoardView, dutyCount: number): string {
  return `Showing the ${view}, ${dutyCount} ${plural(dutyCount, 'duty', 'duties')}`;
}
