import { coverageRows, type CoverageWord } from '@/lib/depot/sources/sourcesModel';
import type { FieldCoverage } from '@/lib/depot/types';

/** The word carries the meaning; only Sparse takes the warning tone beside it. */
const WORD_TONE: Readonly<Record<CoverageWord, string>> = {
  Complete: 'text-alert-green',
  Partial: 'text-depot-muted',
  Sparse: 'text-alert-amber',
};

/**
 * Each bar in its word's colour, as the dashboard's health bars are: a complete field
 * green, a partial one cyan, a sparse one amber, so a 14% bar never looks like a full one.
 */
export const BAR_TONE: Readonly<Record<CoverageWord, string>> = {
  Complete: 'depot-tone-green',
  Partial: 'depot-tone-cyan',
  Sparse: 'depot-tone-amber',
};

/*
 * Every row sits on one fixed grid (label, track, count, word), so the tracks
 * start and end at the same x and the counts line up. The fill is drawn inside
 * a clipped track with no margin, so 100% ends exactly where the track does.
 */
const ROW_GRID =
  'grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 ' +
  'sm:grid-cols-[9rem_minmax(0,1fr)_200px_56px_4.5rem] sm:items-center';

/**
 * How many buses populate each field, most complete first. The exact count is
 * always written beside the bar, so the bar is only a visual aid.
 */
export function CoverageBars({ coverage }: { readonly coverage: readonly FieldCoverage[] }) {
  if (coverage.length === 0) {
    return (
      <p className="depot-prose" data-testid="depot-coverage-empty">
        No coverage was measured on this snapshot, because the feed returned no bus records.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-3" data-testid="depot-coverage-bars">
      {coverageRows(coverage).map((row) => (
        <li key={row.field} className={ROW_GRID}>
          <span className="min-w-0 truncate font-mono text-[13px] text-depot-ink">{row.label}</span>
          <span className={`text-right font-mono text-[11px] uppercase tracking-[0.08em] sm:order-last sm:text-left ${WORD_TONE[row.word]}`}>
            {row.word}
          </span>
          <span aria-hidden className="depot-bar-track col-span-2 overflow-hidden sm:col-span-1">
            <span
              className={`depot-bar-fill ${BAR_TONE[row.word]}`}
              data-testid="depot-coverage-fill"
              style={{ width: `${row.share * 100}%` }}
            />
          </span>
          {/* Count and share in fixed nowrap columns, so every row is one 20px line. */}
          <span className="whitespace-nowrap font-mono text-[13px] tabular-nums text-depot-muted sm:text-right">
            {row.count}
          </span>
          <span className="whitespace-nowrap text-right font-mono text-[13px] tabular-nums text-depot-muted">
            {row.percentText}
          </span>
        </li>
      ))}
    </ul>
  );
}
