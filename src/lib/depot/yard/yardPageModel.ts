import type { VisitorBus } from '../api';
import { formatCount, formatFeedTime } from '../format';
import type { Yard } from '../infer/types';
import type { BusOpState } from '../types';
import {
  baysMissingSentence,
  capacitySentence,
  fleetOnlyCapacitySentence,
  visitingSentence,
  type CapacityView,
} from './parkingModel';
import type { YardModel } from './yardModel';

/** Visitors shown before "Show all N". */
export const VISITOR_CAP = 15;

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

export interface CapacityFigure {
  readonly value: string;
  readonly caption: string;
  /** 0 to 1 for the fill bar; undefined when there is nothing to set against the bays. */
  readonly share: number | undefined;
  /** The full sentences the old capacity panel printed, kept for the figure's title. */
  readonly title: string;
}

/** Capacity as one figure: "158 of 209", "modelled bays in use; 51 free". */
export function capacityFigure(view: CapacityView, pending: boolean): CapacityFigure {
  const { bays, inYard, fleet, visiting } = view;
  if (bays === null) {
    return {
      value: '—',
      caption: pending ? 'bay count loading' : 'bay count unavailable',
      share: undefined,
      title: baysMissingSentence(view, pending),
    };
  }
  if (inYard === null) {
    return {
      value: `${formatCount(fleet)} of ${formatCount(bays)}`,
      caption: 'fleet against modelled bays',
      share: bays > 0 ? fleet / bays : undefined,
      title: fleetOnlyCapacitySentence(fleet, bays),
    };
  }
  const used = inYard + visiting;
  const free = bays - used;
  const tail =
    free > 0
      ? `${formatCount(free)} free`
      : free === 0
        ? 'none free'
        : `${formatCount(-free)} over`;
  return {
    value: `${formatCount(used)} of ${formatCount(bays)}`,
    caption: `modelled bays in use; ${tail}`,
    share: bays > 0 ? used / bays : undefined,
    title: `${capacitySentence({ bays, inYard, visiting })} ${visitingSentence(visiting)}`,
  };
}

/** "Yard held since 14:02: …" when the yard is carried over from earlier snapshots. */
export function heldSinceLine(yard: Yard | null): string | null {
  if (!yard?.heldSince) return null;
  return `Yard held since ${formatFeedTime(yard.heldSince)}: this snapshot alone would not place it.`;
}

/**
 * The map's one caption line. The map draws every positioned bus within the display
 * range: this depot's buses in the yard, its buses just outside the circle (counted
 * under Away), and visitors. So the drawn total is not "in the yard + visiting"; the
 * caption says what it is made of.
 */
export function mapCaption(model: YardModel): string {
  const inYardRegs = new Set(
    model.inYardGroups.flatMap((g) => g.buses.map((b) => b.registrationNumber)),
  );
  const own = model.points.filter((p) => p.relation === 'home');
  const drawnInYard = own.filter((p) => inYardRegs.has(p.registration)).length;
  const nearby = own.length - drawnInYard;
  const visiting = model.points.length - own.length;
  const parts = [`${formatCount(drawnInYard)} in the yard`];
  if (nearby > 0) parts.push(`${formatCount(nearby)} of this depot's just outside it`);
  if (visiting > 0) parts.push(`${formatCount(visiting)} visiting`);
  const total = model.points.length;
  const head = `${formatCount(total)} ${plural(total, 'bus', 'buses')} drawn: ${parts.join(', ')}.`;
  const unplaced = model.counts.inYard - drawnInYard;
  const noPosition =
    unplaced > 0
      ? ` ${formatCount(unplaced)} in the yard ${plural(unplaced, 'has', 'have')} no position.`
      : '';
  const beyond = model.beyondOwn + model.beyondVisiting;
  const far =
    beyond > 0 ? ` ${formatCount(beyond)} more beyond the map's range are listed below.` : '';
  const hidden = model.visitorsWithoutPosition;
  const visitorsUnplaced =
    hidden > 0
      ? ` ${formatCount(hidden)} visiting ${plural(hidden, 'has', 'have')} no position and ${plural(hidden, 'is', 'are')} listed below only.`
      : '';
  return `${head}${noPosition}${visitorsUnplaced}${far}`;
}

export interface VisitorRow {
  readonly registration: string;
  readonly homeDepot: string;
  readonly state: BusOpState;
}

const UNKNOWN_HOME = 'Not known';

/** Visitors as one table: by home depot (unknown last), then registration. */
export function visitorRows(visitors: readonly VisitorBus[]): readonly VisitorRow[] {
  return visitors
    .map((v) => ({
      registration: v.registrationNumber,
      homeDepot: v.homeDepotName ?? UNKNOWN_HOME,
      state: v.state,
      known: v.homeDepotName !== null,
    }))
    .sort(
      (a, b) =>
        Number(!a.known) - Number(!b.known) ||
        a.homeDepot.localeCompare(b.homeDepot) ||
        a.registration.localeCompare(b.registration),
    )
    .map(({ registration, homeDepot, state }) => ({ registration, homeDepot, state }));
}
