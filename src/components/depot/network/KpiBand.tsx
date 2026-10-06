'use client';

import { useEffect, useState } from 'react';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import { KpiWeekTrend } from '@/components/depot/trends/WeekTrend';
import { formatCount } from '@/lib/depot/format';
import { kpiLayout, type KpiFigure } from '@/lib/depot/network/overviewWords';
import type { DepotSummary, NetworkKpis } from '@/lib/depot/types';

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

/** The provenance word, then the quiet coverage note in prose-sized mono. */
function Provenance({ figure }: { readonly figure: KpiFigure }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <ProvenanceBadge provenance={figure.provenance} />
      {figure.note ? <span className="text-[11px] text-depot-muted">{figure.note}</span> : null}
    </span>
  );
}

export interface KpiBandProps {
  readonly kpis: NetworkKpis;
  readonly depots: readonly Pick<DepotSummary, 'kind'>[];
}

/**
 * Four primary bus figures in one row at hero size, then the secondary figures
 * as small inline readings beneath, so the map (the page's hero) rises into
 * the first screen. Hairlines separate the cells; there is no card per figure.
 */
export function KpiBand({ kpis, depots }: KpiBandProps) {
  const progress = useFirstMountProgress();
  const { primary, secondary } = kpiLayout(kpis, depots);

  return (
    <section aria-labelledby="depot-kpi-heading" data-testid="depot-kpi-band">
      <h2 id="depot-kpi-heading" className="sr-only">
        Network figures
      </h2>
      <dl className="depot-kpi-grid">
        {primary.map((figure) => {
          const shown = progress === DONE ? figure.value : Math.round(figure.value * progress);
          return (
            <div key={figure.key} className="depot-kpi-cell" data-testid={`depot-kpi-${figure.key}`}>
              <dt className="depot-label">{figure.label}</dt>
              <dd className="depot-hero-numeral mt-1.5">{formatCount(shown)}</dd>
              <dd className="mt-1.5">
                <Provenance figure={figure} />
              </dd>
              <KpiWeekTrend figure={figure.key} />
            </div>
          );
        })}
      </dl>
      <dl className="depot-kpi-secondary">
        {secondary.map((figure) => (
          <div key={figure.key} className="min-w-0" data-testid={`depot-kpi-${figure.key}`}>
            <dt className="depot-label">{figure.label}</dt>
            <dd className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-[15px] tabular-nums text-depot-ink">
                {formatCount(figure.value)}
              </span>
              <Provenance figure={figure} />
            </dd>
            {figure.detail ? (
              <dd className="mt-0.5 font-sans text-xs leading-snug text-depot-muted">
                {figure.detail}
              </dd>
            ) : null}
          </div>
        ))}
      </dl>
    </section>
  );
}
