'use client';

import { useState } from 'react';
import { formatCount } from '@/lib/depot/format';
import { notProfiledSentence } from '@/lib/depot/routes/allocationWording';
import { disclosureWord, ROUTES_TEXT } from '@/lib/depot/routes/routesPageText';
import type { Coverage } from '@/lib/depot/types';

export interface ProfileCoverageProps {
  /** Routes with a known profile out of every route in the feed. */
  readonly profiled: Coverage;
}

/**
 * The routes the plan cannot measure for want of a profile, as one collapsed row with its
 * count (the pattern of the unmoved groups); its sentence opens beneath it.
 */
export function ProfileCoverage({ profiled }: ProfileCoverageProps) {
  const [open, setOpen] = useState(false);
  const missing = profiled.of - profiled.n;
  if (missing <= 0) return null;
  return (
    <details
      data-testid="routes-without-profile"
      className="depot-details border-b border-depot-line py-2.5"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="tabular-nums">{formatCount(missing)}</span>
        <span className="min-w-0 font-sans text-sm normal-case tracking-normal text-depot-prose">
          {ROUTES_TEXT.profileTitle}
        </span>
        <span className="ml-auto">{disclosureWord(open)}</span>
      </summary>
      {/* How details are fetched is said once, in the closing disclosure. */}
      <p className="depot-prose mt-2 max-w-3xl">{notProfiledSentence(missing, profiled.of)}</p>
    </details>
  );
}
