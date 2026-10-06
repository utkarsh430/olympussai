import { useId } from 'react';
import Link from 'next/link';
import { Sparkline } from '@/components/depot/trendChart/Sparkline';
import { DisclosureChevron } from '@/components/depot/shell/DisclosureChevron';
import { depotHref } from '@/lib/depot/depotNav';
import { unitSparkLabel, type TrendTableRow } from '@/lib/depot/forecast/trendsTableModel';
import { METRIC_LABEL } from '@/lib/depot/forecast/wording';
import { TREND_SPARK_PX, TREND_TEXT_MAX_PX } from '@/lib/depot/league/leagueColumns';
import { metricCellWording, windowMark } from '@/lib/depot/league/leagueWording';
import { unrankedSentence, type ComponentCell, type LeagueRow } from '@/lib/depot/league/leagueModel';
import { IndexBar } from './IndexBar';

/**
 * The depot's value only, in tabular mono. Its difference from the peer median and
 * whether that is better or worse are said in the cell's title and screen-reader text,
 * and shown in the breakdown.
 */
export function MetricCell({ cell }: { readonly cell: ComponentCell | undefined }) {
  if (!cell) return <span className="text-depot-faint">—</span>;
  const wording = metricCellWording(cell);
  return (
    <span title={wording.description}>
      <span aria-hidden>{wording.value}</span>
      <span className="sr-only">{wording.description}</span>
    </span>
  );
}

/**
 * The depot name links to its cockpit (the unassigned bucket is not a fleet, so it gets
 * no link). A depot scored on fewer snapshots than the window carries a quiet "new" with
 * the counts in its title, so a newcomer is not read as a settled rank.
 */
export function DepotCell({
  row,
  windowSamples,
}: {
  readonly row: LeagueRow;
  readonly windowSamples?: number;
}) {
  const mark = windowMark(row.samples, windowSamples);
  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
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
      {mark ? (
        <span className="shrink-0 text-[11px] text-depot-faint" title={mark.title}>
          {mark.word}
          <span className="sr-only">{`: ${mark.title}`}</span>
        </span>
      ) : null}
    </span>
  );
}

/**
 * The index cell IS the breakdown control: numeral and bar (the bar from 640px) form one
 * button named "Score breakdown for <depot>", described by the value it shows. An
 * unranked depot's button says "not ranked" with the reason in its title.
 */
export function IndexButton({
  row,
  selected,
  onSelect,
}: {
  readonly row: LeagueRow;
  readonly selected: boolean;
  readonly onSelect: (row: LeagueRow) => void;
}) {
  const valueId = useId();
  const reason = row.index === null ? (unrankedSentence(row) ?? 'Not ranked') : null;
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`Score breakdown for ${row.name}`}
      aria-describedby={valueId}
      className="flex w-full items-center gap-2 text-left focus-visible:outline-offset-[-2px] hover:text-holo-glow aria-pressed:text-holo-glow"
      onClick={(event) => {
        event.stopPropagation();
        onSelect(row);
      }}
    >
      {row.index === null ? (
        <span id={valueId} className="text-[11px] text-depot-faint" title={reason ?? undefined}>
          not ranked<span className="sr-only">{`: ${reason}`}</span>
        </span>
      ) : (
        <>
          <span id={valueId} className="w-10 text-right">{row.index.toFixed(1)}</span>
          <span aria-hidden className="hidden w-16 sm:inline-flex">
            <IndexBar value={row.index} />
          </span>
        </>
      )}
    </button>
  );
}

/**
 * The row-end chevron, shown while the row is hovered or holds focus, and turned (and kept
 * in view) while its breakdown is open, as the economics row's chevron is.
 */
export function OpenChevron({ open }: { readonly open: boolean }) {
  return (
    <span className={open ? '' : 'invisible group-focus-within:visible group-hover:visible'}>
      <DisclosureChevron open={open} />
    </span>
  );
}

/**
 * The MODELLED index history at the league's width: a 64px sparkline, then the four-weeks
 * change as a right-aligned signed figure (the trends convention; the words are in the title). Untagged: the column header carries MODELLED.
 */
export function TrendCell({ name, row }: { readonly name: string; readonly row?: TrendTableRow }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Sparkline
        values={row?.values ?? []}
        label={row?.sparkLabel ?? unitSparkLabel(METRIC_LABEL.index, name, null)}
        tagged={false}
        width={TREND_SPARK_PX}
      />
      {row ? (
        <span
          className="truncate text-right font-mono text-[12px] tabular-nums text-depot-muted"
          style={{ width: TREND_TEXT_MAX_PX }}
          title={row.fourWeeksText}
          data-testid="league-trend-figure"
        >
          {row.fourWeeksSigned}
        </span>
      ) : null}
    </span>
  );
}
