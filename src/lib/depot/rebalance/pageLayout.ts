import { formatCount } from '@/lib/depot/format';
import { busesWord, type BalanceRow, type PlanSummary } from './rebalanceModel';

/**
 * The transfers block's classes: the map and the table side by side from 1440 (table 55%,
 * on the right), the table first and full width below it. The breakpoint is written out
 * because Tailwind reads class names literally; a test ties it to `TRANSFER_SPLIT_FROM_PX`.
 */
export const TRANSFER_SPLIT_CLASSES = {
  grid:
    'flex min-w-0 flex-col gap-6 min-[1440px]:grid ' +
    'min-[1440px]:grid-cols-[minmax(0,45fr)_minmax(0,55fr)] min-[1440px]:items-start',
  table: 'order-1 min-w-0 min-[1440px]:order-2',
  map: 'order-2 min-w-0 min-[1440px]:order-1',
} as const;

/** Transfers shown before "Show all N"; the plan is the hero, not a wall of rows. */
export const TRANSFER_PREVIEW = 10;
/** Depots shown in the every-depot table before "Show all N": the deepest shortfalls. */
export const SHORTFALL_PREVIEW = 15;
/**
 * Two depots whose inferred positions are closer than this are, for the reader, at one
 * place: a transfer between them reads as "10 buses over 0.2 km", which looks wrong.
 */
export const SAME_PLACE_KM = 1;

export interface PlanFigure {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly caption: string;
}

/**
 * The before and after figures of the plan, as the five figures of one band: both sides
 * of the plan (short depots, surplus buses in the network), what it moves, what the moves
 * cost in empty running, and how much of the shortfall it covers.
 */
export function planFigures(s: PlanSummary): readonly PlanFigure[] {
  const shortBefore = s.coveredDeficit + s.uncoveredDeficit;
  return [
    {
      key: 'short',
      label: 'Short depots',
      value: `${formatCount(s.before.depotsInDeficit)} → ${formatCount(s.after.depotsInDeficit)}`,
      caption: 'before → after the plan',
    },
    {
      key: 'spare',
      label: 'Surplus buses',
      value: `${formatCount(s.before.totalSurplus)} → ${formatCount(s.after.totalSurplus)}`,
      caption: 'network, before → after',
    },
    {
      key: 'moved',
      label: 'Buses moved',
      value: formatCount(s.busesMoved),
      caption: `in ${formatCount(s.transfers)} transfers`,
    },
    {
      key: 'empty',
      label: 'Empty running',
      value: s.busKm.toFixed(1),
      caption: 'bus-km, road estimate',
    },
    {
      key: 'covered',
      label: 'Deficit met',
      value: `${formatCount(s.coveredDeficit)} of ${formatCount(shortBefore)}`,
      caption:
        s.uncoveredDeficit > 0
          ? `${busesWord(s.uncoveredDeficit)} left uncovered`
          : 'every short bus covered',
    },
  ];
}

export interface Preview<T> {
  readonly rows: readonly T[];
  readonly hidden: number;
}

/**
 * The first ten transfers, plus a selected one further down (a map click can select any
 * transfer, and the selected row must stay visible). Every row when `showAll`.
 */
export function transferPreview<T extends { readonly id: string }>(
  rows: readonly T[],
  showAll: boolean,
  selectedId: string | null,
): Preview<T> {
  if (showAll || rows.length <= TRANSFER_PREVIEW) return { rows, hidden: 0 };
  const head = rows.slice(0, TRANSFER_PREVIEW);
  const selected = rows.slice(TRANSFER_PREVIEW).find((r) => r.id === selectedId);
  const shown = selected ? [...head, selected] : head;
  return { rows: shown, hidden: rows.length - shown.length };
}

/** The sentence for a transfer between two depots drawn at nearly one position, else null. */
export function samePlaceNote(row: {
  readonly fromName: string;
  readonly toName: string;
  readonly distanceKm: number;
}): string | null {
  const km = row.distanceKm;
  // A missing or broken distance is not "the same place": say nothing rather than "NaN km".
  if (!Number.isFinite(km) || km < 0 || km >= SAME_PLACE_KM) return null;
  return `${row.fromName} and ${row.toName} stand at the same place by their inferred positions (${row.distanceKm.toFixed(1)} km apart).`;
}

/** The deepest shortfalls (rows arrive deepest first), or every row when `showAll`. */
export function balancePreview(rows: readonly BalanceRow[], showAll: boolean): readonly BalanceRow[] {
  return showAll ? rows : rows.slice(0, SHORTFALL_PREVIEW);
}

/** A constant column is dropped: "Part of plan" stays only when some unit takes no part. */
export function partOfPlanVaries(rows: readonly BalanceRow[]): boolean {
  return rows.some((r) => !r.takesPart) && rows.some((r) => r.takesPart);
}
