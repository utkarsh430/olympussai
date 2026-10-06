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

export const WHAT_IF_WORD = 'What-if';
export const WHAT_IF_LEAD = 'Showing a what-if, not the server plan:';
export const RESET_LABEL = 'Reset to the server plan';

/**
 * While a what-if shows: the page says so in this ONE compact line, with the page's one
 * reset. It sticks directly below the shell's sticky layers (`--depot-sticky-top`: below
 * the top bar and, under 900px, the navigation strip, whose z-index is higher), so it never
 * covers the navigation; its height is the shell's intro height, one line. A long what-if
 * truncates, its full text in `title`.
 */
export function WhatIfStrip({ sentence, onReset }: WhatIfStripProps) {
  if (!sentence) return null;
  const full = `${WHAT_IF_LEAD} ${sentence}`;
  return (
    <div
      data-testid="rebalance-whatif-strip"
      className="sticky top-[var(--depot-sticky-top)] z-20 mb-4 flex h-[var(--depot-intro-h)] min-w-0 items-center gap-x-3 border-y border-alert-amber/50 bg-depot-page"
    >
      <span className="depot-label shrink-0 !text-alert-amber">{WHAT_IF_WORD}</span>
      <p
        data-testid="rebalance-whatif-sentence"
        className="depot-note min-w-0 flex-1 truncate !text-depot-ink"
        title={full}
      >
        {full}
      </p>
      <button type="button" className="depot-link shrink-0 text-[13px]" onClick={onReset}>
        {RESET_LABEL}
      </button>
    </div>
  );
}
