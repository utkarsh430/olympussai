import { formatCount } from '@/lib/depot/format';
import type { DepotMeaning } from '@/lib/depot/palette';

/**
 * A repeated column (peer group, status, severity) printed once as a group row instead
 * of on every row. The page drops that column and passes
 * this to `DataTable`'s `group`.
 */
export interface TableGrouping<T> {
  /** The value the rows share ("Small fleets"). */
  readonly key: (row: T) => string;
  /** The group row's words; "<key> · <count>" by default (with `aside`, a third part). */
  readonly label?: (key: string, count: number) => string;
  /**
   * An optional third part of the default label ("STANDING · 52 · 5 LISTED"), in the same
   * mono capitals; null for a group with nothing to add.
   */
  readonly aside?: (key: string, count: number) => string | null;
  /**
   * What the group row's words say, when they name a severity or a state: the row is
   * printed in that meaning's colour (a "CRITICAL" group in crimson), so the colour never
   * contradicts the word. Without it the row keeps the label colour.
   */
  readonly tone?: (key: string) => DepotMeaning;
}

export interface RowGroup<T> {
  readonly key: string;
  readonly rows: readonly T[];
}

/**
 * Splits rows into groups in the order each group first appears, keeping the rows' own
 * order inside each group: a table sorted worst-first stays worst-first in every group,
 * and the group holding the worst row comes first. Returns new arrays; the input is
 * untouched.
 */
export function groupRows<T>(rows: readonly T[], keyOf: (row: T) => string): readonly RowGroup<T>[] {
  const order: string[] = [];
  const byKey = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(row);
    else {
      order.push(key);
      byKey.set(key, [row]);
    }
  }
  return order.map((key) => ({ key, rows: byKey.get(key) ?? [] }));
}

/** How many rows each group holds across the whole list, not only the rows shown. */
export function groupCounts<T>(rows: readonly T[], keyOf: (row: T) => string): ReadonlyMap<string, number> {
  return rows.reduce(
    (counts, row) => new Map(counts).set(keyOf(row), (counts.get(keyOf(row)) ?? 0) + 1),
    new Map<string, number>(),
  );
}

/**
 * "SMALL FLEETS · 35" once the group row's mono capitals set it; with a third part,
 * "STANDING · 52 · 5 LISTED". One separator, one face, for every group row.
 */
export function groupLabel(key: string, count: number, aside?: string | null): string {
  const base = `${key} · ${formatCount(count)}`;
  return aside ? `${base} · ${aside}` : base;
}
