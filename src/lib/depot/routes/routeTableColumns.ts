import type { Provenance } from '../types';
import type { RouteListItem } from './api';
import type { RouteSortKey } from './routeQuery';

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
}

/**
 * The content column at 1440: the 232 px rail and its hairline, then 24 px gutters
 * (1440 − 233 − 48). A classic vertical scrollbar would take about 15 px more.
 */
export const ROUTE_TABLE_FRAME_1440_PX = 1159;

export const ROUTE_COLUMNS: readonly RouteColumnSpec[] = [
  { key: 'route', header: 'Route', widthPx: 152, align: 'left', frozen: true },
  { key: 'depot', header: 'Depots', widthPx: 156, align: 'left', frozen: true },
  { key: 'buses', header: 'Buses', widthPx: 76, align: 'right', frozen: false },
  { key: 'class', header: 'Class', widthPx: 76, align: 'left', frozen: false },
  { key: 'trips', header: 'Trips/day', tag: 'modelled', widthPx: 196, align: 'right', frozen: false },
  { key: 'deadKm', header: 'Dead km/trip', tag: 'derived', widthPx: 212, align: 'right', frozen: false },
  { key: 'median', header: 'Delay', unit: 'min', widthPx: 108, align: 'right', frozen: false },
  { key: 'late', header: 'Late', unit: '%', widthPx: 84, align: 'right', frozen: false },
  { key: 'profile', header: 'Profile', widthPx: 96, align: 'left', frozen: false },
];

/**
 * The columns to draw for these rows: dead km a trip only once a row on the page has a
 * figure, since until route details are loaded it is a dash on every row (a constant
 * column).
 */
export function visibleRouteColumns(rows: readonly RouteListItem[]): readonly RouteColumnSpec[] {
  const anyDeadKm = rows.some((r) => r.deadKm !== null);
  return anyDeadKm ? ROUTE_COLUMNS : ROUTE_COLUMNS.filter((c) => c.key !== 'deadKm');
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
