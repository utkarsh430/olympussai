import type { Provenance } from '../types';
import { ROUTE_TABLE_FRAME_1440_PX } from './routeTableColumns';

/**
 * The recommended-moves table's columns (critique round 5, routes Must 1): short headers,
 * one MODELLED tag on the section label instead of a pill per header, and a DERIVED tag
 * only on the two dead-km columns, which differ from it. Widths include the cell padding
 * and sum within the 1440 frame, so SAVING KM/DAY is named in full and never cut.
 */
export interface MovesColumn {
  readonly key: 'route' | 'from' | 'to' | 'trips' | 'now' | 'after' | 'saving' | 'note';
  readonly label: string;
  readonly tag?: Provenance;
  readonly right: boolean;
  readonly widthPx: number;
}

export const MOVES_COLUMNS: readonly MovesColumn[] = [
  { key: 'route', label: 'Route', right: false, widthPx: 176 },
  { key: 'from', label: 'From', right: false, widthPx: 144 },
  { key: 'to', label: 'To', right: false, widthPx: 144 },
  { key: 'trips', label: 'Trips/day', right: true, widthPx: 104 },
  { key: 'now', label: 'Dead km now', tag: 'derived', right: true, widthPx: 184 },
  { key: 'after', label: 'After', tag: 'derived', right: true, widthPx: 136 },
  { key: 'saving', label: 'Saving km/day', right: true, widthPx: 136 },
  { key: 'note', label: 'Note', right: false, widthPx: 128 },
];

/** The table's minimum width: narrower frames scroll inside themselves. */
export const MOVES_TABLE_PX = MOVES_COLUMNS.reduce((sum, c) => sum + c.widthPx, 0);

/** The frame the widths are checked against at 1440. */
export const MOVES_FRAME_1440_PX = ROUTE_TABLE_FRAME_1440_PX;
