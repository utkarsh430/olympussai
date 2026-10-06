import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import { formatCount, formatShare } from '@/lib/depot/format';
import { DEPOT_KIND_LABEL, PEER_GROUP_LABEL, RANK_REASON_LABEL } from '@/lib/depot/labels';
import { indexBand } from '@/lib/depot/map/nodeStyle';
import {
  formatIndex,
  rankedIndex,
  selectionStatus,
  type DepotRow,
} from '@/lib/depot/network/overviewModel';
import { StatusMixBar, stateSegments } from './StatusMixBar';

export interface DepotMapPanelProps {
  /** The selected depot, or null when nothing is selected. */
  readonly row: DepotRow | null;
  readonly onClear: () => void;
  /** True when the depot selected earlier has dropped out of the feed. */
  readonly vanished?: boolean;
}

function Ranking({ row }: { readonly row: DepotRow }) {
  const index = rankedIndex(row);
  const score = row.score;
  if (index === null || !score) {
    const reason = score ? RANK_REASON_LABEL[score.reason] : 'No score for this depot';
    return (
      <p className="text-[13px] text-depot-muted">
        Not ranked <span className="text-depot-faint">· {reason}</span>
      </p>
    );
  }
  return (
    <>
      <p className="flex items-baseline gap-2">
        <span className="font-display text-2xl font-semibold tabular-nums text-depot-ink">
          {formatIndex(index)}
        </span>
        <span className="text-[11px] text-depot-muted">{indexBand(index)?.label}</span>
      </p>
      {score.rank !== null && score.peerCount !== null && score.peerGroup ? (
        <p className="mt-1 text-[13px] text-depot-muted">
          Rank {score.rank} of {score.peerCount} · {PEER_GROUP_LABEL[score.peerGroup]}
        </p>
      ) : null}
    </>
  );
}

/**
 * Summary of the selected depot beside the map. It is fed by the shared
 * selection, so the ranked lists and the table fill it as well as the map.
 */
export function DepotMapPanel({ row, onClear, vanished = false }: DepotMapPanelProps) {
  const status = (
    <p role="status" className="sr-only">
      {selectionStatus(row)}
    </p>
  );
  if (!row) {
    return (
      <aside className="depot-panel relative min-w-0 p-4" data-testid="depot-map-panel">
        {status}
        <h3 id="depot-panel-heading" tabIndex={-1} className="depot-label">
          Selected depot
        </h3>
        <p className="depot-prose mt-2">
          {vanished ? 'The selected depot is no longer in the feed. ' : null}
          Select a depot on the map, in the ranked lists or in the table to see its fleet, state and
          index here.
        </p>
      </aside>
    );
  }

  const { depot } = row;
  const segments = stateSegments(depot.states);

  return (
    <aside className="depot-panel relative min-w-0 p-4" data-testid="depot-map-panel">
      {status}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="depot-label">Selected depot</p>
          <h3
            id="depot-panel-heading"
            tabIndex={-1}
            className="mt-1 break-words text-[15px] text-depot-ink"
          >
            {depot.name}
          </h3>
          <p className="text-[11px] text-depot-muted">{DEPOT_KIND_LABEL[depot.kind]}</p>
        </div>
        <button type="button" onClick={onClear} className="depot-filter-button shrink-0">
          Clear
        </button>
      </div>

      <dl className="mt-4 space-y-4">
        <div>
          <dt className="depot-label">Fleet</dt>
          <dd className="mt-1 text-[13px] tabular-nums text-depot-ink">
            {formatCount(depot.fleet)} buses
          </dd>
          <dd className="mt-1 text-[11px] text-depot-muted">
            Position: median of {formatCount(depot.positioned)} positioned buses (derived)
          </dd>
        </div>
        <div>
          <dt className="depot-label flex items-center gap-2">
            State <ProvenanceBadge provenance="derived" />
          </dt>
          <dd className="mt-2">
            <StatusMixBar segments={segments} caption="State" width={240} />
            <ul className="mt-2 space-y-0.5 text-[13px] tabular-nums">
              {segments.map((segment) => (
                <li key={segment.key} className="flex justify-between gap-3">
                  <span className="text-depot-muted">{segment.label}</span>
                  <span className="text-depot-ink">
                    {formatCount(segment.count)}{' '}
                    <span className="text-depot-faint">
                      {formatShare(segment.count, depot.fleet)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </dd>
        </div>
        <div>
          <dt className="depot-label flex items-center gap-2">
            Efficiency index <ProvenanceBadge provenance="derived" />
          </dt>
          <dd className="mt-1">
            <Ranking row={row} />
          </dd>
        </div>
      </dl>
    </aside>
  );
}
