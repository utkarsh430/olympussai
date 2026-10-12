import { MINUTES_PER_HOUR } from '../units';
import { DAY_END_MIN, PIECE_GRID_MIN } from './config';
import type { DepotRouteNeed, PieceOfWork, UncoveredNeed } from './types';

/*
 * Stage B1: pieces of work. For level k = 1..max need, every maximal run of
 * hours with need >= k is one piece: the fewest pieces that cover each hour
 * with exactly its need (every rise of the step function forces a start).
 */

const upToGrid = (minutes: number): number => Math.ceil(minutes / PIECE_GRID_MIN) * PIECE_GRID_MIN;

/** The fewest pieces a 24-hour need vector can take: the sum of its rises. */
export function minimalPieceCount(needed: readonly number[]): number {
  return needed.reduce((sum, n, h) => sum + Math.max(0, n - (h === 0 ? 0 : (needed[h - 1] ?? 0))), 0);
}

interface Run {
  readonly level: number;
  readonly fromHour: number;
  readonly toHour: number; // inclusive
}

function runsOf(needed: readonly number[]): Run[] {
  const max = Math.max(0, ...needed);
  const runs: Run[] = [];
  for (let level = 1; level <= max; level += 1) {
    let from: number | null = null;
    for (let hour = 0; hour <= needed.length; hour += 1) {
      const on = hour < needed.length && (needed[hour] ?? 0) >= level;
      if (on && from === null) from = hour;
      if (!on && from !== null) {
        runs.push({ level, fromHour: from, toHour: hour - 1 });
        from = null;
      }
    }
  }
  return runs;
}

/**
 * The route's pieces: each run extended to at least one cycle, on the grid,
 * clipped at midnight (the minutes lost are uncovered `past_day_end`), and a
 * piece longer than the block cap cut into equal consecutive parts.
 */
export function piecesOf(
  route: DepotRouteNeed,
  maxBlockMin: number,
): { readonly pieces: readonly PieceOfWork[]; readonly pastDayEnd: readonly UncoveredNeed[] } {
  const needed = route.hours.map((h) => h.needed);
  const pieces: PieceOfWork[] = [];
  const pastDayEnd: UncoveredNeed[] = [];
  const cycle = upToGrid(Math.max(PIECE_GRID_MIN, route.cycleMinutes));
  let index = 0;
  for (const run of runsOf(needed)) {
    const startMin = run.fromHour * MINUTES_PER_HOUR;
    const naturalEnd = (run.toHour + 1) * MINUTES_PER_HOUR;
    const endMin = Math.max(naturalEnd, startMin + cycle);
    const clippedEnd = Math.min(endMin, DAY_END_MIN);
    if (clippedEnd <= startMin) {
      for (let hour = run.fromHour; hour <= run.toHour; hour += 1) pastDayEnd.push({ routeName: route.routeName, hour, buses: 1, reason: 'past_day_end' });
      continue;
    }
    const parts = Math.max(1, Math.ceil((clippedEnd - startMin) / maxBlockMin));
    const each = upToGrid((clippedEnd - startMin) / parts);
    for (let part = 0; part < parts; part += 1) {
      const partStart = startMin + part * each;
      const partEnd = part === parts - 1 ? clippedEnd : Math.min(clippedEnd, partStart + each);
      if (partEnd <= partStart) break;
      const needFrom = Math.max(partStart, startMin);
      const needTo = Math.min(partEnd, naturalEnd);
      pieces.push({
        id: `${route.routeName}#${run.level}#${index}`,
        routeName: route.routeName,
        level: run.level,
        startMin: partStart,
        endMin: partEnd,
        needMinutes: Math.max(0, needTo - needFrom),
      });
      index += 1;
    }
  }
  return { pieces, pastDayEnd };
}
