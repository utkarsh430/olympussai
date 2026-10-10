'use client';

import { useEffect, useState } from 'react';
import { Figure, FigureBand } from '@/components/depot/shell/FigureBand';
import { formatCount } from '@/lib/depot/format';
import { figureTag, kpiLayout, type KpiFigure } from '@/lib/depot/network/overviewWords';
import type { DepotSummary, NetworkKpis } from '@/lib/depot/types';
import { WeekTrendNote } from './WeekTrendNote';
import { KPI_MEANING } from '@/lib/depot/figureTones';

const COUNT_UP_MS = 700;
const DONE = 1;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Progress of the one count-up the band is allowed: 0 to 1 over the first mount, then 1
 * for good, so a poll update replaces a figure without moving it. Under reduced motion
 * it starts at 1 and never animates.
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

function BandFigure({ figure, progress }: { readonly figure: KpiFigure; readonly progress: number }) {
  const shown = progress === DONE ? figure.value : Math.round(figure.value * progress);
  return (
    <Figure
      label={figure.label}
      value={formatCount(shown)}
      caption={figure.note ?? undefined}
      tag={figureTag(figure.provenance)}
      title={figure.detail ?? undefined}
      tone={KPI_MEANING[figure.key]}
      lead={figure.key === 'fleet'}
    />
  );
}

/**
 * One FigureBand of five: the fleet and the four classified states that add up to it, so
 * the row is full at 1440, 1280 and 1024 with no empty cell. Reporting and route assigned
 * are shares of the fleet and ride as its caption; the units count is on the map's label.
 * Then the week's MODELLED trends as the band's note. No LIVE tag on a figure: the page's
 * provenance line and the feed chip say it.
 */
export function KpiBand({ kpis, depots }: KpiBandProps) {
  const progress = useFirstMountProgress();
  const { figures } = kpiLayout(kpis, depots);

  return (
    <section aria-label="Headquarters figures" data-testid="depot-kpi-band">
      <FigureBand label="Headquarters figures">
        {figures.map((figure) => (
          <BandFigure key={figure.key} figure={figure} progress={progress} />
        ))}
      </FigureBand>
      <WeekTrendNote />
    </section>
  );
}
