import { formatCount, formatFeedTime } from '@/lib/depot/format';
import type { BusLocation } from '@/lib/depot/infer/types';
import type { BusOpState } from '@/lib/depot/types';
import type { StatusBoard } from './cockpitTypes';

/**
 * The availability bar (one stacked bar of the five states, with its legend and a
 * text equivalent) and the one line under it that places the standing buses.
 */

export interface AvailabilitySegment {
  readonly state: BusOpState;
  readonly label: string;
  readonly count: number;
  /** Share of the fleet, 0 to 1. */
  readonly share: number;
  readonly shareText: string;
}

const PERCENT = 100;

/** One decimal, a trailing ".0" dropped: "2.5%", "43%". */
function shareText(n: number, of: number): string {
  if (of === 0) return '—';
  return `${Number(((n / of) * PERCENT).toFixed(1))}%`;
}

export function availabilitySegments(board: StatusBoard): readonly AvailabilitySegment[] {
  return board.states.map((cell) => ({
    state: cell.state,
    label: cell.label,
    count: cell.count,
    share: board.fleet > 0 ? cell.count / board.fleet : 0,
    shareText: shareText(cell.count, board.fleet),
  }));
}

/** The bar in words, for screen readers and for anyone who cannot tell the colours apart. */
export function availabilityText(board: StatusBoard): string {
  const parts = availabilitySegments(board).map(
    (s) => `${formatCount(s.count)} ${s.label.toLowerCase()} (${s.shareText})`,
  );
  return `Of ${formatCount(board.fleet)} buses: ${parts.join(', ')}.`;
}

const PLACE_WORDS: Readonly<Record<BusLocation, string>> = {
  in_yard: 'in the yard',
  at_other_yard: 'at another yard',
  away: 'away',
  unknown: 'location unknown',
};

export type StandingLine =
  | { readonly kind: 'split'; readonly text: string; readonly held: string | null }
  | { readonly kind: 'no-yard'; readonly sentence: string };

/** "86 standing: 59 in the yard · 2 at another yard · 25 away · 0 location unknown". */
export function standingLine(board: StatusBoard, heldSince: string | null): StandingLine {
  if (board.locations === null) return { kind: 'no-yard', sentence: board.yard.sentence };
  const places = board.locations.map((cell) => `${formatCount(cell.count)} ${PLACE_WORDS[cell.location]}`);
  const held =
    heldSince === null
      ? null
      : `Yard held since ${formatFeedTime(heldSince)}: this snapshot alone would not place it.`;
  return { kind: 'split', text: `${formatCount(board.standing)} standing: ${places.join(' · ')}`, held };
}
