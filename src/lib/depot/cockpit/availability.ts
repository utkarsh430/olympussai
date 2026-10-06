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

/**
 * Where a standing bus is, after "Standing 84:" has named the subset, so "52 in the yard"
 * can only be read as standing buses.
 */
const PLACE_WORDS: Readonly<Record<BusLocation, string>> = {
  in_yard: 'in the yard',
  at_other_yard: 'at another yard',
  away: 'away',
  unknown: 'location unknown',
};

/** At or below this many yard decisions, a missing yard is not yet evidence of anything. */
export const YARD_STARTING_SNAPSHOTS = 1;

export const NO_YARD_LINE =
  'No yard is established yet: no place where these buses park meets the yard rule.';
/**
 * The count restarts with the yard memory (a new epoch, a long absence), so the line
 * states the count and claims nothing about why it is low (P2).
 */
export function yardStartingLine(snapshotsSeen: number): string {
  const counted = `${formatCount(snapshotsSeen)} ${snapshotsSeen === 1 ? 'snapshot' : 'snapshots'}`;
  return `This server has decided this depot's yard on ${counted} so far; a yard may be found as more arrive.`;
}

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
 * Two sentences for the yard: every bus of ours in it with the visitors, then where the
 * standing buses are ("In the yard: 77 of ours, 68 visiting. Standing 86: 59 in the yard,
 * 2 at another yard, 25 away."). With no yard, one sentence; the rule itself
 * is in the closing disclosure.
 */
export function yardLine(board: StatusBoard, facts: YardFacts): YardLine {
  if (board.locations === null) {
    const seen = facts.snapshotsSeen;
    return seen !== undefined && seen <= YARD_STARTING_SNAPSHOTS
      ? { kind: 'starting', sentence: yardStartingLine(seen) }
      : { kind: 'no-yard', sentence: NO_YARD_LINE };
  }
  const visiting =
    facts.visitors === 0 ? 'none visiting' : `${formatCount(facts.visitors)} visiting`;
  const places = board.locations
    .filter((cell) => cell.count > 0 || cell.location === 'in_yard')
    .map((cell) => `${formatCount(cell.count)} ${PLACE_WORDS[cell.location]}`);
  const held =
    facts.heldSince === null
      ? null
      : `Yard held since ${formatFeedTime(facts.heldSince)}: this snapshot alone would not place it.`;
  return {
    kind: 'split',
    text: `In the yard: ${formatCount(facts.inYard)} of ours, ${visiting}. Standing ${formatCount(board.standing)}: ${places.join(', ')}.`,
    held,
  };
}

/** The legend's word for a state: short enough never to be cut at 1440 (the full label is its title). */
const LEGEND_WORD: Readonly<Partial<Record<BusOpState, string>>> = {
  on_road: 'On road',
};

export function legendWord(state: BusOpState, label: string): string {
  return LEGEND_WORD[state] ?? label;
}

/**
 * The Availability label's note when the modelled week trend exists: an ordinary sentence,
 * the word in lower case ("Modelled week trend: on-road share steady over 7 days").
 */
export function weekTrendNote(metricLabel: string, weekSentence: string): string {
  return `Modelled week trend: ${metricLabel.toLowerCase()} ${weekSentence}`;
}
