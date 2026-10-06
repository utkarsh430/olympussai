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

/** Whole percentages, one precision for every state: "43%", "0%", and "<1%" for a few buses. */
function shareText(n: number, of: number): string {
  if (of === 0) return '—';
  const percent = (n / of) * PERCENT;
  if (n > 0 && percent < 1) return '<1%';
  return `${Math.round(percent)}%`;
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

/** Where a standing bus is: "standing in the yard" is never shortened to "in the yard". */
const PLACE_WORDS: Readonly<Record<BusLocation, string>> = {
  in_yard: 'standing in the yard',
  at_other_yard: 'at another yard',
  away: 'away',
  unknown: 'location unknown',
};

/** At or below this many yard decisions, a missing yard may only mean the server just started. */
export const YARD_STARTING_SNAPSHOTS = 1;

export const NO_YARD_LINE =
  'No yard is established yet: no place where these buses park meets the yard rule.';
export const YARD_STARTING_LINE =
  'The server has only just started, so no yard is placed yet; one may be found within a few snapshots.';

export type YardLine =
  | { readonly kind: 'split'; readonly text: string; readonly held: string | null }
  | { readonly kind: 'no-yard' | 'starting'; readonly sentence: string };

export interface YardFacts {
  /** Every bus of the depot inside the yard circle, whatever its state (the yard page's figure). */
  readonly inYard: number;
  readonly visitors: number;
  readonly heldSince: string | null;
  /** Snapshots the server has decided this yard on; absent on an older response. */
  readonly snapshotsSeen: number | undefined;
}

/**
 * One line for the yard: every bus in it, the visitors, and where the standing buses
 * are ("77 of this depot's buses in the yard, with 68 visiting · 86 standing: 59 standing
 * in the yard, 2 at another yard, 25 away"). With no yard, one sentence; the rule itself
 * is in the closing disclosure.
 */
export function yardLine(board: StatusBoard, facts: YardFacts): YardLine {
  if (board.locations === null) {
    const starting =
      facts.snapshotsSeen !== undefined && facts.snapshotsSeen <= YARD_STARTING_SNAPSHOTS;
    return starting
      ? { kind: 'starting', sentence: YARD_STARTING_LINE }
      : { kind: 'no-yard', sentence: NO_YARD_LINE };
  }
  const visiting =
    facts.visitors === 0 ? 'no visiting bus' : `with ${formatCount(facts.visitors)} visiting`;
  const places = board.locations
    .filter((cell) => cell.count > 0 || cell.location === 'in_yard')
    .map((cell) => `${formatCount(cell.count)} ${PLACE_WORDS[cell.location]}`);
  const held =
    facts.heldSince === null
      ? null
      : `Yard held since ${formatFeedTime(facts.heldSince)}: this snapshot alone would not place it.`;
  const inYard = `${formatCount(facts.inYard)} of this depot's buses in the yard, ${visiting}`;
  return {
    kind: 'split',
    text: `${inYard} · ${formatCount(board.standing)} standing: ${places.join(', ')}`,
    held,
  };
}
