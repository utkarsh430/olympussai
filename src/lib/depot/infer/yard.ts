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

/** Grid cell for counting parked buses; about a bus-park's width. */
export const YARD_CELL_M = 150;
/** Fewer parked buses than this is a coincidence of stops, not a yard. */
export const YARD_MIN_CLUSTER = 6;
/** The yard must hold at least this share of the depot's parked buses. */
export const YARD_MIN_SHARE = 0.5;
/** A yard is never claimed smaller than a few bays. */
export const YARD_MIN_RADIUS_M = 120;
/*
 * There is deliberately no maximum radius. The measured cluster is the winning
 * block (3x3 cells) plus the ring of cells touching it, a 5x5 block of
 * YARD_CELL_M cells. Every member, and so the cluster mean, lies inside that
 * block, so no member is farther from the centre than its diagonal
 * (5 * sqrt(2) * YARD_CELL_M, about 1061 m). The radius is the 90th-percentile
 * distance plus YARD_RADIUS_PAD_M, so the cell size already bounds it; a
 * separate cap could never take effect.
 */
/**
 * The winning stand must hold at least this multiple of the best rival stand.
 * Without a margin one bus moving would relocate the yard by tens of
 * kilometres, and two near-equal stands would yield an arbitrary pick.
 */
export const YARD_DOMINANCE_RATIO = 1.5;
/**
 * A rival stand's centre must be at least 4 cells from the winner's. Blocks 3
 * apart share an edge, so they are one yard seen through the grid, not two; at
 * 4 a full empty cell separates them.
 */
const RIVAL_MIN_GRID_DISTANCE = 4;
/** Cells at this distance from the winner's centre touch its block and join the cluster. */
const CLUSTER_RADIUS_CELLS = 2;
/** Tolerance when comparing distances to the median, so float noise never decides a tie. */
const TIE_EPSILON_M = 1e-6;
/**
 * Grid origin is the median position snapped to this many degrees (about 1 km),
 * so cell boundaries do not shift when a single bus moves the median.
 */
const ORIGIN_SNAP_DEG = 0.01;
/** Margin beyond the 90th-percentile bus so edge bays still count as inside. */
export const YARD_RADIUS_PAD_M = 40;

const RADIUS_PERCENTILE = 0.9;

interface Candidate {
  readonly registrationNumber: string;
  readonly point: PointM;
}

interface Cell {
  readonly cx: number;
  readonly cy: number;
  readonly count: number;
  /** Buses in this cell and its eight neighbours: the stand centred here. */
  readonly blockTotal: number;
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

function cellOf(point: PointM): { readonly cx: number; readonly cy: number } {
  return { cx: Math.floor(point.x / YARD_CELL_M), cy: Math.floor(point.y / YARD_CELL_M) };
}

function gridDistance(a: Cell, b: Cell): number {
  return Math.max(Math.abs(a.cx - b.cx), Math.abs(a.cy - b.cy));
}

/** Occupied cells in ascending (cx, cy) order, each with its stand total. */
function binIntoCells(candidates: readonly Candidate[]): readonly Cell[] {
  const counts = new Map<string, { cx: number; cy: number; count: number }>();
  for (const candidate of candidates) {
    const { cx, cy } = cellOf(candidate.point);
    const key = `${cx}:${cy}`;
    const cell = counts.get(key) ?? { cx, cy, count: 0 };
    counts.set(key, { ...cell, count: cell.count + 1 });
  }
  const occupied = [...counts.values()].sort((a, b) => a.cx - b.cx || a.cy - b.cy);
  return occupied.map((cell) => ({
    ...cell,
    blockTotal: occupied
      .filter((other) => Math.max(Math.abs(other.cx - cell.cx), Math.abs(other.cy - cell.cy)) <= 1)
      .reduce((sum, other) => sum + other.count, 0),
  }));
}

/**
 * Infer one depot's yard from where its buses are parked.
 *
 * No surveyed location exists, so a yard is claimed only on strong evidence:
 * enough parked buses, a majority of them in one stand (a 3x3 block of cells plus the ring
 * touching it),
 * and that stand at least YARD_DOMINANCE_RATIO times any separate rival stand.
 * Two comparable stands are ambiguity, not a yard. Anything weaker returns null
 * rather than a guess or a midpoint.
 */
export function inferYard(rows: readonly DepotBusRow[]): Yard | null {
  const parked = rows.filter(isParkedWithFix);
  if (parked.length < YARD_MIN_CLUSTER) return null;

  const medianLat = median(parked.map((row) => row.latitude));
  const medianLng = median(parked.map((row) => row.longitude));
  const originLat = snap(medianLat);
  const originLng = snap(medianLng);
  const medianPoint = toMetres(medianLat, medianLng, originLat, originLng);
  const candidates = parked
    .map((row) => ({
      registrationNumber: row.registrationNumber,
      point: toMetres(row.latitude, row.longitude, originLat, originLng),
    }))
    .sort(byPointThenId);

  const cells = binIntoCells(candidates);
  const distanceToMedian = (cell: Cell): number =>
    Math.hypot(
      (cell.cx + 0.5) * YARD_CELL_M - medianPoint.x,
      (cell.cy + 0.5) * YARD_CELL_M - medianPoint.y,
    );
  // The fullest stand wins. Equal stands go to the one centred nearest the
  // median of all parked buses (so a wide yard is centred, not lopsided), then
  // to the lowest cell key; cells are in key order, so only a strict win replaces.
  const winner = cells.reduce<Cell | null>((best, cell) => {
    if (best === null || cell.blockTotal > best.blockTotal) return cell;
    if (cell.blockTotal < best.blockTotal) return best;
    return distanceToMedian(cell) < distanceToMedian(best) - TIE_EPSILON_M ? cell : best;
  }, null);
  if (!winner) return null;

  // The yard is the winning block plus the ring of cells touching it, so a yard
  // up to five cells across is measured whole.
  const cluster = candidates.filter((candidate) => {
    const { cx, cy } = cellOf(candidate.point);
    return (
      Math.abs(cx - winner.cx) <= CLUSTER_RADIUS_CELLS &&
      Math.abs(cy - winner.cy) <= CLUSTER_RADIUS_CELLS
    );
  });

  // A rival is a stand separated from the winner's by at least one empty cell.
  // Blocks that touch or overlap are the same yard, so a wide yard never rivals itself.
  const rivalTotal = cells
    .filter((cell) => gridDistance(cell, winner) >= RIVAL_MIN_GRID_DISTANCE)
    .reduce((best, cell) => Math.max(best, cell.blockTotal), 0);
  if (cluster.length < YARD_DOMINANCE_RATIO * rivalTotal) return null;
  if (cluster.length < YARD_MIN_CLUSTER) return null;
  if (cluster.length / candidates.length < YARD_MIN_SHARE) return null;

  const centre: PointM = {
    x: cluster.reduce((sum, c) => sum + c.point.x, 0) / cluster.length,
    y: cluster.reduce((sum, c) => sum + c.point.y, 0) / cluster.length,
  };
  const distances = cluster
    .map((c) => Math.hypot(c.point.x - centre.x, c.point.y - centre.y))
    .sort((a, b) => a - b);
  const p90 = distances[Math.ceil(RADIUS_PERCENTILE * distances.length) - 1] ?? 0;
  const radiusM = Math.max(YARD_MIN_RADIUS_M, Math.round(p90 + YARD_RADIUS_PAD_M));

  const { lat, lng } = fromMetres(centre, originLat, originLng);
  return { lat, lng, radiusM, parked: candidates.length, inCluster: cluster.length };
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
