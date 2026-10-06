import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import type { CockpitHeader } from '@/lib/depot/cockpit/cockpitModel';
import { formatCount } from '@/lib/depot/format';
import type { Provenance } from '@/lib/depot/types';

export interface DepotHeaderProps {
  readonly header: CockpitHeader;
}

function Fact({
  label,
  value,
  provenance,
}: {
  readonly label: string;
  readonly value: string;
  readonly provenance: Provenance;
}) {
  return (
    <div className="min-w-0">
      <dt className="depot-label">{label}</dt>
      <dd className="mt-1 flex flex-wrap items-center gap-2 text-[13px] tabular-nums text-depot-ink">
        <span className="min-w-0 break-words">{value}</span>
        <ProvenanceBadge provenance={provenance} />
      </dd>
    </div>
  );
}

/**
 * Who this depot is, kept quiet so the status board below stays the page's one
 * bold element: name, kind, fleet, and where its efficiency index places it among
 * its peers, or the league's own reason it has no rank.
 */
export function DepotHeader({ header }: DepotHeaderProps) {
  const rank =
    header.rank !== null && header.peerCount !== null
      ? `${header.rank} of ${header.peerCount}${header.peerGroupLabel ? ` · ${header.peerGroupLabel}` : ''}`
      : null;

  return (
    <section
      aria-labelledby="depot-cockpit-name"
      data-testid="depot-cockpit-header"
      className="animate-rise border-b border-depot-line pb-4"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2
          id="depot-cockpit-name"
          className="min-w-0 break-words font-mono text-base uppercase tracking-[0.1em] text-depot-ink"
        >
          {header.name}
        </h2>
        <span className="depot-label">{header.kindLabel}</span>
      </div>
      <dl className="mt-3 flex flex-wrap gap-x-10 gap-y-3">
        <Fact label="Fleet" value={`${formatCount(header.fleet)} buses`} provenance="live" />
        {header.ranked && header.index !== null ? (
          <>
            <Fact label="Efficiency index" value={header.index.toFixed(1)} provenance="derived" />
            {rank ? <Fact label="Rank in peer group" value={rank} provenance="derived" /> : null}
          </>
        ) : (
          <div className="min-w-0">
            <dt className="depot-label">Efficiency index</dt>
            <dd className="depot-prose mt-1" data-testid="depot-cockpit-unranked">
              Not ranked. {header.unrankedReason}
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}
