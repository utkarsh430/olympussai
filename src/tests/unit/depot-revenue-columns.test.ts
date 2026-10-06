import { describe, expect, it } from 'vitest';
import {
  REVENUE_WIDTHS,
  lengthBasisNote,
  lengthBasisWord,
  revenueColumnKeys,
  revenueRowDetail,
  revenueTableShape,
} from '@/lib/depot/revenue/revenueColumns';
import type { RevenueTableRow } from '@/lib/depot/revenue/revenueTablePageModel';
import { TIER_FRAME_PX, type TableTier } from '@/lib/depot/shell/tableTier';
import { tableWidth } from '@/lib/depot/shell/tableWidth';

const row = (name: string, derived: boolean, classLabel = 'Ordinary') =>
  ({
    routeName: name,
    classLabel,
    boardings: 1234,
    lengthRounded: 42,
    lengthDerived: derived,
  }) as unknown as RevenueTableRow;

const MIXED = [row('R1', true, 'Ordinary'), row('R2', false, 'AC')];
const ALL_SHAPES = [
  { classVaries: true, lengthsMixed: true },
  { classVaries: false, lengthsMixed: false },
];

describe('revenue BY ROUTE column sets', () => {
  it.each<TableTier>(['wide', 'medium', 'narrow'])('fit the %s frame in every shape', (tier) => {
    for (const shape of ALL_SHAPES) {
      const expander = tier === 'narrow';
      expect(tableWidth(REVENUE_WIDTHS, revenueColumnKeys(tier, shape), { expander })).toBeLessThanOrEqual(
        TIER_FRAME_PX[tier],
      );
    }
  });

  it('drops a constant CLASS, and at 800 keeps ROUTE · TRIPS · LOAD FACTOR · REVENUE · ₹/KM', () => {
    expect(revenueColumnKeys('medium', { classVaries: false, lengthsMixed: false })).not.toContain(
      'class',
    );
    expect(revenueColumnKeys('narrow', ALL_SHAPES[0]!)).toEqual([
      'route',
      'trips',
      'load',
      'revenue',
      'earnings',
    ]);
  });
});

describe('the length basis in plain words', () => {
  it('shows a BASIS column only when lengths are mixed, with "Profile" or "Model"', () => {
    expect(revenueTableShape(MIXED).lengthsMixed).toBe(true);
    expect(revenueColumnKeys('wide', revenueTableShape(MIXED))).toContain('basis');
    expect(MIXED.map(lengthBasisWord)).toEqual(['Profile', 'Model']);
    expect(lengthBasisNote(MIXED)).toBeUndefined();
  });

  it('says which kind in the section note when every length is of one kind', () => {
    const allProfile = [row('R1', true), row('R2', true)];
    expect(revenueColumnKeys('wide', revenueTableShape(allProfile))).not.toContain('basis');
    expect(lengthBasisNote(allProfile)).toBe('Every route length is from a real route profile');
    expect(lengthBasisNote([row('R1', false)])).toBe(
      'Every route length is typical for its service class',
    );
  });

  it('puts boardings and the route length in the row expander at 800', () => {
    expect(revenueRowDetail(MIXED[0]!, revenueTableShape(MIXED))).toBe(
      'Class Ordinary · 1,234 boardings · route length 42 km, from a real route profile.',
    );
  });
});
