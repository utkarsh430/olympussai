import { formatCount } from '@/lib/depot/format';

/*
 * The transfer table's columns and widths. At `xl` the transfer plan is split 55% table
 * and 45% map, so at 1440 the table frame is about 624px wide: every column below must fit
 * in it, uncut (design critique round 4, fleet distribution Must 1). The giver's and the
 * receiver's spare before and after are not columns: they are said in the "Why?" row,
 * which already explains the transfer, and the decision controls live there too.
 */

export interface TransferColumn {
  readonly key: 'transfer' | 'buses' | 'roadKm' | 'busKm' | 'decision' | 'why';
  readonly label: string;
  readonly right: boolean;
  /** Fixed width; the transfer names truncate with their full text in `title`. */
  readonly widthPx: number;
}

export const TRANSFER_COLUMNS: readonly TransferColumn[] = [
  { key: 'transfer', label: 'Transfer', right: false, widthPx: 200 },
  { key: 'buses', label: 'Buses', right: true, widthPx: 72 },
  { key: 'roadKm', label: 'Road km', right: true, widthPx: 88 },
  { key: 'busKm', label: 'Bus-km', right: true, widthPx: 80 },
  { key: 'decision', label: 'Decision', right: false, widthPx: 112 },
  { key: 'why', label: 'Why?', right: false, widthPx: 64 },
];

/** The sum of the column widths: the table's minimum width; narrower frames scroll. */
export const TRANSFER_TABLE_PX = TRANSFER_COLUMNS.reduce((sum, c) => sum + c.widthPx, 0);

/** The geometry the widths are checked against: the shell at 1440 and the `xl` split. */
export const LAYOUT_AT_1440 = {
  viewportPx: 1440,
  railPx: 232,
  mainGuttersPx: 48,
  splitGapPx: 24,
  tableShare: 0.55,
  frameBordersPx: 2,
} as const;

/** The inside width of the transfer table's frame at 1440 (about 622px). */
export function transferFrameInnerPx(layout: typeof LAYOUT_AT_1440 = LAYOUT_AT_1440): number {
  const column = layout.viewportPx - layout.railPx - layout.mainGuttersPx - layout.splitGapPx;
  return Math.floor(column * layout.tableShare) - layout.frameBordersPx;
}

export interface SpareFigures {
  readonly giverSurplusBefore: number;
  readonly receiverDeficitBefore: number;
  readonly buses: number;
  readonly fromName: string;
  readonly toName: string;
}

/**
 * The giver's spare buses and the receiver's shortfall before and after this one transfer,
 * as one sentence for the "Why?" row. Never below zero after.
 */
export function spareBeforeAfter(row: SpareFigures): string {
  const giverAfter = Math.max(0, row.giverSurplusBefore - row.buses);
  const receiverAfter = Math.max(0, row.receiverDeficitBefore - row.buses);
  return (
    `${row.fromName} has ${formatCount(row.giverSurplusBefore)} spare before this transfer ` +
    `and ${formatCount(giverAfter)} after; ${row.toName} is ${formatCount(row.receiverDeficitBefore)} ` +
    `short before and ${formatCount(receiverAfter)} after.`
  );
}
