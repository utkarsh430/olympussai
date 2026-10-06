import { indexBand } from '@/lib/depot/map/nodeStyle';
import { MIN_FLEET_FOR_RANK } from '@/lib/depot/score/config';
import {
  PEER_GROUP_LABEL,
  formatIndex,
  rankedExtremes,
  rankedIndex,
  unrankedSummary,
  type DepotRow,
  type UnrankedSummary,
} from '@/lib/depot/network/overviewModel';

export interface RankedStripProps {
  readonly rows: readonly DepotRow[];
  readonly selectedId: string | null;
  readonly onSelect: (depotId: string) => void;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "12 depots are not ranked: 9 with fewer than 10 buses, 3 not operating depots." */
function unrankedSentence(summary: UnrankedSummary): string {
  const parts = [
    summary.fleetTooSmall > 0
      ? `${summary.fleetTooSmall} with fewer than ${MIN_FLEET_FOR_RANK} buses`
      : null,
    summary.notADepot > 0 ? `${summary.notADepot} not operating depots` : null,
    summary.unscored > 0 ? `${summary.unscored} without a score` : null,
  ].filter((part): part is string => part !== null);
  const verb = summary.total === 1 ? 'is' : 'are';
  return `${plural(summary.total, 'unit', 'units')} ${verb} not ranked: ${parts.join(', ')}.`;
}

function RankList({
  title,
  rows,
  selectedId,
  onSelect,
  empty,
}: RankedStripProps & { readonly title: string; readonly empty: string }) {
  return (
    <div className="min-w-0">
      <h3 className="depot-label mb-1.5">{title}</h3>
      {rows.length === 0 ? (
        <p className="depot-prose">{empty}</p>
      ) : (
        <ol className="border-t border-depot-line">
          {rows.map((row) => {
            const index = rankedIndex(row);
            const group = row.score?.peerGroup;
            return (
              <li key={row.depot.id} className="border-b border-depot-line">
                <button
                  type="button"
                  aria-pressed={row.depot.id === selectedId}
                  onClick={() => onSelect(row.depot.id)}
                  className="depot-pick-button"
                >
                  <span className="min-w-0 truncate text-[13px] text-depot-ink">
                    {row.depot.name}
                    <span className="ml-2 text-[11px] text-depot-faint">
                      {group ? PEER_GROUP_LABEL[group] : ''}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 tabular-nums">
                    <span
                      aria-hidden
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: indexBand(index)?.fill }}
                    />
                    <span className="text-[13px] text-depot-ink">{formatIndex(index)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/**
 * The five highest and five lowest Depot Efficiency Index values. Each entry
 * selects its depot, which is how the map's selection is reached without the map.
 */
export function RankedStrip({ rows, selectedId, onSelect }: RankedStripProps) {
  const { top, bottom } = rankedExtremes(rows);
  const unranked = unrankedSummary(rows);

  return (
    <section aria-labelledby="depot-ranked-heading" data-testid="depot-ranked-strip">
      <h2 id="depot-ranked-heading" className="depot-section-label">
        Efficiency index · highest and lowest
      </h2>
      {top.length === 0 ? (
        <p className="depot-prose" data-testid="depot-ranked-empty">
          No depot can be ranked on this snapshot: a depot needs at least {MIN_FLEET_FOR_RANK} buses
          in the feed to be compared with its peers.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <RankList
              title="Highest index"
              rows={top}
              selectedId={selectedId}
              onSelect={onSelect}
              empty=""
            />
            <RankList
              title="Lowest index"
              rows={bottom}
              selectedId={selectedId}
              onSelect={onSelect}
              empty="Every ranked depot is already listed as highest."
            />
          </div>
          {unranked.total > 0 ? (
            <p className="mt-2 text-[11px] text-depot-faint">{unrankedSentence(unranked)}</p>
          ) : null}
        </>
      )}
    </section>
  );
}
