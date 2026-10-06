import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import type { FuelGroupRow } from '@/lib/depot/fuel/types';
import { classBars } from '@/lib/depot/fuel/fuelPageModel';

/**
 * The page's one hero: kilometres per litre by service class, one labelled bar
 * per class on a zero baseline, one hue, the value written beside each bar. The
 * list itself is the text equivalent.
 */
export function ClassBars({ rows }: { readonly rows: readonly FuelGroupRow[] }) {
  const bars = classBars(rows);
  return (
    <section aria-labelledby="depot-fuel-class-heading" className="animate-rise">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="depot-fuel-class-heading" className="depot-section-label !mb-0">
          Kilometres per litre by service class
        </h2>
        <ProvenanceBadge provenance="modelled" />
      </div>
      <ul className="flex flex-col gap-3">
        {bars.map((bar) => (
          <li
            key={bar.key}
            className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 sm:grid-cols-[6.5rem_minmax(0,1fr)_11rem]"
          >
            <span className="font-mono text-[13px] text-depot-ink">{bar.label}</span>
            <div className="relative h-3 self-center rounded-[2px] bg-depot-raised">
              <div
                className="absolute inset-y-0 left-0 rounded-[2px] bg-holo-glow"
                style={{ width: `${bar.widthPct}%` }}
              />
            </div>
            <span className="col-span-2 min-w-0 font-mono text-[12px] tabular-nums text-depot-muted sm:col-span-1">
              <span className="text-depot-ink">{bar.valueText}</span>
              <span className="block text-[11px]">{bar.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
