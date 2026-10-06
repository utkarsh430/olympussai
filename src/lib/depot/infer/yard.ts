import type { DepotBusRow } from '@/models/depotLive';
import { fromMetres, median, toMetres, type PointM } from './geo';
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
 * There is deliberately no maximum radius. The cluster is the winning 150 m cell
 * plus its eight neighbours, a 3x3 block, so every member and therefore the
 * cluster mean lie inside it, and no member is farther from the centre than the
 * block's diagonal (3 * sqrt(2) * YARD_CELL_M, about 636 m). The radius is the
 * 90th-percentile distance plus YARD_RADIUS_PAD_M, so the cell size already
 * bounds it; a separate cap could never take effect.
 */
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
  readonly members: readonly Candidate[];
}

function isParkedWithFix(row: DepotBusRow): boolean {
  const { latitude, longitude, speedKmph } = row;
  if (latitude === null || longitude === null || speedKmph === null) return false;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  // (0, 0) is a device default, not a place.
  if (latitude === 0 && longitude === 0) return false;
  return speedKmph <= MOVING_SPEED_KMPH;
}

function byPointThenId(a: Candidate, b: Candidate): number {
  return (
    a.point.x - b.point.x ||
    a.point.y - b.point.y ||
    (a.registrationNumber < b.registrationNumber ? -1 : a.registrationNumber > b.registrationNumber ? 1 : 0)
  );
}

function binIntoCells(candidates: readonly Candidate[]): readonly Cell[] {
  const cells = new Map<string, { cx: number; cy: number; members: Candidate[] }>();
  for (const candidate of candidates) {
    const cx = Math.floor(candidate.point.x / YARD_CELL_M);
    const cy = Math.floor(candidate.point.y / YARD_CELL_M);
    const key = `${cx}:${cy}`;
    const cell = cells.get(key) ?? { cx, cy, members: [] };
    cell.members.push(candidate);
    cells.set(key, cell);
  }
  // Densest first; ties go to the lowest cell key so the winner never depends on input order.
  return [...cells.values()].sort(
    (a, b) => b.members.length - a.members.length || a.cx - b.cx || a.cy - b.cy,
  );
}

function isNeighbour(a: Cell, b: Cell): boolean {
  return Math.abs(a.cx - b.cx) <= 1 && Math.abs(a.cy - b.cy) <= 1;
}

/**
 * Infer one depot's yard from where its buses are parked.
 *
 * No surveyed location exists, so a yard is claimed only on strong evidence:
 * enough parked buses, a clear majority of them in one place, and no equally
 * dense rival place (two equal stands is ambiguity, not a yard). Anything weaker
 * returns null rather than a guess or a midpoint.
 */
export function inferYard(rows: readonly DepotBusRow[]): Yard | null {
  const parked = rows.filter(isParkedWithFix);
  if (parked.length < YARD_MIN_CLUSTER) return null;

  const originLat = median(parked.map((row) => row.latitude as number));
  const originLng = median(parked.map((row) => row.longitude as number));
  const candidates = parked
    .map((row) => ({
      registrationNumber: row.registrationNumber,
      point: toMetres(row.latitude as number, row.longitude as number, originLat, originLng),
    }))
    .sort(byPointThenId);

  const cells = binIntoCells(candidates);
  const winner = cells[0];
  if (!winner) return null;

  const rival = cells.find((cell) => !isNeighbour(cell, winner) && cell !== winner);
  if (rival && rival.members.length === winner.members.length) return null;

  const cluster = candidates.filter((candidate) =>
    isNeighbour(
      {
        cx: Math.floor(candidate.point.x / YARD_CELL_M),
        cy: Math.floor(candidate.point.y / YARD_CELL_M),
        members: [],
      },
      winner,
    ),
  );
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
