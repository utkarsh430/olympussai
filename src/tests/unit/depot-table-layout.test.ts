import { describe, expect, it } from 'vitest';
import {
  EXPANDER_WIDTH_PX,
  frozenColumnCount,
  frozenLefts,
  frozenOffsets,
  rowActionName,
  rowNameText,
} from '@/components/depot/shell/tableLayout';
import { groupLabel } from '@/components/depot/shell/tableGroups';

describe('frozen column offsets', () => {
  it('sticks each frozen column where the ones before it end', () => {
    expect(frozenOffsets([])).toEqual([]);
    expect(frozenOffsets([120])).toEqual([0]);
    expect(frozenOffsets([24, 160, 80])).toEqual([0, 24, 184]);
  });

  it('freezes the 24px chevron column and the first data column together', () => {
    expect(EXPANDER_WIDTH_PX).toBe(24);
    expect(frozenColumnCount(true)).toBe(2);
    expect(frozenLefts(true)).toEqual([0, 24]);
    expect(frozenColumnCount(false)).toBe(1);
    expect(frozenLefts(false)).toEqual([0]);
  });
});

describe('a row that is its own control', () => {
  it('is named by what it is, then by what Enter does', () => {
    expect(rowActionName('UP13CT7020', { kind: 'open' })).toBe('UP13CT7020, open');
    expect(rowActionName('Duty 4', { kind: 'expand', open: false })).toBe('Duty 4, show details');
    expect(rowActionName('Duty 4', { kind: 'expand', open: true })).toBe('Duty 4, hide details');
    expect(rowActionName('  ', { kind: 'open' })).toBe('Row, open');
  });

  it('takes its name from the first column, its title, or its key', () => {
    expect(rowNameText('KAUSHAMBI', undefined, '49')).toBe('KAUSHAMBI');
    expect(rowNameText(12, undefined, 'k')).toBe('12');
    expect(rowNameText(null, 'Full name', 'k')).toBe('Full name');
    expect(rowNameText({}, undefined, 'k')).toBe('k');
  });
});

describe('the group row', () => {
  it('reads "<group> · <count>", with an optional third part', () => {
    expect(groupLabel('Small fleets', 35)).toBe('Small fleets · 35');
    expect(groupLabel('Standing', 52, '5 listed')).toBe('Standing · 52 · 5 listed');
    expect(groupLabel('Standing', 1200, null)).toBe('Standing · 1,200');
  });
});
