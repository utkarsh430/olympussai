import type { Provenance } from '../types';
import type { RouteListItem } from './api';
import type { RouteSortKey } from './routeQuery';
import { contentWidthAt } from '../shell/geometry';

/**
 * The route table's columns as data: short headers with the unit in the header, the one
 * tag a column carries when it differs from the page's MIXED default, and a width in
 * pixels (cell padding included) so the whole table fits the 1440 frame.
 */
export interface RouteColumnSpec {
  readonly key: RouteSortKey;
  readonly header: string;
  /** Faint after the header ("DELAY MIN"), so the cells carry bare numbers. */
  readonly unit?: string;
  readonly tag?: Provenance;
  readonly widthPx: number;
  readonly align: 'left' | 'right';
  /** Stays put while the figures scroll sideways, below 1440. */
  readonly frozen: boolean;
  /**
   * The narrowest width tier that draws the column: 'base' everywhere, 'lg' from 1024 px,
   * 'wide' from 1440 px. A column left out is said in the route's drawer.
   */
  readonly from: RouteWidthTier;
}

/** Width tiers: under 1024 px, 1024 to 1439 px (also 1280, where the rail returns), 1440 up. */
export type RouteWidthTier = 'base' | 'lg' | 'wide';

const TIER_ORDER: Readonly<Record<RouteWidthTier, number>> = { base: 0, lg: 1, wide: 2 };

/**
 * The table frame per tier, from the shell's geometry: the content column at 1440, at 1024
 * (1,000 at 1280 is wider, so the 1024 set fits there too) and at 800.
 */
export const ROUTE_TABLE_FRAME_PX: Readonly<Record<RouteWidthTier, number>> = {
  base: contentWidthAt(800),
  lg: contentWidthAt(1024),
  wide: contentWidthAt(1440),
};

/** The content column at 1440: the viewport less the rail and both gutters. */
export const ROUTE_TABLE_FRAME_1440_PX = ROUTE_TABLE_FRAME_PX.wide;

/** Tagged headers carry the pill inside the right-aligned cell, after the label. */
export const ROUTE_COLUMNS: readonly RouteColumnSpec[] = [
  { key: 'route', header: 'Route', widthPx: 152, align: 'left', frozen: true, from: 'base' },
  { key: 'depot', header: 'Depots', widthPx: 156, align: 'left', frozen: true, from: 'base' },
  { key: 'buses', header: 'Buses', widthPx: 76, align: 'right', frozen: false, from: 'base' },
  { key: 'class', header: 'Class', widthPx: 76, align: 'left', frozen: false, from: 'lg' },
  { key: 'trips', header: 'Trips/day', tag: 'modelled', widthPx: 184, align: 'right', frozen: false, from: 'base' },
  { key: 'deadKm', header: 'Dead km/trip', tag: 'derived', widthPx: 201, align: 'right', frozen: false, from: 'lg' },
  { key: 'median', header: 'Delay', unit: 'min', widthPx: 108, align: 'right', frozen: false, from: 'base' },
  { key: 'late', header: 'Late', unit: '%', widthPx: 84, align: 'right', frozen: false, from: 'lg' },
  { key: 'profile', header: 'Profile', widthPx: 96, align: 'left', frozen: false, from: 'lg' },
];

/**
 * The columns to draw for these rows. Dead km a trip only once a row on the page has a
 * figure, and PROFILE only while rows differ, since a column that reads the same on every
 * row says nothing (a dash, or "Not known" before any details are loaded). With dead km
 * drawn, CLASS and PROFILE step aside below 1440 so the 1024 set fits its frame.
 */
export function visibleRouteColumns(rows: readonly RouteListItem[]): readonly RouteColumnSpec[] {
  const anyDeadKm = rows.some((r) => r.deadKm !== null);
  const profileVaries = rows.some((r) => r.profiled) && rows.some((r) => !r.profiled);
  return ROUTE_COLUMNS.filter(
    (c) => (c.key !== 'deadKm' || anyDeadKm) && (c.key !== 'profile' || profileVaries),
  ).map((c) =>
    anyDeadKm && (c.key === 'class' || c.key === 'profile') ? { ...c, from: 'wide' as const } : c,
  );
}

/** The columns a width tier draws, from the visible set. */
export function columnsAtWidth(
  columns: readonly RouteColumnSpec[],
  tier: RouteWidthTier,
): readonly RouteColumnSpec[] {
  return columns.filter((c) => TIER_ORDER[c.from] <= TIER_ORDER[tier]);
}

/** The table's width in pixels, to set on the table and to check against the frame. */
export function routeTableWidth(columns: readonly RouteColumnSpec[]): number {
  return columns.reduce((sum, c) => sum + c.widthPx, 0);
}

/** A frozen column's left offset: the widths of the frozen columns before it. */
export function frozenLeft(columns: readonly RouteColumnSpec[], key: RouteSortKey): number {
  const at = columns.findIndex((c) => c.key === key);
  return columns.slice(0, Math.max(0, at)).reduce((sum, c) => sum + (c.frozen ? c.widthPx : 0), 0);
}
