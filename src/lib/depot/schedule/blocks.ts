import { classFromRoute } from '../sim/fleetMaster';
import { compareText } from '../stats/order';
import { CREW_RELEASE_GAP_MIN } from './config';
import type { PieceOfWork, VehicleBlock } from './types';

/*
 * Stage B2: the fewest vehicle blocks. Pieces padded by the turnaround are
 * intervals; covering them greedily by start, each joining the open block
 * that ended latest (least idle), uses exactly as many blocks as the most
 * padded pieces alive at one instant, which is a lower bound; the block
 * cap can push the count above it, and the gap is reported.
 */

export const byPieceOrder = (a: PieceOfWork, b: PieceOfWork): number =>
  a.startMin - b.startMin || compareText(a.routeName, b.routeName) || a.level - b.level || compareText(a.id, b.id);

/** The most padded pieces alive at once: no cover can use fewer blocks. */
export function blockLowerBound(pieces: readonly PieceOfWork[], turnaround: number): number {
  const events = pieces.flatMap((p) => [
    { at: p.startMin, delta: 1 },
    { at: p.endMin + turnaround, delta: -1 },
  ]);
  events.sort((a, b) => a.at - b.at || a.delta - b.delta);
  let alive = 0;
  let most = 0;
  for (const event of events) {
    alive += event.delta;
    most = Math.max(most, alive);
  }
  return most;
}

/** Chains of piece indices (into the sorted pieces), each one block's work. */
export function coverByIntervals(
  pieces: readonly PieceOfWork[],
  turnaround: number,
  cap: number,
): { readonly sorted: readonly PieceOfWork[]; readonly chains: readonly (readonly number[])[]; readonly lowerBound: number } {
  const sorted = [...pieces].sort(byPieceOrder);
  const open: { start: number; end: number; members: number[] }[] = [];
  sorted.forEach((piece, index) => {
    let best = -1;
    open.forEach((block, b) => {
      const fits = block.end + turnaround <= piece.startMin && piece.endMin - block.start <= cap;
      if (fits && (best === -1 || block.end > (open[best] as { end: number }).end)) best = b;
    });
    if (best === -1) open.push({ start: piece.startMin, end: piece.endMin, members: [index] });
    else {
      const block = open[best] as { start: number; end: number; members: number[] };
      block.end = piece.endMin;
      block.members.push(index);
    }
  });
  return { sorted, chains: open.map((b) => b.members), lowerBound: blockLowerBound(sorted, turnaround) };
}

function blockOf(depotId: string, operatingDate: string, index: number, pieces: readonly PieceOfWork[]): VehicleBlock {
  const minutesByRoute = new Map<string, number>();
  let paidIdle = 0;
  let changes = 0;
  pieces.forEach((piece, i) => {
    minutesByRoute.set(piece.routeName, (minutesByRoute.get(piece.routeName) ?? 0) + piece.endMin - piece.startMin);
    const previous = pieces[i - 1];
    if (previous === undefined) return;
    const gap = piece.startMin - previous.endMin;
    if (gap < CREW_RELEASE_GAP_MIN) paidIdle += gap;
    if (previous.routeName !== piece.routeName) changes += 1;
  });
  const mainRouteName = [...minutesByRoute].sort((a, b) => b[1] - a[1] || compareText(a[0], b[0]))[0]?.[0] ?? '';
  const first = pieces[0] as PieceOfWork;
  const last = pieces[pieces.length - 1] as PieceOfWork;
  return {
    id: `${depotId}-${operatingDate}-B${String(index).padStart(3, '0')}`,
    depotId,
    pieces,
    startMin: first.startMin,
    endMin: last.endMin,
    routeNames: [...minutesByRoute.keys()].sort(compareText),
    mainRouteName,
    serviceClass: classFromRoute(mainRouteName) ?? 'ordinary',
    workMinutes: pieces.reduce((sum, p) => sum + p.endMin - p.startMin, 0),
    paidIdleMinutes: paidIdle,
    routeChanges: changes,
    needMinutes: pieces.reduce((sum, p) => sum + p.needMinutes, 0),
  };
}

/** The blocks, ordered by start then id, from the cover's chains. */
export function blocksOf(
  depotId: string,
  operatingDate: string,
  sorted: readonly PieceOfWork[],
  chains: readonly (readonly number[])[],
): VehicleBlock[] {
  const built = chains.map((chain) => chain.map((i) => sorted[i] as PieceOfWork));
  built.sort((a, b) => (a[0] as PieceOfWork).startMin - (b[0] as PieceOfWork).startMin || compareText((a[0] as PieceOfWork).id, (b[0] as PieceOfWork).id));
  return built.map((pieces, index) => blockOf(depotId, operatingDate, index, pieces));
}
