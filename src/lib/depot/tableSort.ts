export type SortDirection = 'asc' | 'desc';
export type SortValue = number | string | null;

function compareValues(a: number | string, b: number | string): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' });
}

/**
 * Returns a sorted copy of `rows`; the input is never touched.
 *
 * Nulls sort last in both directions (an unknown figure is never "the lowest").
 * Ties keep their original order in both directions, so flipping direction
 * never shuffles equal rows.
 */
export function sortRows<T>(
  rows: readonly T[],
  sortValue: (row: T) => SortValue,
  direction: SortDirection,
): T[] {
  const sign = direction === 'asc' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: sortValue(row) }))
    .sort((left, right) => {
      if (left.value === null && right.value === null) return left.index - right.index;
      if (left.value === null) return 1;
      if (right.value === null) return -1;
      const order = compareValues(left.value, right.value) * sign;
      return order !== 0 ? order : left.index - right.index;
    })
    .map((entry) => entry.row);
}
