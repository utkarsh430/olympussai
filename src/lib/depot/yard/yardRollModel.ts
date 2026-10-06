import type { DepotBusView } from '../api';
import { formatCount, formatDurationMinutes } from '../format';
import { BUS_STATE_LABEL } from '../labels';
import type { BusOpState } from '../types';
import { YARD_STATE_ORDER, type StateGroup, type YardModel } from './yardModel';

/** A bus in the yard not heard for this long is listed as needing action. */
export const NOT_HEARD_ACTION_MIN = 60;
/** Rows a group shows before its "Show all N". */
export const ROLL_PREVIEW_ROWS = 5;

/**
 * The listing rule, as the section label's one-line note. Every reason is live: a reason
 * from the modelled parking order never lists a bus here (that order's overflow is shown
 * under its own MODELLED section), so nothing modelled reads as an observed fact.
 */
export const ROLL_NOTE = `Listed: off the road, dark, or not heard for ${formatDurationMinutes(NOT_HEARD_ACTION_MIN)} or more`;

const NOT_HEARD_REASON = 'not heard recently';

/** One row of the roll's tables: bare figures, the reason never repeating the state. */
export interface RollRow {
  readonly registration: string;
  readonly state: BusOpState;
  readonly notHeardMin: number | null;
  readonly notHeard: string;
  /** A live reason the state does not already say; empty when there is none. */
  readonly reason: string;
}

/** One state: every bus counted, and the ones needing action listed (possibly none). */
export interface RollGroup {
  readonly state: BusOpState;
  readonly label: string;
  /** Every bus in this state that the roll counts, listed or not. */
  readonly count: number;
  readonly rows: readonly RollRow[];
  /** False when no row has a reason beyond its state: the constant column is dropped. */
  readonly showReason: boolean;
}

export interface YardRollView {
  readonly title: string;
  /** Every bus counted: in the yard (any state), or every bus when no yard is established. */
  readonly total: number;
  /** One per state present, in the fixed order; rows hold only buses with a live reason. */
  readonly groups: readonly RollGroup[];
}

function notHeardMinOf(bus: DepotBusView): number | null {
  const min = bus.notHeardMin ?? bus.gpsAgeMin;
  return min !== null && Number.isFinite(min) && min >= 0 ? min : null;
}

function isQuiet(bus: DepotBusView): boolean {
  const min = notHeardMinOf(bus);
  return min !== null && min >= NOT_HEARD_ACTION_MIN;
}

/** "Dark" already says the bus is not heard, so only other states carry the quiet reason. */
function reasonOf(bus: DepotBusView): string {
  return bus.state !== 'dark' && isQuiet(bus) ? NOT_HEARD_REASON : '';
}

function needsAction(bus: DepotBusView): boolean {
  return bus.state === 'off_road' || bus.state === 'dark' || isQuiet(bus);
}

function rowOf(bus: DepotBusView): RollRow {
  const notHeardMin = notHeardMinOf(bus);
  return {
    registration: bus.registrationNumber,
    state: bus.state,
    notHeardMin,
    notHeard: formatDurationMinutes(notHeardMin),
    reason: reasonOf(bus),
  };
}

/** Longest unheard first (unknown last), then registration. Returns a new array. */
function byQuietest(rows: readonly RollRow[]): readonly RollRow[] {
  return [...rows].sort(
    (a, b) =>
      (b.notHeardMin ?? -1) - (a.notHeardMin ?? -1) ||
      a.registration.localeCompare(b.registration),
  );
}

/** "In the yard now": every bus counted by state, only the buses needing action listed. */
export function yardRoll(model: YardModel): YardRollView {
  const source: readonly StateGroup<DepotBusView>[] = model.established
    ? model.inYardGroups
    : model.allGroups;
  const groups = YARD_STATE_ORDER.map((state) => {
    const buses = source.find((g) => g.state === state)?.buses ?? [];
    const rows = byQuietest(buses.filter(needsAction).map(rowOf));
    return {
      state,
      label: BUS_STATE_LABEL[state],
      count: buses.length,
      rows,
      showReason: rows.some((r) => r.reason !== ''),
    };
  }).filter((g) => g.count > 0);
  return {
    title: model.established ? 'In the yard now' : 'Buses by state',
    total: groups.reduce((sum, g) => sum + g.count, 0),
    groups,
  };
}

export interface AwayRow {
  readonly registration: string;
  readonly state: BusOpState;
  /** Kilometres from the yard as a bare number, or a dash. */
  readonly km: string;
  /** The other depot whose yard the bus stands in; empty otherwise. */
  readonly atYard: string;
  readonly notHeard: string;
}

const DASH = '—';

/** Away buses as table rows; "another depot" when the other depot's name is not known. */
export function awayRows(
  buses: readonly DepotBusView[],
  depotNames: ReadonlyMap<string, string>,
): readonly AwayRow[] {
  return buses.map((bus) => {
    const km = bus.distanceFromYardKm;
    const other =
      bus.location === 'at_other_yard'
        ? ((bus.otherDepotId === null ? undefined : depotNames.get(bus.otherDepotId)) ??
          'another depot')
        : '';
    return {
      registration: bus.registrationNumber,
      state: bus.state,
      km: km === null || !Number.isFinite(km) ? DASH : km.toFixed(1),
      atYard: other,
      notHeard: formatDurationMinutes(notHeardMinOf(bus)),
    };
  });
}

/** Buses with no known location, as roll rows (no reason). */
export function unknownRows(buses: readonly DepotBusView[]): readonly RollRow[] {
  return buses.map((bus) => ({ ...rowOf(bus), reason: '' }));
}

export interface NoYardPanel {
  readonly sentence: string;
  readonly remedy: string;
}

/**
 * The panel that takes the map's place. At 0 or 1 snapshots a missing yard is not yet
 * evidence of anything. The count restarts with the yard memory (a new epoch, a long
 * absence), so the sentence states the count and claims nothing about why it is low (P2).
 */
export function noYardPanel(model: YardModel, snapshotsSeen: number | undefined): NoYardPanel {
  const n = model.parkedWithPosition;
  const remedy = `A yard appears when more of the ${formatCount(n)} parked ${n === 1 ? 'bus' : 'buses'} with a position stand together.`;
  if (snapshotsSeen !== undefined && snapshotsSeen <= 1) {
    const counted = `${formatCount(snapshotsSeen)} ${snapshotsSeen === 1 ? 'snapshot' : 'snapshots'}`;
    return {
      sentence: `This server has decided this depot's yard on ${counted} so far; a yard may be found as more arrive.`,
      remedy,
    };
  }
  return {
    sentence: 'No yard is established yet: too few parked buses report a position together.',
    remedy,
  };
}
