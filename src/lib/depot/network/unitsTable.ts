import { DARK_AFTER_MIN } from '@/lib/depot/infer/thresholds';
import type { DepotSummary } from '@/lib/depot/types';

/**
 * The overview's units table: which columns, in what words, at what widths. The four
 * state counts are the module's classified states (`depot.states`, from
 * `classifyBusState`), the same vocabulary the cockpit and the roster show, never the
 * feed's own `vehicle_status` field. "On road" counts in-service buses too, as the
 * cockpit's on-road share does.
 */

export type KindFilter = 'all' | 'depot' | 'other';

export type TableColumnKey =
  | 'name'
  | 'kind'
  | 'fleet'
  | 'reporting'
  | 'assigned'
  | 'onRoad'
  | 'standing'
  | 'dark'
  | 'offRoad'
  | 'mix'
  | 'index'
  | 'peerGroup';

export interface ColumnSpec {
  readonly header: string;
  /** Shown after the header, so cells carry bare numbers. */
  readonly unit?: string;
  /** Pixels: the longest header (mono 11px, 0.12em tracking) or cell, plus 24px padding. */
  readonly width: number;
}

const MINUTES_PER_HOUR = 60;

/** Said once, in the Dark header's `title`, as the cockpit words it. */
export const DARK_HEADER_TITLE = `Dark: no signal for ${DARK_AFTER_MIN / MINUTES_PER_HOUR} h or more`;

/** The status-mix bar is 72px; its column adds the cell's 24px padding. */
export const MIX_BAR_PX = 72;

export const TABLE_COLUMN_SPEC: Readonly<Record<TableColumnKey, ColumnSpec>> = {
  name: { header: 'Unit', width: 160 },
  kind: { header: 'Kind', width: 104 },
  fleet: { header: 'Fleet', width: 72 },
  reporting: { header: 'Report', unit: '%', width: 92 },
  assigned: { header: 'Assign', unit: '%', width: 92 },
  onRoad: { header: 'On road', width: 84 },
  standing: { header: 'Standing', width: 92 },
  dark: { header: 'Dark', width: 64 },
  offRoad: { header: 'Off road', width: 92 },
  mix: { header: 'Mix', width: MIX_BAR_PX + 24 },
  index: { header: 'Index', width: 72 },
  peerGroup: { header: 'Peer group', width: 128 },
};

/** The content column at 1440 (rail and gutters taken off): five 232px figures fill it. */
export const TABLE_FRAME_PX_1440 = 1160;
/** The content column at 800, where the rail has collapsed into the strip. */
export const TABLE_FRAME_PX_800 = 752;

const WIDE: readonly TableColumnKey[] = [
  'name',
  'kind',
  'fleet',
  'reporting',
  'assigned',
  'onRoad',
  'standing',
  'dark',
  'offRoad',
  'mix',
  'index',
  'peerGroup',
];

/**
 * Below 900px: the unit, its size, where its buses are and its index. Kind, reporting,
 * assignment, off road, the mix and the peer group are in the selected-unit panel.
 */
const NARROW: ReadonlySet<TableColumnKey> = new Set([
  'name',
  'fleet',
  'onRoad',
  'standing',
  'dark',
  'index',
]);

/** Kind is dropped when the filter already says every row is an operating depot. */
export function tableColumnKeys(filter: KindFilter, narrow: boolean): TableColumnKey[] {
  return WIDE.filter((key) => {
    if (narrow && !NARROW.has(key)) return false;
    return !(key === 'kind' && filter === 'depot');
  });
}

/** The table's width in pixels for a column set, to hold against the frame. */
export function tableWidthPx(keys: readonly TableColumnKey[]): number {
  return keys.reduce((sum, key) => sum + TABLE_COLUMN_SPEC[key].width, 0);
}

export interface UnitStateCounts {
  readonly onRoad: number;
  readonly standing: number;
  readonly dark: number;
  readonly offRoad: number;
}

/** A row's four counts; with in-service folded into on road they sum to the fleet. */
export function unitStateCounts(depot: Pick<DepotSummary, 'states'>): UnitStateCounts {
  const { inService, onRoad, standing, dark, offRoad } = depot.states;
  return { onRoad: inService + onRoad, standing, dark, offRoad };
}

/** Under the table at 800: where the columns that are not shown can be found. */
export const NARROW_TABLE_NOTE =
  'Kind, reporting, assignment, off road, the mix and the peer group are in the selected-unit panel.';

/** The table label's right-hand note. */
export const TABLE_SELECT_NOTE = 'Select a row to see the unit on the map and in the panel.';
