import type { DepotBusRow } from '@/models/depotLive';
import type { FleetSnapshotView } from '../repositories/types';
import type { SnapshotAnalysis } from '../live/analysis';
import { buildRouteTable } from '../routes/routeTable';
import type { RouteRow } from '../routes/routeTableTypes';
import { operatingDateOf } from '../sim/seed';
import type { BusOpState } from '../types';
import { SLOT_MINUTES, type DepotSlotSample, type RouteSlotSample, type SlotSample } from './types';

export {
  depotHourFromSlots,
  hourFromSlots,
  observedHourCount,
  slotsOfHour,
} from './observeHours';

/*
 * What one fleet snapshot contributes to the day's hourly record: the route
 * and depot figures of the 5-minute slot of feed time it falls in. Pure: the
 * feed clock's digits are the only clock, read straight off the string (they
 * are Indian wall-clock time behind a misleading `Z`), never converted.
 */

const FEED_CLOCK = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/;
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;

export interface FeedSlot {
  readonly operatingDate: string;
  /** 0 to 287 within the operating date. */
  readonly slot: number;
}

/** The operating date and 5-minute slot of a feed time; null without a usable feed clock. */
export function slotOf(feedNow: string | null): FeedSlot | null {
  if (feedNow === null) return null;
  const match = FEED_CLOCK.exec(feedNow);
  if (match === null || Number.isNaN(Date.parse(feedNow))) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours >= HOURS_PER_DAY || minutes >= MINUTES_PER_HOUR) return null;
  let operatingDate: string;
  try {
    operatingDate = operatingDateOf(feedNow, feedNow);
  } catch {
    // The date digits are not a calendar date: the snapshot belongs to no slot.
    return null;
  }
  return { operatingDate, slot: Math.floor((hours * MINUTES_PER_HOUR + minutes) / SLOT_MINUTES) };
}

const hasRouteName = (row: DepotBusRow): boolean =>
  row.routeName !== null && row.routeName.trim() !== '';

function routeSampleOf(row: RouteRow): RouteSlotSample {
  const { coverage, lateShare, medianMin } = row.delay;
  return {
    routeName: row.routeName,
    buses: row.buses,
    states: row.states,
    delayMedianMin: medianMin,
    // The table keeps the share to four decimals; the count it came from is whole.
    late: lateShare === null ? 0 : Math.round(lateShare * coverage.n),
    delayCovered: coverage.n,
    operators: Object.fromEntries(row.operators.map((o) => [o.depotId, o.buses])),
  };
}

const MOVING: ReadonlySet<BusOpState> = new Set<BusOpState>(['in_service', 'on_road']);

function depotSampleOf(
  depotId: string,
  analysis: SnapshotAnalysis,
): Omit<DepotSlotSample, 'fleet' | 'states'> {
  const own = analysis.rowsByDepot.get(depotId) ?? [];
  const yardKnown = analysis.yards.has(depotId);
  let standingInYard = 0;
  let unroutedOnRoad = 0;
  for (const row of own) {
    const state = analysis.stateOf(row);
    if (state === 'standing' && yardKnown && analysis.locate(row).location === 'in_yard') {
      standingInYard += 1;
    }
    if (MOVING.has(state) && !hasRouteName(row)) unroutedOnRoad += 1;
  }
  return { depotId, standingInYard: yardKnown ? standingInYard : null, unroutedOnRoad };
}

/**
 * The slot sample of one snapshot: per route carrying buses, its buses, state
 * mix, delay and operators (the live route table's figures); per depot, its
 * fleet, state mix, standing buses inside its own yard (the pool an "add" may
 * draw from) and buses moving with no route name. Null without a feed clock.
 * The route table is built here from the analysis rather than through its
 * per-snapshot memo, because this runs while the analysis is being made.
 */
export function slotSampleOf(
  view: FleetSnapshotView,
  analysis: SnapshotAnalysis,
): SlotSample | null {
  const at = slotOf(view.feedNow);
  if (at === null || view.feedNow === null) return null;
  const table = buildRouteTable(view.rows, analysis.stateOf, analysis.feedNow);
  return {
    operatingDate: at.operatingDate,
    slot: at.slot,
    feedNow: view.feedNow,
    totalRows: view.rows.length,
    routedRows: table.reduce((sum, row) => sum + row.buses, 0),
    routes: table.map(routeSampleOf),
    depots: analysis.depots.map((d) => ({
      ...depotSampleOf(d.id, analysis),
      fleet: d.fleet,
      states: d.states,
    })),
  };
}
