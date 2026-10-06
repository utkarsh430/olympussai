/*
 * The preventive table's columns per width and their widths (round 3), so no column is
 * cut at 1440, 1280 or 1024, and each narrower width shows a deliberate set; what a set
 * drops is in the row expander. Every group's table uses the same widths, so the groups
 * line up. Widths in px; the shared table's expander is its FIRST column, 24 px (the
 * shell's `EXPANDER_WIDTH_PX`), and the row itself opens it.
 */

export type PreventiveColumnKey = 'registration' | 'next' | 'class' | 'odometer' | 'age';

export type PreventiveTier = 'wide' | 'medium' | 'phone';

export const PREVENTIVE_COLUMN_WIDTH_PX: Readonly<Record<PreventiveColumnKey, number>> = {
  registration: 140,
  next: 160,
  class: 160,
  odometer: 140,
  age: 120,
};

export const EXPANDER_WIDTH_PX = 24;

const COLUMNS: Readonly<Record<PreventiveTier, readonly PreventiveColumnKey[]>> = {
  wide: ['registration', 'next', 'class', 'odometer', 'age'],
  medium: ['registration', 'next', 'class', 'age'],
  phone: ['registration', 'next'],
};

export function preventiveTier(belowDesktop: boolean, phone: boolean): PreventiveTier {
  if (phone) return 'phone';
  return belowDesktop ? 'medium' : 'wide';
}

export function preventiveColumnKeys(tier: PreventiveTier): readonly PreventiveColumnKey[] {
  return COLUMNS[tier];
}

/** The columns a tier leaves to the row expander. */
export function preventiveExpanderKeys(tier: PreventiveTier): readonly PreventiveColumnKey[] {
  const shown = new Set(COLUMNS[tier]);
  return COLUMNS.wide.filter((key) => !shown.has(key));
}

/** The table's width at a tier: its columns, plus the expander column when it has one. */
export function preventiveTableWidth(tier: PreventiveTier): number {
  const columns = COLUMNS[tier].reduce((sum, key) => sum + PREVENTIVE_COLUMN_WIDTH_PX[key], 0);
  return preventiveExpanderKeys(tier).length > 0 ? columns + EXPANDER_WIDTH_PX : columns;
}
