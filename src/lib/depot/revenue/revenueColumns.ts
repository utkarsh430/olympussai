import { formatCount } from '../format';
import type { RevenueTableRow } from './revenueTablePageModel';
import type { TableTier } from '../shell/tableTier';

/*
 * The revenue page's BY ROUTE columns per width and the
 * plain-word length basis (no tag inside a cell). Widths in px; the
 * sums are pinned against each tier's frame.
 */

export type RevenueKey =
  'route' | 'class' | 'trips' | 'boardings' | 'load' | 'revenue' | 'earnings' | 'length' | 'basis';

export const REVENUE_WIDTHS: Readonly<Record<RevenueKey, number>> = {
  route: 160,
  class: 100,
  trips: 70,
  boardings: 100,
  load: 150,
  revenue: 110,
  earnings: 80,
  length: 120,
  basis: 80,
};

export interface RevenueTableShape {
  /** CLASS only when the routes differ in class. */
  readonly classVaries: boolean;
  /** BASIS only when some lengths come from real profiles and some are modelled. */
  readonly lengthsMixed: boolean;
}

export function revenueTableShape(rows: readonly RevenueTableRow[]): RevenueTableShape {
  const derived = rows.filter((r) => r.lengthDerived).length;
  return {
    classVaries: new Set(rows.map((r) => r.classLabel)).size > 1,
    lengthsMixed: derived > 0 && derived < rows.length,
  };
}

/** At 800: ROUTE · TRIPS · LOAD FACTOR · REVENUE ₹ · ₹/KM; the rest in the row expander. */
export function revenueColumnKeys(
  tier: TableTier,
  shape: RevenueTableShape,
): readonly RevenueKey[] {
  if (tier === 'narrow') return ['route', 'trips', 'load', 'revenue', 'earnings'];
  return [
    'route',
    ...(shape.classVaries ? (['class'] as const) : []),
    'trips',
    'boardings',
    'load',
    'revenue',
    'earnings',
    'length',
    ...(shape.lengthsMixed ? (['basis'] as const) : []),
  ];
}

/** The BASIS cell: plain muted words, never a tag. */
export function lengthBasisWord(row: RevenueTableRow): string {
  return row.lengthDerived ? 'Profile' : 'Model';
}

/** The section note when every length is of one kind (the BASIS column is then absent). */
export function lengthBasisNote(rows: readonly RevenueTableRow[]): string | undefined {
  if (rows.length === 0 || revenueTableShape(rows).lengthsMixed) return undefined;
  return rows[0]?.lengthDerived
    ? 'Every route length is from a real route profile'
    : 'Every route length is typical for its service class';
}

/** The row expander at 800: what the narrow set leaves out. */
export function revenueRowDetail(row: RevenueTableRow, shape: RevenueTableShape): string {
  const basis = row.lengthDerived ? 'from a real route profile' : 'typical for its service class';
  const parts = [
    ...(shape.classVaries ? [`Class ${row.classLabel}`] : []),
    `${formatCount(row.boardings)} boardings`,
    `route length ${formatCount(row.lengthRounded)} km, ${basis}`,
  ];
  return `${parts.join(' · ')}.`;
}
