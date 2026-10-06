import { BUS_STATE_LABEL } from '@/lib/depot/labels';
import type { BusOpState } from '@/lib/depot/types';

/**
 * Square colour per bus state. Status colours, checked with the dataviz validator on
 * the dark surface (#070f1d): every pair stays apart for deutan, protan and normal
 * vision (worst all-pairs CVD ΔE 8.9, amber against green), all clear 3:1 against the
 * surface. Standing is deliberately neutral (it is the resting state), so it reads
 * grey. The word always follows the square, so the colour only reinforces it.
 */
export const BUS_STATE_SQUARE: Readonly<Record<BusOpState, string>> = {
  in_service: 'bg-alert-green',
  on_road: 'bg-holo-glow',
  standing: 'bg-depot-muted',
  dark: 'bg-alert-amber',
  off_road: 'bg-alert-crimson',
};

export interface BusStateMarkProps {
  readonly state: BusOpState;
  /** A shorter word where the column is narrow; the full label goes in `title`. */
  readonly short?: boolean;
}

const SHORT_LABEL: Readonly<Record<BusOpState, string>> = {
  ...BUS_STATE_LABEL,
  on_road: 'On road',
};

/**
 * A bus state wherever one is shown (roster, yard lists, duties chart): a 6px square in
 * the state's colour, then the word from `labels.ts`. Never the colour alone.
 */
export function BusStateMark({ state, short = false }: BusStateMarkProps) {
  const word = short ? SHORT_LABEL[state] : BUS_STATE_LABEL[state];
  return (
    <span
      data-testid="depot-bus-state"
      data-state={state}
      title={short ? BUS_STATE_LABEL[state] : undefined}
      className="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap"
    >
      <span aria-hidden className={`h-1.5 w-1.5 shrink-0 ${BUS_STATE_SQUARE[state]}`} />
      <span className="truncate">{word}</span>
    </span>
  );
}
