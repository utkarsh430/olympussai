import Link from 'next/link';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import { formatCount, formatShare } from '@/lib/depot/format';
import { DEPOT_KIND_LABEL, RANK_REASON_LABEL } from '@/lib/depot/labels';
import { indexBand } from '@/lib/depot/map/nodeStyle';
import {
  LOWEST_OPERATING_LABEL,
  depotLink,
  lowestOperatingDepot,
  peerRankLine,
  positionNote,
} from '@/lib/depot/network/mapWords';
import {
  formatIndex,
  rankedIndex,
  selectionStatus,
  type DepotRow,
} from '@/lib/depot/network/overviewModel';
import { clearSelection, PANEL_HEADING_ID } from './clearSelection';
import { StatusMixBar, stateSegments } from './StatusMixBar';

export interface DepotMapPanelProps {
  /** The selected depot, or null when nothing is selected. */
  readonly row: DepotRow | null;
  /** Every row, so the empty panel can offer the lowest-index operating depot. */
  readonly rows: readonly DepotRow[];
  readonly onSelect: (depotId: string) => void;
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
        Not ranked <span className="text-depot-muted">· {reason}</span>
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
          {peerRankLine(score.rank, score.peerCount, score.peerGroup)}
        </p>
      ) : null}
    </>
  );
}

/**
 * Summary of the selected depot beside the map. It is fed by the shared
 * selection, so the ranked lists and the table fill it as well as the map.
 */
function OpenDepot({ row }: { readonly row: DepotRow }) {
  const href = depotLink(row.depot);
  if (!href) return null;
  return (
    <Link href={href} className="depot-link text-[13px]">
      Open depot<span className="sr-only">{` ${row.depot.name}`}</span>
    </Link>
  );
}

/** Content-sized empty state: something to act on instead of a tall blank box. */
function Suggestion({
  rows,
  onSelect,
}: {
  readonly rows: readonly DepotRow[];
  readonly onSelect: (depotId: string) => void;
}) {
  const lowest = lowestOperatingDepot(rows);
  if (!lowest) return null;
  return (
    <div className="mt-3 border-t border-depot-line pt-3">
      <p className="depot-label">{LOWEST_OPERATING_LABEL}</p>
      <p className="mt-1 flex min-w-0 items-baseline justify-between gap-3">
        <span className="min-w-0 break-words text-[13px] text-depot-ink">{lowest.depot.name}</span>
        <span className="shrink-0 text-[13px] tabular-nums text-depot-ink">
          {formatIndex(rankedIndex(lowest))}
        </span>
      </p>
      <p className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => onSelect(lowest.depot.id)}
          className="depot-filter-button"
        >
          Select it
        </button>
        <OpenDepot row={lowest} />
      </p>
    </div>
  );
}

/**
 * Summary of the selected depot beside the map. It is fed by the shared
 * selection, so the ranked lists and the table fill it as well as the map.
 * It is as tall as its content, never stretched to the map's height.
 */
export function DepotMapPanel({
  row,
  rows,
  onSelect,
  onClear,
  vanished = false,
}: DepotMapPanelProps) {
  const status = (
    <p role="status" className="sr-only">
      {selectionStatus(row)}
    </p>
  );
  if (!row) {
    return (
      <aside className="depot-panel relative min-w-0 p-4" data-testid="depot-map-panel">
        {status}
        <h3 id={PANEL_HEADING_ID} tabIndex={-1} className="depot-label">
          Selected depot
        </h3>
        <p className="depot-prose mt-1">
          {vanished ? 'The selected depot is no longer in the feed. ' : null}
          Nothing selected. Pick a depot on the map, in the lists or in the table.
        </p>
        <Suggestion rows={rows} onSelect={onSelect} />
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
            id={PANEL_HEADING_ID}
            tabIndex={-1}
            className="mt-1 break-words text-[15px] text-depot-ink"
          >
            {depot.name}
          </h3>
          <p className="text-[11px] text-depot-muted">{DEPOT_KIND_LABEL[depot.kind]}</p>
        </div>
        <span className="flex shrink-0 items-center gap-3">
          <OpenDepot row={row} />
          <button
            type="button"
            onClick={() => clearSelection(onClear)}
            className="depot-filter-button"
          >
            Clear
          </button>
        </span>
      </div>

      <dl className="mt-3 space-y-3">
        <div>
          <dt className="depot-label">Fleet</dt>
          <dd className="mt-1 text-[13px] tabular-nums text-depot-ink">
            {formatCount(depot.fleet)} buses
          </dd>
          <dd className="mt-1 text-[11px] text-depot-muted">{positionNote(depot)}</dd>
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
                    <span className="text-depot-muted">
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
