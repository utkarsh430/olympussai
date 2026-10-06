import type { DepotBusRow } from '@/models/depotLive';
import {
  fromMetres,
  hasUsablePosition,
  median,
  toMetres,
  type PointM,
  type PositionedRow,
} from './geo';
import type { Yard } from './types';
import { MOVING_SPEED_KMPH } from './thresholds';

/*
 * A yard is learned, not surveyed: it is the largest connected group of grid
 * cells that parked buses occupy. Cells are YARD_CELL_M wide and two occupied
 * cells are connected when they touch, diagonals included, so a yard of any
 * contiguous shape up to YARD_MAX_SPAN_CELLS long is measured whole and no bus
 * standing in it is reported as away. Two stands in touching cells are one
 * place. A stand separated from the yard by at least one empty cell is a
 * different place: its buses are not in the yard, and it counts as the rival.
 * No yard is claimed unless the group is big enough, holds at least half the
 * depot's parked buses, and is YARD_DOMINANCE_RATIO times the second-largest
 * group, because guessing between comparable stands would put the yard, and
 * every departure judged against it, in the wrong place.
 */

/** Grid cell for counting parked buses; about a bus-park's width. */
export const YARD_CELL_M = 150;
/** Fewer parked buses than this is a coincidence of stops, not a yard. */
export const YARD_MIN_CLUSTER = 6;
/** The yard must hold at least this share of the depot's parked buses. */
export const YARD_MIN_SHARE = 0.5;
/** A yard is never claimed smaller than a few bays. */
export const YARD_MIN_RADIUS_M = 120;
/** Margin beyond the 90th-percentile bus so edge bays still count as inside. */
export const YARD_RADIUS_PAD_M = 40;
/**
 * The yard must beat the second-largest group by this factor: one bus moving
 * must not relocate the yard by tens of kilometres.
 */
export const YARD_DOMINANCE_RATIO = 1.5;
/**
 * A group longer than this many cells (1.5 km) on either axis is a road lined
 * with parked buses, not a yard, so no yard is claimed. Because the group is
 * at most this long, the radius is bounded by the diagonal of a
 * YARD_MAX_SPAN_CELLS square plus the padding.
 */
export const YARD_MAX_SPAN_CELLS = 10;
/**
 * Grid origin is the median position snapped to this many degrees (about 1 km),
 * so cell boundaries do not shift when a single bus moves the median.
 */
const ORIGIN_SNAP_DEG = 0.01;
const RADIUS_PERCENTILE = 0.9;

interface Candidate {
  readonly registrationNumber: string;
  readonly point: PointM;
}

interface CellKey {
  readonly cx: number;
  readonly cy: number;
}

interface Component {
  readonly cells: readonly CellKey[];
  readonly members: readonly Candidate[];
  /** Lowest cell of the component by (cx, cy): the deterministic tie-break. */
  readonly lowest: CellKey;
}

function isParkedWithFix(row: DepotBusRow): row is PositionedRow {
  if (!hasUsablePosition(row) || row.speedKmph === null) return false;
  return row.speedKmph <= MOVING_SPEED_KMPH;
}

function byPointThenId(a: Candidate, b: Candidate): number {
  return (
    a.point.x - b.point.x ||
    a.point.y - b.point.y ||
    (a.registrationNumber < b.registrationNumber ? -1 : a.registrationNumber > b.registrationNumber ? 1 : 0)
  );
}

function snap(degrees: number): number {
  return Math.round(degrees / ORIGIN_SNAP_DEG) * ORIGIN_SNAP_DEG;
}

function cellOf(point: PointM): CellKey {
  return { cx: Math.floor(point.x / YARD_CELL_M), cy: Math.floor(point.y / YARD_CELL_M) };
}

const keyOf = ({ cx, cy }: CellKey): string => `${cx}:${cy}`;
const compareCells = (a: CellKey, b: CellKey): number => a.cx - b.cx || a.cy - b.cy;

/** Connected groups of occupied cells (8-neighbourhood), largest first. */
function connectedGroups(candidates: readonly Candidate[]): readonly Component[] {
  const occupied = new Map<string, CellKey>();
  for (const candidate of candidates) {
    const cell = cellOf(candidate.point);
    occupied.set(keyOf(cell), cell);
  }

  const groupOf = new Map<string, number>();
  const groups: CellKey[][] = [];
  for (const start of [...occupied.values()].sort(compareCells)) {
    if (groupOf.has(keyOf(start))) continue;
    const id = groups.length;
    const cells: CellKey[] = [];
    const stack: CellKey[] = [start];
    groupOf.set(keyOf(start), id);
    while (stack.length > 0) {
      const cell = stack.pop() as CellKey;
      cells.push(cell);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          const next = occupied.get(keyOf({ cx: cell.cx + dx, cy: cell.cy + dy }));
          if (next === undefined || groupOf.has(keyOf(next))) continue;
          groupOf.set(keyOf(next), id);
          stack.push(next);
        }
      }
    }
    groups.push(cells.sort(compareCells));
  }

  return groups
    .map((cells, id) => ({
      cells,
      members: candidates.filter((c) => groupOf.get(keyOf(cellOf(c.point))) === id),
      lowest: cells[0] as CellKey,
    }))
    .sort((a, b) => b.members.length - a.members.length || compareCells(a.lowest, b.lowest));
}

function spanCells(cells: readonly CellKey[], axis: 'cx' | 'cy'): number {
  const values = cells.map((cell) => cell[axis]);
  return Math.max(...values) - Math.min(...values) + 1;
}

/**
 * Infer one depot's yard from where its buses are parked; null unless the
 * evidence is strong (see the rule above) rather than a guess or a midpoint.
 */
export function inferYard(rows: readonly DepotBusRow[]): Yard | null {
  const parked = rows.filter(isParkedWithFix);
  if (parked.length < YARD_MIN_CLUSTER) return null;

  const originLat = snap(median(parked.map((row) => row.latitude)));
  const originLng = snap(median(parked.map((row) => row.longitude)));
  const candidates = parked
    .map((row) => ({
      registrationNumber: row.registrationNumber,
      point: toMetres(row.latitude, row.longitude, originLat, originLng),
    }))
    .sort(byPointThenId);

  const [largest, rival] = connectedGroups(candidates);
  if (!largest) return null;
  const size = largest.members.length;
  if (size < YARD_MIN_CLUSTER) return null;
  if (size / candidates.length < YARD_MIN_SHARE) return null;
  if (rival && size < YARD_DOMINANCE_RATIO * rival.members.length) return null;
  if (
    spanCells(largest.cells, 'cx') > YARD_MAX_SPAN_CELLS ||
    spanCells(largest.cells, 'cy') > YARD_MAX_SPAN_CELLS
  ) {
    return null;
  }

  const centre: PointM = {
    x: largest.members.reduce((sum, c) => sum + c.point.x, 0) / size,
    y: largest.members.reduce((sum, c) => sum + c.point.y, 0) / size,
  };
  const distances = largest.members
    .map((c) => Math.hypot(c.point.x - centre.x, c.point.y - centre.y))
    .sort((a, b) => a - b);
  const p90 = distances[Math.ceil(RADIUS_PERCENTILE * distances.length) - 1] ?? 0;
  const radiusM = Math.max(YARD_MIN_RADIUS_M, Math.round(p90 + YARD_RADIUS_PAD_M));

  const { lat, lng } = fromMetres(centre, originLat, originLng);
  return { lat, lng, radiusM, parked: candidates.length, inCluster: size };
}

/** Yards for every depot id present, skipping rows with no home depot. */
export function inferYards(rows: readonly DepotBusRow[]): ReadonlyMap<string, Yard> {
  const byDepot = new Map<string, DepotBusRow[]>();
  for (const row of rows) {
    if (row.depotId === null) continue;
    const group = byDepot.get(row.depotId) ?? [];
    group.push(row);
    byDepot.set(row.depotId, group);
  }
  const yards = new Map<string, Yard>();
  for (const id of [...byDepot.keys()].sort()) {
    const yard = inferYard(byDepot.get(id) ?? []);
    if (yard) yards.set(id, yard);
  }
  return yards;
}
