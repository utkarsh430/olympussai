/*
 * The preventive table's columns per width and their widths, so no column is
 * cut at 1440, 1280 or 1024, and each narrower width shows a deliberate set; what a set
 * drops is in the row expander. Every group's table uses the same widths, so the groups
 * line up. Widths in px; the shared table's expander is its FIRST column, 24 px (the
 * shared `EXPANDER_WIDTH_PX`), and the row itself opens it.
 */

import { NEXT_SERVICE_HEADER, NEXT_SERVICE_PHONE_HEADER } from './text';

export type PreventiveColumnKey = 'registration' | 'next' | 'class' | 'odometer' | 'age';

export type PreventiveTier = 'wide' | 'medium' | 'phone';

export const PREVENTIVE_COLUMN_WIDTH_PX: Readonly<Record<PreventiveColumnKey, number>> = {
  registration: 140,
  next: 160,
  class: 160,
  odometer: 140,
  age: 120,
};

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

/**
 * The phone's two columns. A header never wraps, so a column is at least as wide as its
 * header: "To next service, km" needs 190 px, which with the registration and the expander
 * makes the table 350 px in the 326 px frame at 360, and the distance, right-aligned,
 * falls under the frame's right-edge fade. On a phone the distance's header is the shorter
 * `NEXT_SERVICE_PHONE_HEADER`, and the table (314 px) fits the frame whole.
 */
export const PREVENTIVE_PHONE_COLUMN_WIDTH_PX: Readonly<Partial<Record<PreventiveColumnKey, number>>> = {
  registration: 140,
  next: 150,
};

export function preventiveColumnWidth(key: PreventiveColumnKey, tier: PreventiveTier): number {
  const phone = tier === 'phone' ? PREVENTIVE_PHONE_COLUMN_WIDTH_PX[key] : undefined;
  return phone ?? PREVENTIVE_COLUMN_WIDTH_PX[key];
}

const HEADER: Readonly<Record<PreventiveColumnKey, string>> = {
  registration: 'Registration',
  next: NEXT_SERVICE_HEADER,
  class: 'Class',
  odometer: 'Odometer, km',
  age: 'Age, years',
};

export function preventiveHeader(key: PreventiveColumnKey, tier: PreventiveTier): string {
  return key === 'next' && tier === 'phone' ? NEXT_SERVICE_PHONE_HEADER : HEADER[key];
}

/** The columns a tier leaves to the row expander. */
export function preventiveExpanderKeys(tier: PreventiveTier): readonly PreventiveColumnKey[] {
  const shown = new Set(COLUMNS[tier]);
  return COLUMNS.wide.filter((key) => !shown.has(key));
}
