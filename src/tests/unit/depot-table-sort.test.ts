import { describe, expect, it } from 'vitest';
import { sortRows } from '@/lib/depot/tableSort';

interface Row {
  readonly id: string;
  readonly value: number | string | null;
}

const byValue = (row: Row): number | string | null => row.value;
const ids = (rows: readonly Row[]): string[] => rows.map((row) => row.id);

describe('sortRows', () => {
  it('orders numbers ascending and descending', () => {
    const rows: Row[] = [
      { id: 'a', value: 10 },
      { id: 'b', value: 2 },
      { id: 'c', value: 33 },
    ];
    expect(ids(sortRows(rows, byValue, 'asc'))).toEqual(['b', 'a', 'c']);
    expect(ids(sortRows(rows, byValue, 'desc'))).toEqual(['c', 'a', 'b']);
  });

  it('orders strings case-insensitively and numerically aware', () => {
    const rows: Row[] = [
      { id: 'a', value: 'Pune 10' },
      { id: 'b', value: 'pune 9' },
      { id: 'c', value: 'Agra' },
    ];
    expect(ids(sortRows(rows, byValue, 'asc'))).toEqual(['c', 'b', 'a']);
  });

  it('puts nulls last in both directions', () => {
    const rows: Row[] = [
      { id: 'a', value: null },
      { id: 'b', value: 5 },
      { id: 'c', value: 1 },
    ];
    expect(ids(sortRows(rows, byValue, 'asc'))).toEqual(['c', 'b', 'a']);
    expect(ids(sortRows(rows, byValue, 'desc'))).toEqual(['b', 'c', 'a']);
  });

  it('is stable for equal keys in both directions', () => {
    const rows: Row[] = [
      { id: 'a', value: 1 },
      { id: 'b', value: 1 },
      { id: 'c', value: 0 },
      { id: 'd', value: 1 },
      { id: 'e', value: null },
      { id: 'f', value: null },
    ];
    expect(ids(sortRows(rows, byValue, 'asc'))).toEqual(['c', 'a', 'b', 'd', 'e', 'f']);
    expect(ids(sortRows(rows, byValue, 'desc'))).toEqual(['a', 'b', 'd', 'c', 'e', 'f']);
  });

  it('does not mutate its input', () => {
    const rows: readonly Row[] = Object.freeze([
      { id: 'a', value: 3 },
      { id: 'b', value: 1 },
    ]);
    const sorted = sortRows(rows, byValue, 'asc');
    expect(ids(rows)).toEqual(['a', 'b']);
    expect(sorted).not.toBe(rows);
  });

  it('keeps a consistent order with infinities and finite values', () => {
    const rows: Row[] = [
      { id: 'a', value: Infinity },
      { id: 'b', value: 5 },
      { id: 'c', value: Infinity },
      { id: 'd', value: -Infinity },
      { id: 'e', value: 0 },
      { id: 'f', value: -Infinity },
    ];
    expect(ids(sortRows(rows, byValue, 'asc'))).toEqual(['d', 'f', 'e', 'b', 'a', 'c']);
    expect(ids(sortRows(rows, byValue, 'desc'))).toEqual(['a', 'c', 'b', 'e', 'd', 'f']);
  });
});
