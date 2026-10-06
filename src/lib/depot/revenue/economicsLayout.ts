import { formatCount } from '../format';
import { MIN_FLEET_FOR_RANK, MIN_PEER_GROUP } from '../score/config';
import type { EconomicsDepotRow } from './api';
import type { EconomicsRow } from './economicsRows';

/*
 * The economics page's layout words and geometry (design wave, round 2): the
 * figure band, the one visible sentence that keeps the index's limits on screen,
 * the sign note, the modelled-day extension of the provenance line, the peer-group
 * grouping and the table's column widths at 1440.
 */

/**
 * The ranked table's section note: the three facts that stay visible (rule 6), in
 * one sentence. The three paragraphs they summarise are in the closing disclosure.
 */
export const ECONOMICS_TABLE_NOTE =
  "The Depot Economics Index is modelled and separate from the Depot Efficiency Index; earnings minus fuel cost is not profit; the index is driven by the model's assumptions and is not a finding about any depot.";

/** Said once, beside the controls: what the muted signed suffix in each cell means. */
export const ECONOMICS_SIGN_NOTE =
  'Change vs peer median; higher earnings and lower fuel cost are better.';

/** The provenance line's extension: the dated, tense-neutral modelled day. */
export function economicsDaySentence(operatingDate: string): string {
  return `Built on the modelled day for ${operatingDate} of every operating depot, rebuilt from the live fleet as of the feed time.`;
}

/** The phrase a reason uses for a depot whose modelled day has no duty. */
export function noDutyPhrase(operatingDate?: string): string {
  return operatingDate === undefined
    ? 'no duty in the modelled day'
    : `no duty in the modelled day for ${operatingDate}`;
}

export interface BandFigure {
  readonly label: string;
  readonly value: string;
  readonly caption: string;
}

/**
 * Ranked, no duty, under a minimum: three figures that add up to the operating
 * depots. A fourth appears only when a component could not be worked out for
 * another reason, so the figures always add up.
 */
export function economicsBand(
  depots: readonly EconomicsDepotRow[],
  operatingDate?: string,
): readonly BandFigure[] {
  const operating = depots.filter((d) => d.kind === 'depot');
  const ranked = operating.filter((d) => d.score.ranked).length;
  const noDuty = operating.filter(
    (d) => d.score.reason === 'missing_component' && d.score.missing.includes('earningsPerKm'),
  ).length;
  const underMinimum = operating.filter(
    (d) => d.score.reason === 'fleet_too_small' || d.score.reason === 'peer_group_too_small',
  ).length;
  const other = operating.length - ranked - noDuty - underMinimum;
  const noun = operating.length === 1 ? 'operating depot' : 'operating depots';
  const figures: BandFigure[] = [
    { label: 'Ranked', value: formatCount(ranked), caption: `of ${formatCount(operating.length)} ${noun}` },
    {
      label: 'No duty in the modelled day',
      value: formatCount(noDuty),
      caption: operatingDate === undefined ? 'not ranked' : `not ranked; day for ${operatingDate}`,
    },
    {
      label: 'Under the peer-group minimum',
      value: formatCount(underMinimum),
      caption: `under ${formatCount(MIN_FLEET_FOR_RANK)} buses or ${formatCount(MIN_PEER_GROUP)} peers`,
    },
  ];
  return other > 0
    ? [...figures, { label: 'Not worked out', value: formatCount(other), caption: 'a component is missing' }]
    : figures;
}

/** The group a row is printed under: its peer group, or "Not ranked" without one. */
export function economicsGroupKey(row: EconomicsRow): string {
  return row.peerGroupLabel ?? 'Not ranked';
}

/** The content column at 1440: 1440 minus the 232px rail and two 24px gutters. */
export const FRAME_AT_1440 = 1160;

/** Every column's width at 1440, in px; their sum stays inside the frame (no column cut). */
export const ECONOMICS_COLUMN_WIDTHS = {
  rank: 56,
  depot: 224,
  index: 184,
  earningsPerKm: 160,
  costPerKm: 160,
  loadFactor: 136,
  fleet: 104,
} as const;

/** The breakdown button's accessible name, the same words as the league page's. */
export function breakdownButtonName(name: string): string {
  return `Score breakdown for ${name}`;
}
