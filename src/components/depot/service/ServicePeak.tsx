'use client';

import Link from 'next/link';
import { Figure, FigureBand } from '@/components/depot/shell/FigureBand';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import { useNetworkHourly } from '@/hooks/useNetworkHourly';
import { formatCount } from '@/lib/depot/format';
import { meaningToneClass } from '@/lib/depot/palette';
import { DASH } from '@/lib/depot/service/serviceWording';
import { depotPeakWords, nextPeakSummary, serviceHref } from '@/lib/depot/service/serviceSummary';

const NETWORK_ASK = { band: null, depotId: null, page: 0 } as const;
const UNAVAILABLE = 'Service by the hour is unavailable now.';

/**
 * The overview's figure: routes short at the next peak across the network, MODELLED (the
 * need rests on modelled demand), linking to "Service by the hour".
 */
export function ServicePeakFigure() {
  const { data, error } = useNetworkHourly(NETWORK_ASK);
  const summary = data === null ? null : nextPeakSummary(data);
  const caption =
    summary !== null
      ? `Of ${formatCount(summary.routes)} routes, ${summary.peak}`
      : error !== null
        ? UNAVAILABLE
        : 'Loading the network’s hours';
  return (
    <section aria-label="Service by the hour" data-testid="service-peak-figure">
      <FigureBand label="Service by the hour">
        <Figure
          label="Routes short at the next peak"
          value={summary === null ? DASH : formatCount(summary.short)}
          caption={caption}
          tag="modelled"
          tone={summary !== null && summary.short > 0 ? 'worse' : undefined}
          href={serviceHref(null)}
        />
      </FigureBand>
    </section>
  );
}

/**
 * The cockpit's attention line for one depot: its routes short at the next peak, MODELLED,
 * linking to "Service by the hour" filtered to the depot. Silent while it loads; a fixed
 * sentence when the hours are unavailable.
 */
export function ServicePeakLine({ depotId }: { readonly depotId: string }) {
  const { data, error } = useNetworkHourly({ band: null, depotId, page: 0 });
  if (data === null) {
    return error === null ? null : <p className="depot-note" data-testid="service-peak-line">{UNAVAILABLE}</p>;
  }
  const summary = nextPeakSummary(data);
  return (
    <Link
      href={serviceHref(depotId)}
      data-testid="service-peak-line"
      className="group flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1 border-y border-depot-line py-2 hover:bg-depot-surface focus-visible:bg-depot-surface"
    >
      <span
        className={`depot-figure-value w-14 shrink-0 text-right font-display text-[24px] tabular-nums leading-none ${meaningToneClass(summary.short > 0 ? 'worse' : 'count')}`}
      >
        {formatCount(summary.short)}
      </span>
      <span className="min-w-0 flex-1 font-sans text-sm text-depot-ink group-hover:underline">
        {depotPeakWords(summary)}
      </span>
      <ProvenanceBadge provenance="modelled" />
      <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.12em] text-depot-muted">
        Service by the hour
        <span aria-hidden> ›</span>
      </span>
    </Link>
  );
}
