import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import { formatCount } from '@/lib/depot/format';
import type { YardModel } from '@/lib/depot/yard/yardModel';

const TILES = [
  { key: 'inYard', label: 'In the yard' },
  { key: 'visitors', label: 'Visitors' },
  { key: 'away', label: 'Away' },
  { key: 'unknown', label: 'Location unknown' },
] as const;

/**
 * Occupancy as counts only: no capacity exists in this phase, so there is no
 * percentage and no gauge. Each count is tagged DERIVED because the yard is inferred.
 */
export function YardSummary({ model }: { readonly model: YardModel }) {
  if (!model.established) {
    return (
      <section
        aria-labelledby="yard-not-established"
        data-testid="yard-not-established"
        className="depot-panel p-4"
      >
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="yard-not-established" className="depot-section-label !mb-0">
            Yard not established
          </h2>
          <ProvenanceBadge provenance="derived" />
        </div>
        <p className="mt-2 text-[13px] text-depot-ink">{model.basis}</p>
        <p className="depot-prose mt-2">{model.rule}</p>
        <p className="depot-prose mt-2">
          This depot has{' '}
          <span className="tabular-nums text-depot-ink">
            {formatCount(model.parkedWithPosition)}
          </span>{' '}
          parked {model.parkedWithPosition === 1 ? 'bus' : 'buses'} with a position.
        </p>
        <p className="depot-prose mt-2">
          A yard appears once more of the depot&apos;s buses are parked together and reporting their
          position. Until then every bus is listed below by state only.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="yard-summary" data-testid="yard-summary" className="depot-panel p-4">
      <h2 id="yard-summary" className="sr-only">
        Yard occupancy
      </h2>
      <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {TILES.map((tile) => (
          <div key={tile.key} className="min-w-0">
            <dt className="depot-label">{tile.label}</dt>
            <dd className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="depot-hero-numeral !text-2xl">
                {formatCount(model.counts[tile.key])}
              </span>
              <ProvenanceBadge provenance="derived" />
            </dd>
          </div>
        ))}
      </dl>
      <p className="depot-prose mt-4">{model.basis}</p>
    </section>
  );
}
