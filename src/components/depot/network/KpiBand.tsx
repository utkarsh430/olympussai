'use client';

import { useEffect, useState } from 'react';
import { Figure, FigureBand } from '@/components/depot/shell/FigureBand';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import { KpiWeekTrend } from '@/components/depot/trends/WeekTrend';
import { formatCount } from '@/lib/depot/format';
import { figureTag, kpiLayout, secondaryReading } from '@/lib/depot/network/overviewWords';
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

export interface KpiBandProps {
  readonly kpis: NetworkKpis;
  readonly depots: readonly Pick<DepotSummary, 'kind'>[];
}

/**
 * One FigureBand of five figures (four bus counts and operating depots), the three
 * remaining figures as one quiet line, then the week's MODELLED trends on a line of
 * their own. The trends are shares with their own definitions (on-road share, dark
 * rate), not the counts in the band, so they are not placed under a count where they
 * could be read as its trend; each names its measure, and the line carries the tag.
 * No LIVE tag on a figure: the page's provenance line and the feed chip say it.
 */
export function KpiBand({ kpis, depots }: KpiBandProps) {
  const progress = useFirstMountProgress();
  const { primary, secondary } = kpiLayout(kpis, depots);

  return (
    <section aria-label="Network figures" data-testid="depot-kpi-band">
      <FigureBand label="Network figures">
        {primary.map((figure) => {
          const shown = progress === DONE ? figure.value : Math.round(figure.value * progress);
          return (
            <Figure
              key={figure.key}
              label={figure.label}
              value={formatCount(shown)}
              caption={figure.note ?? undefined}
              tag={figureTag(figure.provenance)}
            />
          );
        })}
      </FigureBand>
      <p className="-mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] tabular-nums text-depot-muted">
        {secondary.map((figure) => (
          <span key={figure.key} data-testid={`depot-kpi-${figure.key}`} title={figure.detail ?? undefined}>
            {secondaryReading(figure)}
            {figureTag(figure.provenance) ? (
              <span className="ml-1.5">
                <ProvenanceBadge provenance={figure.provenance} />
              </span>
            ) : null}
          </span>
        ))}
      </p>
      <dl className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 [&:not(:has(dd))]:hidden" data-testid="depot-kpi-trends">
        <dt className="flex items-center gap-2">
          <ProvenanceBadge provenance="modelled" />
          <span className="depot-label">Week trend</span>
        </dt>
        <KpiWeekTrend figure="onRoad" />
        <KpiWeekTrend figure="noSignal" />
      </dl>
    </section>
  );
}
