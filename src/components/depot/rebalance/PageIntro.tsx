'use client';

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

/**
 * What is live and what is modelled, then the recommendation-only strip: one compact
 * line that sticks directly below whatever is sticky above it (`--depot-sticky-top`),
 * so it never covers the navigation strip, and holds the page's status line and the
 * one reset control, present only while a what-if shows. The what-if sentence itself
 * runs in the page flow beneath it, so the strip never grows past a line.
 */
export function PageIntro({
  spareRatio,
  fixture,
  sentence,
  onReset,
  announcement,
}: PageIntroProps) {
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
        className="sticky top-[var(--depot-sticky-top)] z-20 mb-4 flex min-h-[var(--depot-intro-h)] min-w-0 flex-wrap items-center gap-x-4 gap-y-0.5 border-y border-alert-amber/50 bg-depot-page py-1.5"
      >
        <p className="font-mono text-[13px] text-alert-amber">{RECOMMENDATION_ONLY}</p>
        <p role="status" className="min-w-0 flex-1 truncate text-[13px] text-depot-ink">
          {announcement}
        </p>
        {sentence ? (
          <>
            <p className="shrink-0 font-mono text-[11px] uppercase tracking-[0.12em] text-alert-amber">
              What-if showing
            </p>
            <button
              type="button"
              className="depot-link shrink-0 text-[11px]"
              aria-label="Reset to the server plan: stop showing the what-if"
              onClick={onReset}
            >
              Reset to the server plan
            </button>
          </>
        ) : null}
      </div>
      {sentence ? (
        <p data-testid="rebalance-whatif-sentence" className="depot-prose mb-6 text-[13px] text-depot-ink">
          What-if showing, not the server plan: {sentence}
        </p>
      ) : null}
    </>
  );
}
