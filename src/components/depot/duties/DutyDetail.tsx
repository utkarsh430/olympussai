import type { BoardRow } from '@/lib/depot/duties/dutyBoardModel';

/**
 * A duty in full, opened by its row's expander in the chart and in the table: labels
 * and values, no sentence. The bus class shows only where it differs from the duty's.
 */
export function DutyDetail({ row }: { readonly row: BoardRow }) {
  const items: readonly (readonly [string, string])[] = [
    ['Route', row.routeName],
    ['Time', row.timeText],
    ['Class', row.classWord],
    ['State', row.stateWord],
    ...(row.registrationNumber === null
      ? []
      : ([['Bus', row.registrationNumber]] as const)),
    ...(row.standingWord === null ? [] : ([['Bus now', row.standingWord]] as const)),
    ...(row.busClassWord === null ? [] : ([['Bus class', row.busClassWord]] as const)),
  ];
  return (
    <dl
      data-testid="duty-row-detail"
      className="flex min-w-0 flex-wrap gap-x-6 gap-y-1 font-mono text-[11px]"
    >
      {items.map(([label, value]) => (
        <div key={label} className="flex min-w-0 gap-2">
          <dt className="uppercase tracking-[0.12em] text-depot-muted">{label}</dt>
          <dd className="truncate text-depot-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
