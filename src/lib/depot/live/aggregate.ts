import type { DepotBusRow } from '@/models/depotLive';
import { classifyBusState } from '../infer/busState';
import { isUsablePosition } from '../infer/geo';
import { REPORTING_WINDOW_MIN } from '../infer/thresholds';
import {
  UNASSIGNED_DEPOT_ID,
  type DepotKind,
  type DepotSummary,
  type Figure,
  type LatLng,
  type NetworkKpis,
  type StateMix,
  type StatusMix,
} from '../types';
import { classifyDepotKind } from './depotKind';

const UNASSIGNED_NAME = 'Unassigned';
import { NORMAL_TAMPER_CODE } from '../exceptions/config';
import { MS_PER_MINUTE } from '@/lib/depot/units';
import { medianOr } from '@/lib/depot/stats/robust';

const EMPTY_STATUS: StatusMix = { live: 0, stationary: 0, noSignal: 0, underMaintenance: 0, unknown: 0 };
const EMPTY_STATES: StateMix = { inService: 0, onRoad: 0, standing: 0, dark: 0, offRoad: 0 };

const STATUS_KEY: Record<DepotBusRow['vehicleStatus'], keyof StatusMix> = {
  live: 'live',
  stationary: 'stationary',
  no_signal: 'noSignal',
  under_maintenance: 'underMaintenance',
  unknown: 'unknown',
};

const STATE_KEY: Record<ReturnType<typeof classifyBusState>, keyof StateMix> = {
  in_service: 'inService',
  on_road: 'onRoad',
  standing: 'standing',
  dark: 'dark',
  off_road: 'offRoad',
};

/** Per-axis median of the usable positions; a (0, 0) fix is no place, so it never pulls the median. */
function centroidOf(rows: readonly DepotBusRow[]): LatLng | null {
  const placed = rows.filter(isUsablePosition);
  if (placed.length === 0) return null;
  return {
    lat: medianOr(placed.map((r) => r.latitude), 0),
    lng: medianOr(placed.map((r) => r.longitude), 0),
  };
}

/** Most frequent name; ties go to the alphabetically first so output is stable. */
function modalName(rows: readonly DepotBusRow[], fallback: string): string {
  const counts = new Map<string, number>();
  for (const { depotName } of rows) {
    if (depotName) counts.set(depotName, (counts.get(depotName) ?? 0) + 1);
  }
  const ranked = [...counts].sort(([nameA, a], [nameB, b]) => b - a || nameA.localeCompare(nameB));
  return ranked[0]?.[0] ?? fallback;
}

/** Reporting means a fix within the window on either side: device clocks run ahead. */
function isReporting(row: DepotBusRow, feedNowMs: number): boolean {
  if (Number.isNaN(feedNowMs) || row.gpsTimestamp === null) return false;
  const fixMs = Date.parse(row.gpsTimestamp);
  return !Number.isNaN(fixMs) && Math.abs(fixMs - feedNowMs) <= REPORTING_WINDOW_MIN * MS_PER_MINUTE;
}

function tally<K extends string>(keys: readonly K[], empty: Readonly<Record<K, number>>): Record<K, number> {
  const counts: Record<K, number> = { ...empty };
  for (const key of keys) counts[key] += 1;
  return counts;
}

function summariseOne(
  id: string,
  rows: readonly DepotBusRow[],
  feedNow: string | null,
): DepotSummary {
  const feedNowMs = feedNow === null ? Number.NaN : Date.parse(feedNow);
  const isUnassigned = id === UNASSIGNED_DEPOT_ID;
  const name = isUnassigned ? UNASSIGNED_NAME : modalName(rows, `Depot ${id}`);
  const kind: DepotKind = isUnassigned ? 'unassigned' : classifyDepotKind(name);
  return {
    id,
    name,
    kind,
    fleet: rows.length,
    status: tally(rows.map((r) => STATUS_KEY[r.vehicleStatus]), EMPTY_STATUS),
    states: tally(rows.map((r) => STATE_KEY[classifyBusState(r, feedNow)]), EMPTY_STATES),
    reporting: rows.filter((r) => isReporting(r, feedNowMs)).length,
    positioned: rows.filter((r) => r.latitude !== null && r.longitude !== null).length,
    assigned: rows.filter((r) => Boolean(r.routeName)).length,
    powerCut: rows.filter((r) => r.mainPowerOn === false).length,
    tamperFlagged: rows.filter((r) => Boolean(r.tamperCode) && r.tamperCode !== NORMAL_TAMPER_CODE)
      .length,
    centroid: centroidOf(rows),
  };
}

/**
 * Groups feed rows by home depot. Rows with no depot share one unassigned
 * bucket. Sorted by fleet descending, then name, then id, so ties are stable.
 */
export function summariseDepots(
  rows: readonly DepotBusRow[],
  feedNow: string | null,
): DepotSummary[] {
  const groups = new Map<string, DepotBusRow[]>();
  for (const row of rows) {
    const id = row.depotId ?? UNASSIGNED_DEPOT_ID;
    const group = groups.get(id);
    if (group) group.push(row);
    else groups.set(id, [row]);
  }
  return [...groups]
    .map(([id, group]) => summariseOne(id, group, feedNow))
    .sort((a, b) => b.fleet - a.fleet || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

function sumOf(depots: readonly DepotSummary[], pick: (d: DepotSummary) => number): number {
  return depots.reduce((total, d) => total + pick(d), 0);
}

/**
 * Network totals. Every count carries how much of the fleet it covers. The four state
 * totals use the module's classified states (`classifyBusState`), not the feed's own
 * status field, so a network total is the sum of what each depot's cockpit and roster
 * show, and the four partition the fleet: on road (in service or moving), standing, dark
 * (no signal for the dark threshold or longer) and off road.
 */
export function networkKpis(depots: readonly DepotSummary[]): NetworkKpis {
  const fleetTotal = sumOf(depots, (d) => d.fleet);
  const figure = (value: number, provenance: Figure['provenance']): Figure => ({
    value,
    provenance,
    coverage: { n: value, of: fleetTotal },
  });
  return {
    fleet: figure(fleetTotal, 'live'),
    depots: figure(depots.filter((d) => d.kind === 'depot').length, 'derived'),
    reporting: figure(sumOf(depots, (d) => d.reporting), 'derived'),
    onRoad: figure(sumOf(depots, (d) => d.states.inService + d.states.onRoad), 'derived'),
    stationary: figure(sumOf(depots, (d) => d.states.standing), 'derived'),
    noSignal: figure(sumOf(depots, (d) => d.states.dark), 'derived'),
    underMaintenance: figure(sumOf(depots, (d) => d.states.offRoad), 'derived'),
    assigned: figure(sumOf(depots, (d) => d.assigned), 'derived'),
  };
}
