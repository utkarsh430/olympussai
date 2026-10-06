import { formatCount } from '@/lib/depot/format';
import {
  TABLE_FRAME_BORDER_PX,
  WIDE_VIEWPORT_PX,
  contentWidthAt,
} from '../shell/geometry';

/*
 * The transfer table's columns and widths. At `xl` the transfer plan is split 55% table
 * and 45% map, so at 1440 the table frame is about 624px wide: every column below must fit
 * in it, uncut. There is no "Why?"
 * column: the row opens its expanded row, which holds the rationale, the giver's surplus and
 * the receiver's shortfall before and after, and the decision controls.
 */

export interface TransferColumn {
  readonly key: 'transfer' | 'buses' | 'roadKm' | 'busKm' | 'decision' | 'open';
  readonly label: string;
  readonly right: boolean;
  /** Fixed width; a long transfer name wraps to a second line, never cut mid-word. */
  readonly widthPx: number;
}

export const TRANSFER_COLUMNS: readonly TransferColumn[] = [
  { key: 'transfer', label: 'Transfer', right: false, widthPx: 224 },
  { key: 'buses', label: 'Buses', right: true, widthPx: 64 },
  { key: 'roadKm', label: 'Road km', right: true, widthPx: 88 },
  { key: 'busKm', label: 'Bus-km', right: true, widthPx: 80 },
  { key: 'decision', label: 'Decision', right: false, widthPx: 136 },
  /** The row is the control: the muted chevron on hover and focus, no header text. */
  { key: 'open', label: '', right: false, widthPx: 24 },
];

/** The sum of the column widths: the table's minimum width; narrower frames scroll. */
export const TRANSFER_TABLE_PX = TRANSFER_COLUMNS.reduce((sum, c) => sum + c.widthPx, 0);

/**
 * The viewport from which the transfers table sits beside the map. Below it the table sits
 * above the map at the content column's full width: at 1280 the split would leave the
 * table about 534 px, short of its 616.
 */
export const TRANSFER_SPLIT_FROM_PX = WIDE_VIEWPORT_PX;

/** The side-by-side split: the gap between map and table, and the table's share of the rest. */
export const TRANSFER_SPLIT = { gapPx: 24, tableShare: 0.55 } as const;

/** The inside width of the transfer table's frame at a viewport (about 622px at 1440). */
export function transferFrameInnerPx(viewportPx: number): number {
  const content = contentWidthAt(viewportPx);
  if (viewportPx < TRANSFER_SPLIT_FROM_PX) return content - TABLE_FRAME_BORDER_PX;
  const shared = content - TRANSFER_SPLIT.gapPx;
  return Math.floor(shared * TRANSFER_SPLIT.tableShare) - TABLE_FRAME_BORDER_PX;
}

export interface SpareFigures {
  readonly giverSurplusBefore: number;
  readonly receiverDeficitBefore: number;
  readonly buses: number;
  readonly fromName: string;
  readonly toName: string;
}

/**
 * The giver's surplus and the receiver's shortfall immediately before and after this one
 * transfer (`transferRows` carries the running balances), as one sentence for the expanded
 * row. "Surplus", not "spare": the spare target is a different count.
 * Never below zero after.
 */
export function spareBeforeAfter(row: SpareFigures): string {
  const giverAfter = Math.max(0, row.giverSurplusBefore - row.buses);
  const receiverAfter = Math.max(0, row.receiverDeficitBefore - row.buses);
  return (
    `${row.fromName} has ${formatCount(row.giverSurplusBefore)} surplus buses before this ` +
    `transfer and ${formatCount(giverAfter)} after; ${row.toName} is ` +
    `${formatCount(row.receiverDeficitBefore)} buses short before and ${formatCount(receiverAfter)} after.`
  );
}
