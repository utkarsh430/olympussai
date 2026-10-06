'use client';

import { useState } from 'react';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import { heroBars } from '@/lib/depot/revenue/revenuePageModel';
import type { RouteRevenueFigure } from '@/lib/depot/revenue/types';

/**
 * The page's one hero: revenue by route as labelled bars, one hue, the value
 * written beside every bar. Capped to the top routes with a "Show all N"
 * control; the bars are also listed in the table below.
 */
export function RevenueHero({ routes }: { readonly routes: readonly RouteRevenueFigure[] }) {
  const [showAll, setShowAll] = useState(false);
  const hero = heroBars(routes, showAll);
  return (
    <section aria-labelledby="revenue-hero-title" className="depot-panel min-w-0 p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 id="revenue-hero-title" className="depot-label">
          Revenue by route (modelled)
        </h2>
        <ProvenanceBadge provenance="modelled" />
      </div>
      {hero.bars.length === 0 ? (
        <p className="depot-prose mt-3">
          No route has a bus running in the feed now, so there is no revenue to model.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1.5" aria-label="Modelled revenue by route">
          {hero.bars.map((bar) => (
            <li
              key={bar.key}
              title={bar.description}
              className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_6.5rem] items-center gap-x-3 text-xs sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_7rem]"
            >
              <span className="truncate text-depot-ink">{bar.label}</span>
              <span aria-hidden className="block h-3 rounded-[2px] bg-depot-raised">
                <span
                  className="block h-3 rounded-[2px] bg-holo-glow"
                  style={{ width: `${bar.widthPercent}%` }}
                />
              </span>
              <span className="text-right font-mono tabular-nums text-depot-ink">{bar.valueText}</span>
              <span className="sr-only">{bar.description}</span>
            </li>
          ))}
        </ul>
      )}
      {hero.toggleLabel ? (
        <button
          type="button"
          aria-pressed={showAll}
          onClick={() => setShowAll((value) => !value)}
          className="mt-3 rounded-[3px] border border-depot-line px-2 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-depot-muted hover:text-depot-ink"
        >
          {hero.toggleLabel}
        </button>
      ) : null}
    </section>
  );
}
