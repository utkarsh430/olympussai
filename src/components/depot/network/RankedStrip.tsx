import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import Link from 'next/link';
import { DisclosureChevron } from '@/components/depot/shell/DisclosureChevron';
import { windowMark } from '@/lib/depot/league/leagueWording';
import { SUGGESTION_NOTE } from '@/lib/depot/network/mapWords';
import { PEER_GROUP_LABEL } from '@/lib/depot/labels';
import { depotLink } from '@/lib/depot/network/mapWords';
import { unrankedSentence } from '@/lib/depot/network/overviewWords';
import { indexBand } from '@/lib/depot/map/nodeStyle';
import { MIN_FLEET_FOR_RANK } from '@/lib/depot/score/config';
import {
  formatIndex,
  rankedExtremes,
  rankedIndex,
  unrankedSummary,
  type DepotRow,
} from '@/lib/depot/network/overviewModel';

export interface RankedStripProps {
  readonly rows: readonly DepotRow[];
  readonly selectedId: string | null;
  readonly onSelect: (depotId: string) => void;
  /** The index window's snapshot count: a depot scored on fewer carries the league's "new" mark. */
  readonly windowSamples?: number;
}

/** A click on the depot's own link is the link's, not the row's. */
function fromControl(target: EventTarget): boolean {
  return target instanceof Element && target.closest('a, button') !== null;
}

function RankList({
  title,
  rows,
  selectedId,
  onSelect,
  empty,
  windowSamples,
  note,
}: RankedStripProps & { readonly title: string; readonly empty: string; readonly note?: string }) {
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
            const selected = row.depot.id === selectedId;
            const href = depotLink(row.depot);
            const mark = windowMark(row.score?.samples, windowSamples);
            return (
              <li
                key={row.depot.id}
                tabIndex={0}
                data-testid="depot-ranked-row"
                aria-label={`${row.depot.name}, index ${formatIndex(index)}${selected ? ', selected' : ''}: Enter selects it`}
                onClick={(event) => {
                  if (!fromControl(event.target)) onSelect(row.depot.id);
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || event.target !== event.currentTarget) return;
                  event.preventDefault();
                  onSelect(row.depot.id);
                }}
                className={`group flex min-w-0 cursor-pointer items-baseline gap-3 border-b border-l-2 border-b-depot-line px-2 py-1.5 hover:bg-depot-raised focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-holo-glow ${
                  selected ? 'border-l-holo-glow bg-depot-selected' : 'border-l-transparent'
                }`}
              >
                <span className="min-w-0 flex-1 truncate text-[13px] text-depot-ink">
                  {href ? (
                    <Link href={href} className="depot-link">
                      {row.depot.name}
                    </Link>
                  ) : (
                    row.depot.name
                  )}
                  <span className="ml-2 text-[11px] text-depot-muted">
                    {group ? PEER_GROUP_LABEL[group] : ''}
                  </span>
                  {mark ? (
                    <span className="ml-2 text-[11px] text-depot-faint" title={mark.title}>
                      {mark.word}
                      <span className="sr-only">{`: ${mark.title}`}</span>
                    </span>
                  ) : null}
                  {selected ? <span className="sr-only">, selected</span> : null}
                </span>
                <span className="flex shrink-0 items-center gap-2 tabular-nums">
                  <span
                    aria-hidden
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: indexBand(index)?.fill }}
                  />
                  <span className="text-[13px] text-depot-ink">{formatIndex(index)}</span>
                </span>
                <span aria-hidden className="invisible shrink-0 group-hover:visible group-focus-visible:visible">
                  <DisclosureChevron />
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {note ? <p className="depot-note mt-1.5 text-[12px]">{note}</p> : null}
    </div>
  );
}

/**
 * The five highest and five lowest Depot Efficiency Index values. Each row selects its
 * depot (click or Enter, one chevron at its end), which is how the map's selection is
 * reached without the map; the name stays the depot link.
 */
export function RankedStrip({ rows, selectedId, onSelect, windowSamples }: RankedStripProps) {
  const { top, bottom } = rankedExtremes(rows);
  const unranked = unrankedSummary(rows);

  return (
    <section aria-labelledby="depot-ranked-heading" data-testid="depot-ranked-strip">
      <SectionLabel
        id="depot-ranked-heading"
        label="Efficiency index · highest and lowest operating depots"
      />
      {top.length === 0 ? (
        <StatePanel
          kind="not-ranked"
          rows={5}
          testId="depot-ranked-empty"
          sentence={`No depot can be ranked on this snapshot: a depot needs at least ${MIN_FLEET_FOR_RANK} buses in the feed to be compared with its peers.`}
          remedy="A depot is ranked once enough of its buses report."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <RankList
              title="Highest index"
              rows={top}
              selectedId={selectedId}
              onSelect={onSelect}
              windowSamples={windowSamples}
              empty=""
            />
            <RankList
              title="Lowest index"
              rows={bottom}
              selectedId={selectedId}
              onSelect={onSelect}
              windowSamples={windowSamples}
              empty="Every ranked depot is already listed as highest."
              note={SUGGESTION_NOTE}
            />
          </div>
          {unranked.total > 0 ? (
            <p className="mt-2 font-sans text-[13px] text-depot-prose">{unrankedSentence(unranked)}</p>
          ) : null}
        </>
      )}
    </section>
  );
}
