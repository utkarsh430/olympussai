import Link from 'next/link';
import { depotHref } from '@/lib/depot/depotNav';
import { metricCellWording } from '@/lib/depot/league/leagueWording';
import {
  unrankedSentence,
  type ComponentCell,
  type DifferenceDirection,
  type LeagueRow,
} from '@/lib/depot/league/leagueModel';
import { IndexBar } from './IndexBar';

/** Colour only reinforces the word in the cell's title and screen-reader text. */
const DIRECTION_TONE: Readonly<Record<DifferenceDirection, string>> = {
  better: 'text-alert-green',
  worse: 'text-alert-amber',
  level: 'text-depot-faint',
  unknown: 'text-depot-faint',
};

/** Value and signed difference from the peer median on one line, in tabular mono. */
export function MetricCell({ cell }: { readonly cell: ComponentCell | undefined }) {
  if (!cell) return <span className="text-depot-faint">—</span>;
  const wording = metricCellWording(cell);
  return (
    <span className="whitespace-nowrap" title={wording.description}>
      <span aria-hidden>{wording.value}</span>
      <span aria-hidden className={`ml-2 inline-block w-[5.5rem] ${DIRECTION_TONE[wording.direction]}`}>
        {wording.difference}
      </span>
      <span className="sr-only">{wording.description}</span>
    </span>
  );
}

/**
 * The depot name links to its cockpit; the select button beside it opens the
 * score breakdown. The unassigned bucket is not a fleet, so it gets no link.
 */
export function DepotCell({
  row,
  selected,
  onSelect,
}: {
  readonly row: LeagueRow;
  readonly selected: boolean;
  readonly onSelect: (row: LeagueRow) => void;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {row.kind === 'unassigned' ? (
        <span className="min-w-0 truncate" title={row.name}>{row.name}</span>
      ) : (
        <Link
          href={depotHref(row.depotId)}
          title={`Open ${row.name}`}
          className="min-w-0 truncate text-holo-glow underline-offset-2 hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          {row.name}
        </Link>
      )}
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`Score breakdown for ${row.name}`}
        className="ml-auto shrink-0 rounded-[3px] border border-depot-line px-1.5 text-[11px] uppercase tracking-[0.08em] text-depot-muted hover:text-depot-ink aria-pressed:border-holo-glow aria-pressed:text-holo-glow"
        onClick={(event) => {
          event.stopPropagation();
          onSelect(row);
        }}
      >
        Score
      </button>
    </span>
  );
}

/** Index numeral, with the bar from `lg` up; an unranked row says why in its title. */
export function IndexCell({ row }: { readonly row: LeagueRow }) {
  if (row.index === null) {
    const reason = unrankedSentence(row) ?? 'Not ranked';
    return (
      <span className="text-[11px] text-depot-faint" title={reason}>
        not ranked<span className="sr-only">{`: ${reason}`}</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <span className="w-10 text-right">{row.index.toFixed(1)}</span>
      <span className="hidden w-16 lg:inline-flex">
        <IndexBar value={row.index} />
      </span>
    </span>
  );
}
