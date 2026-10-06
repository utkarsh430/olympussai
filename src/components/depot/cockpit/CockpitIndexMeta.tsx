'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useDepotDetailContext } from '@/components/depot/data/DepotDetailProvider';
import { cockpitIndexMeta } from '@/lib/depot/cockpit/cockpitModel';

/**
 * The efficiency index on the header's right (critique, cockpit Must 2): one mono meta
 * line that links to the league, its window in the shared words. An unranked depot
 * gets the reason as a sentence. Nothing while the first response is pending.
 */
export function CockpitIndexMeta() {
  const { data } = useDepotDetailContext();
  const meta = useMemo(() => (data ? cockpitIndexMeta(data) : null), [data]);
  if (meta === null) return null;
  return (
    <div className="min-w-0 text-right" data-testid="depot-cockpit-index">
      <Link
        href={meta.href}
        className="font-mono text-[12px] uppercase tracking-[0.08em] tabular-nums text-depot-muted hover:text-depot-ink hover:underline"
      >
        {meta.label}
        <span aria-hidden> ›</span>
      </Link>
      {meta.reason ? <p className="depot-note">{meta.reason}</p> : null}
    </div>
  );
}
