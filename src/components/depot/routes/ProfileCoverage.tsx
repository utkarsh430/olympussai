import { notProfiledSentence, PROFILES_GROW_WITH_USE } from '@/lib/depot/routes/allocationWording';
import { ROUTES_TEXT } from '@/lib/depot/routes/routesPageText';
import type { Coverage } from '@/lib/depot/types';

export interface ProfileCoverageProps {
  /** Routes with a known profile out of every route in the feed. */
  readonly profiled: Coverage;
}

/**
 * How many routes the plan cannot measure for want of a profile, and how that
 * changes. Deliberately no control here: profiles are fetched one route at a
 * time elsewhere, never in bulk from this page.
 */
export function ProfileCoverage({ profiled }: ProfileCoverageProps) {
  return (
    <section aria-labelledby="profile-title" className="mb-10">
      <h2 id="profile-title" className="depot-section-label">
        {ROUTES_TEXT.profileTitle}
      </h2>
      <div className="max-w-3xl space-y-1.5">
        <p className="font-sans text-sm leading-[1.55] text-depot-ink">
          {notProfiledSentence(profiled.of - profiled.n, profiled.of)}
        </p>
        <p className="depot-prose">{PROFILES_GROW_WITH_USE}</p>
      </div>
    </section>
  );
}
