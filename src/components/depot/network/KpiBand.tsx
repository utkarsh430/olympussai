'use client';

import { useEffect, useState } from 'react';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import { formatCount } from '@/lib/depot/format';
import { kpiRows } from '@/lib/depot/network/overviewModel';
import type { NetworkKpis } from '@/lib/depot/types';

const COUNT_UP_MS = 700;
const DONE = 1;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Progress of the one count-up the band is allowed: 0 to 1 over the first
 * mount, then 1 for good, so a poll update replaces a figure without moving
 * it. Under reduced motion it starts at 1 and never animates.
 */
function useFirstMountProgress(): number {
  const [progress, setProgress] = useState<number>(() => (prefersReducedMotion() ? DONE : 0));

  useEffect(() => {
    if (progress === DONE) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number): void => {
      const linear = Math.min(DONE, (now - start) / COUNT_UP_MS);
      setProgress(1 - (1 - linear) ** 3);
      if (linear < DONE) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // Runs once: later renders must never restart the count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return progress;
}

export interface KpiBandProps {
  readonly kpis: NetworkKpis;
}

/**
 * The eight network figures. Each carries its label, where it comes from and,
 * for a bus count, its share of the fleet. Hairlines separate the cells; there
 * is no card per figure.
 */
export function KpiBand({ kpis }: KpiBandProps) {
  const progress = useFirstMountProgress();
  const rows = kpiRows(kpis);

  return (
    <section aria-labelledby="depot-kpi-heading" data-testid="depot-kpi-band">
      <h2 id="depot-kpi-heading" className="sr-only">
        Network figures
      </h2>
      <dl className="depot-kpi-grid">
        {rows.map((row) => {
          const shown =
            progress === DONE ? row.figure.value : Math.round(row.figure.value * progress);
          return (
            <div key={row.key} className="depot-kpi-cell" data-testid={`depot-kpi-${row.key}`}>
              <dt className="depot-label">{row.label}</dt>
              <dd className="depot-hero-numeral mt-2">{formatCount(shown)}</dd>
              <dd className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                <ProvenanceBadge
                  provenance={row.figure.provenance}
                  coverage={row.figure.coverage}
                />
                {row.share !== null ? (
                  <span className="text-[11px] text-depot-muted">{row.share} of fleet</span>
                ) : null}
              </dd>
              {row.figure.note ? (
                <dd className="mt-1 font-sans text-xs leading-snug text-depot-faint">
                  {row.figure.note}
                </dd>
              ) : null}
            </div>
          );
        })}
      </dl>
    </section>
  );
}
