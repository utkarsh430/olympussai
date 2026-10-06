'use client';

import { useState } from 'react';

const RECOMMENDATION_ONLY = 'Recommendation only. No transfer order is issued.';
const PERCENT = 100;

export interface PageIntroProps {
  readonly spareRatio: number;
  readonly fixture: boolean;
  /** The what-if sentence, or null while the server plan shows. */
  readonly sentence: string | null;
  readonly onReset: () => void;
  /** The page's one polite status line: decisions recorded and resets. */
  readonly announcement: string;
}

/** What is live and what is modelled, then the sticky recommendation-only strip. */
export function PageIntro({
  spareRatio,
  fixture,
  sentence,
  onReset,
  announcement,
}: PageIntroProps) {
  const [showAll, setShowAll] = useState(false);
  return (
    <>
      <div className="mb-4 flex min-w-0 flex-col gap-2">
        <p className="depot-prose max-w-3xl">
          Live: each depot&apos;s fleet, buses off road and buses available come from the latest
          feed snapshot. Modelled: the feed carries no network timetable, so each depot&apos;s
          requirement is modelled by a stated rule (a depot whose buses are more on the road than
          its peers&apos; is assumed stretched, one with many standing buses to have slack) plus a
          spare margin of {Math.round(spareRatio * PERCENT * 10) / 10}% of peak need. The
          requirement stays modelled until a timetable is supplied, so every transfer below is a
          modelled recommendation.
        </p>
        {fixture ? (
          <p className="depot-prose max-w-3xl text-alert-amber">
            This is the sample fixture, about three buses per depot: the sample is too small for
            these figures to mean anything.
          </p>
        ) : null}
      </div>
      <div
        data-testid="rebalance-notice"
        className="sticky top-14 z-30 mb-6 flex min-w-0 flex-col gap-1 border-y border-alert-amber/50 bg-depot-page py-2"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
          <p className="font-mono text-[13px] text-alert-amber">{RECOMMENDATION_ONLY}</p>
          <p role="status" className="min-w-0 text-[13px] text-depot-ink">
            {announcement}
          </p>
        </div>
        {sentence ? (
          <div className="flex min-w-0 items-baseline gap-3">
            <p className={`min-w-0 text-[13px] text-depot-ink ${showAll ? '' : 'truncate'}`}>
              What-if showing, not the server plan: {sentence}
            </p>
            <button
              type="button"
              aria-expanded={showAll}
              className="depot-link shrink-0 text-[11px]"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? 'Show less' : 'Show all'}
            </button>
            <button type="button" className="depot-link shrink-0 text-[11px]" onClick={onReset}>
              Reset to the server plan
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}
