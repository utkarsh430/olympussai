'use client';

import { Notice } from '@/components/depot/shell/Notice';

export const RECOMMENDATION_ONLY =
  'Nothing is dispatched or reassigned: a decision here is only recorded in this browser.';
const FIXTURE_NOTE =
  'This is the sample fixture, about three buses per depot: too small for these figures to mean anything.';

/** The page's one notice, in the flow under the provenance line; never sticky. */
export function RecommendationNotice({ fixture }: { readonly fixture: boolean }) {
  return (
    <div data-testid="rebalance-notice">
      <Notice status={fixture ? 'warning' : 'info'} word="Recommendation only">
        {RECOMMENDATION_ONLY}
        {fixture ? ` ${FIXTURE_NOTE}` : null}
      </Notice>
    </div>
  );
}

export interface WhatIfStripProps {
  /** The what-if sentence, or null while the server plan shows (then nothing renders). */
  readonly sentence: string | null;
  readonly onReset: () => void;
}

/**
 * While a what-if shows: one compact line that sticks directly below the shell's sticky
 * layers (`--depot-sticky-top`, so never over the navigation), saying so, with the reset.
 * Its height is the shell's intro height, so it covers no more than one line of what
 * scrolls beneath it. The full what-if sentence runs in the flow under it.
 */
export function WhatIfStrip({ sentence, onReset }: WhatIfStripProps) {
  if (!sentence) return null;
  return (
    <>
      <div
        data-testid="rebalance-whatif-strip"
        className="sticky top-[var(--depot-sticky-top)] z-20 mb-2 flex h-[var(--depot-intro-h)] min-w-0 items-center gap-x-4 border-y border-alert-amber/50 bg-depot-page"
      >
        <p className="min-w-0 truncate font-mono text-[11px] uppercase tracking-[0.12em] text-alert-amber">
          What-if showing, not the server plan
        </p>
        <button
          type="button"
          className="depot-link ml-auto shrink-0 text-[11px]"
          aria-label="Reset to the server plan: stop showing the what-if"
          onClick={onReset}
        >
          Reset to the server plan
        </button>
      </div>
      <p data-testid="rebalance-whatif-sentence" className="depot-prose mb-4 text-[13px] text-depot-ink">
        What-if showing, not the server plan: {sentence}
      </p>
    </>
  );
}
