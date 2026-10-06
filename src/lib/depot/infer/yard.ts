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
 * A yard is learned, not surveyed. Parked buses are counted in grid cells
 * YARD_CELL_M wide. A cell holding at least YARD_LINK_MIN_BUSES buses is a
 * linking cell, and linking cells that touch (diagonals included) form one
 * group, so a yard of any contiguous shape is measured whole. A cell holding a
 * single bus joins the group of a linking cell it touches as a leaf: it is part
 * of that group but never connects it to anything further. So a queue, or buses
 * parked one per cell along the approach road, cannot join the yard to a stand
 * beyond it, while a continuous line of buses parked two or more per cell is
 * still one place. A leaf touching two groups joins the one with more buses in
 * its linking cells, ties to the one whose lowest linking cell (by x, then y)
 * is lower, so the result never depends on input order. A single bus touching
 * no linking cell belongs to no group. That has two costs. A depot so thinly
 * parked that every cell holds one bus has no linking cell and so no yard; its
 * buses read as location unknown, never as departed. And in a thinly parked
 * part of a yard, a lone bus two cells from any linking cell is not a member,
 * so it can lie outside the radius below and read as away.
 *
 * The yard is the largest group. A stand separated from it by an empty cell or
 * by single buses is a different place: its buses are not in the yard, and it
 * is the rival. No yard is claimed unless the group is big enough, holds at
 * least half the depot's parked buses, is YARD_DOMINANCE_RATIO times the
 * second-largest group, and spans at most YARD_MAX_SPAN_CELLS, because guessing
 * between comparable stands would put every departure judged against the yard
 * in the wrong place. All of these count the group with its leaves.
 *
 * The radius is the distance from the centre to the group's farthest bus plus
 * YARD_RADIUS_PAD_M (never below YARD_MIN_RADIUS_M), so every bus of the group,
 * leaves included, lies inside it and none of them is reported as away. The
 * centre is the members' mean, so it lies within the group's bounding box, at
 * most YARD_MAX_SPAN_CELLS cells square: the radius is at most that square's
 * diagonal plus the padding, 10 * sqrt(2) * 150 + 40 = about 2162 m.
 */

/** Grid cell for counting parked buses; about a bus-park's width. */
export const YARD_CELL_M = 150;
/** Fewer parked buses than this is a coincidence of stops, not a yard. */
export const YARD_MIN_CLUSTER = 6;
/** The yard must hold at least this share of the depot's parked buses. */
export const YARD_MIN_SHARE = 0.5;
/** A yard is never claimed smaller than a few bays. */
export const YARD_MIN_RADIUS_M = 120;
/** Margin beyond the farthest bus of the yard so its edge bays count as inside. */
export const YARD_RADIUS_PAD_M = 40;
/**
 * The yard must beat the second-largest group by this factor: one bus moving
 * must not relocate the yard by tens of kilometres.
 */
export const YARD_DOMINANCE_RATIO = 1.5;
/** A group longer than this many cells (1.5 km) on either axis is a road, not a yard. */
export const YARD_MAX_SPAN_CELLS = 10;
/** Only cells holding this many buses connect a group; a lone bus is a leaf. */
export const YARD_LINK_MIN_BUSES = 2;
/**
 * Grid origin is the median position snapped to this many degrees (about 1 km),
 * so cell boundaries do not shift when a single bus moves the median.
 */
const ORIGIN_SNAP_DEG = 0.01;

/** The inferred yard and the registration numbers of the buses that form it. */
export interface YardGroup {
  readonly yard: Yard;
  readonly members: readonly string[];
}

interface Candidate {
  readonly registrationNumber: string;
  readonly point: PointM;
}

interface CellKey {
  readonly cx: number;
  readonly cy: number;
}

interface Group {
  /** Linking cells, then leaves. */
  readonly cells: readonly CellKey[];
  readonly members: readonly Candidate[];
  /** Lowest linking cell by (cx, cy): the deterministic tie-break. */
  readonly lowest: CellKey;
}

function isParkedWithFix(row: DepotBusRow): row is PositionedRow {
  if (!hasUsablePosition(row) || row.speedKmph === null) return false;
  return row.speedKmph <= MOVING_SPEED_KMPH;
}

function byPointThenId(a: Candidate, b: Candidate): number {
  const ids =
    a.registrationNumber < b.registrationNumber
      ? -1
      : a.registrationNumber > b.registrationNumber
        ? 1
        : 0;
  return a.point.x - b.point.x || a.point.y - b.point.y || ids;
}

const snap = (degrees: number): number => Math.round(degrees / ORIGIN_SNAP_DEG) * ORIGIN_SNAP_DEG;
const cellOf = (p: PointM): CellKey => ({
  cx: Math.floor(p.x / YARD_CELL_M),
  cy: Math.floor(p.y / YARD_CELL_M),
});
const keyOf = ({ cx, cy }: CellKey): string => `${cx}:${cy}`;
const compareCells = (a: CellKey, b: CellKey): number => a.cx - b.cx || a.cy - b.cy;
const OFFSETS = [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dy) => ({ dx, dy })));
const touching = (c: CellKey): CellKey[] =>
  OFFSETS.map(({ dx, dy }) => ({ cx: c.cx + dx, cy: c.cy + dy }));

/** Connected groups of linking cells (8-neighbourhood), each sorted, lowest cell first. */
function linkedCells(linking: ReadonlyMap<string, CellKey>): readonly (readonly CellKey[])[] {
  const seen = new Set<string>();
  const groups: CellKey[][] = [];
  for (const start of [...linking.values()].sort(compareCells)) {
    if (seen.has(keyOf(start))) continue;
    seen.add(keyOf(start));
    const cells: CellKey[] = [];
    const stack: CellKey[] = [start];
    while (stack.length > 0) {
      const cell = stack.pop() as CellKey;
      cells.push(cell);
      for (const next of touching(cell).filter(
        (n) => linking.has(keyOf(n)) && !seen.has(keyOf(n)),
      )) {
        seen.add(keyOf(next));
        stack.push(next);
      }
    }
    groups.push(cells.sort(compareCells));
  }
  return groups;
}

/** Groups of linking cells with their single-bus leaves attached, largest first. */
function yardGroups(candidates: readonly Candidate[]): readonly Group[] {
  const occupied = new Map<string, { readonly cell: CellKey; readonly buses: number }>();
  for (const { point } of candidates) {
    const cell = cellOf(point);
    occupied.set(keyOf(cell), { cell, buses: (occupied.get(keyOf(cell))?.buses ?? 0) + 1 });
  }
  const busesIn = (key: string): number => occupied.get(key)?.buses ?? 0;
  const isLinking = (key: string): boolean => busesIn(key) >= YARD_LINK_MIN_BUSES;
  const linking = new Map(
    [...occupied].filter(([key]) => isLinking(key)).map(([key, { cell }]) => [key, cell]),
  );

  const cores = linkedCells(linking).map((cells) => ({
    cells,
    buses: cells.reduce((sum, cell) => sum + busesIn(keyOf(cell)), 0),
    lowest: cells[0] as CellKey,
  }));
  const coreOf = new Map<string, number>();
  cores.forEach((core, id) => core.cells.forEach((cell) => coreOf.set(keyOf(cell), id)));

  // Leaves look up hosts in coreOf only, so a leaf never makes a host for another leaf.
  const groupOf = new Map(coreOf);
  const leavesOf = new Map<number, CellKey[]>();
  for (const [key, { cell }] of occupied) {
    if (isLinking(key)) continue;
    const hosts = [...new Set(touching(cell).flatMap((n) => coreOf.get(keyOf(n)) ?? []))];
    const [host] = hosts.sort(
      (a, b) =>
        cores[b]!.buses - cores[a]!.buses || compareCells(cores[a]!.lowest, cores[b]!.lowest),
    );
    if (host === undefined) continue;
    groupOf.set(key, host);
    leavesOf.set(host, [...(leavesOf.get(host) ?? []), cell]);
  }

  return cores
    .map((core, id) => ({
      cells: [...core.cells, ...(leavesOf.get(id) ?? [])],
      members: candidates.filter((c) => groupOf.get(keyOf(cellOf(c.point))) === id),
      lowest: core.lowest,
    }))
    .sort((a, b) => b.members.length - a.members.length || compareCells(a.lowest, b.lowest));
}

function spanCells(cells: readonly CellKey[], axis: 'cx' | 'cy'): number {
  const values = cells.map((cell) => cell[axis]);
  return Math.max(...values) - Math.min(...values) + 1;
}

function isConfident(
  largest: Group | undefined,
  rival: Group | undefined,
  total: number,
): largest is Group {
  if (!largest) return false;
  const size = largest.members.length;
  if (size < YARD_MIN_CLUSTER || size / total < YARD_MIN_SHARE) return false;
  if (rival && size < YARD_DOMINANCE_RATIO * rival.members.length) return false;
  return (
    spanCells(largest.cells, 'cx') <= YARD_MAX_SPAN_CELLS &&
    spanCells(largest.cells, 'cy') <= YARD_MAX_SPAN_CELLS
  );
}

/**
 * Infer one depot's yard and the buses forming it; null unless the evidence is
 * strong (see the rule above) rather than a guess or a midpoint.
 */
export function inferYardGroup(rows: readonly DepotBusRow[]): YardGroup | null {
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

  const [largest, rival] = yardGroups(candidates);
  if (!isConfident(largest, rival, candidates.length)) return null;

  const { members } = largest;
  const centre: PointM = {
    x: members.reduce((sum, c) => sum + c.point.x, 0) / members.length,
    y: members.reduce((sum, c) => sum + c.point.y, 0) / members.length,
  };
  const farthest = Math.max(
    ...members.map((c) => Math.hypot(c.point.x - centre.x, c.point.y - centre.y)),
  );
  const radiusM = Math.max(YARD_MIN_RADIUS_M, Math.ceil(farthest + YARD_RADIUS_PAD_M));

  const { lat, lng } = fromMetres(centre, originLat, originLng);
  return {
    yard: { lat, lng, radiusM, parked: candidates.length, inCluster: members.length },
    members: members.map((c) => c.registrationNumber).sort(),
  };
}

/** One depot's yard; null unless the evidence is strong (see the rule above). */
export function inferYard(rows: readonly DepotBusRow[]): Yard | null {
  return inferYardGroup(rows)?.yard ?? null;
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
