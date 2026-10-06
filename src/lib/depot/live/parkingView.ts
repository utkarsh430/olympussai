import type { DepotBusView, DepotDetailResponse } from '../api';
import type { Lane } from '../duties/types';
import { logDepotError } from '@/lib/serverLog';
import type { FleetSnapshotView } from '../repositories/types';
import { planParking } from '../optimise/parkingOrder';
import { modelDepotMaster } from '../sim/depotMaster';
import { operatingDateOf } from '../sim/seed';
import { modelYardLayout } from '../sim/yardLayout';
import type {
  ParkingCapacity,
  ParkingLane,
  ParkingOrder,
  ParkingOverflowReason,
  ParkingResponse,
  ParkingState,
} from '../yard/parkingApi';
import { analyseSnapshot, feedEnvelope, type SnapshotAnalysis } from './analysis';
import { buildDepotDetail } from './depotView';
import { dutyPlanFor, laterDayPlanFor } from './operatingDayView';
import type { DutyPlan } from '../sim/dayPlan';

type ParkingBody = Omit<ParkingResponse, keyof ReturnType<typeof feedEnvelope>>;

interface ParkedBus {
  readonly registrationNumber: string;
  readonly firstDutyStartMin: number | null;
}

const MS_PER_DAY = 86_400_000;

/**
 * The day after a YYYY-MM-DD operating date. Calendar arithmetic in UTC on the
 * date string alone, so the wall clock and the server's time zone never enter.
 */
export function nextOperatingDate(operatingDate: string): string {
  const [year, month, day] = operatingDate.split('-').map(Number);
  const next = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1) + MS_PER_DAY);
  return next.toISOString().slice(0, 10);
}

/** The one place a registration is cleaned: the duty lookup and the planner share this value. */
const cleanRegistration = (registration: string): string => registration.trim();

/** The earliest start among the duties each bus was assigned; no entry means no duty. */
function firstDutyByBus(
  planned: DutyPlan,
): ReadonlyMap<string, number> {
  const startOf = new Map(planned.duties.map((d) => [d.id, d.startMin]));
  const first = new Map<string, number>();
  for (const a of planned.plan.assignments) {
    const start = startOf.get(a.dutyId);
    if (a.registrationNumber === null || start === undefined || !Number.isFinite(start)) continue;
    const key = cleanRegistration(a.registrationNumber);
    const known = first.get(key);
    if (known === undefined || start < known) first.set(key, start);
  }
  return first;
}

interface ParkedSet {
  readonly parked: readonly ParkedBus[];
  /** In-yard rows left out because the registration is blank or repeats an earlier row. */
  readonly dropped: number;
}

/**
 * The buses to park: exactly the depot's own buses the feed places in its yard
 * (`location === 'in_yard'`); a bus standing elsewhere is not in this plan. A
 * blank or repeated registration is dropped and counted, so the planner, which
 * rejects both, never sees it and the page can reconcile with the depot detail.
 */
function parkedBuses(
  buses: readonly DepotBusView[],
  firstDuty: ReadonlyMap<string, number>,
): ParkedSet {
  const seen = new Set<string>();
  const parked: ParkedBus[] = [];
  let dropped = 0;
  for (const bus of buses) {
    if (bus.location !== 'in_yard') continue;
    const registration = cleanRegistration(bus.registrationNumber);
    if (registration === '' || seen.has(registration)) {
      dropped += 1;
      continue;
    }
    seen.add(registration);
    parked.push({
      registrationNumber: registration,
      firstDutyStartMin: firstDuty.get(registration) ?? null,
    });
  }
  return { parked, dropped };
}

function toLanes(
  lanes: readonly Lane[],
  slots: ReturnType<typeof planParking>['slots'],
): ParkingLane[] {
  return lanes.map((lane) => {
    const inLane = slots
      .filter((s) => s.laneId === lane.id)
      .sort((a, b) => b.position - a.position);
    return {
      id: lane.id,
      depth: lane.depth,
      slots: inLane.map((s, i) => ({
        position: i + 1,
        registrationNumber: s.registrationNumber,
        firstDutyStartMin: s.firstDutyStartMin,
      })),
    };
  });
}

/**
 * Overflow reasons. Buses beyond what the bays could hold even with no visitors
 * did not fit by their own number; the rest are shut out by visiting buses.
 */
function overflowReasons(
  overflow: readonly string[],
  parkedCount: number,
  bays: number,
): readonly ParkingOverflowReason[] {
  const ownShortfall = Math.max(0, parkedCount - bays);
  return overflow.map((_, i) => (i < ownShortfall ? 'no_lane_space' : 'places_taken_by_visitors'));
}

function orderFor(
  lanes: readonly Lane[],
  parked: readonly ParkedBus[],
  bays: number,
): ParkingOrder {
  const plan = planParking(lanes, parked);
  const startOf = new Map(parked.map((b) => [b.registrationNumber, b.firstDutyStartMin]));
  const reasons = overflowReasons(plan.overflow, parked.length, bays);
  return {
    provenance: 'modelled',
    lanes: toLanes(lanes, plan.slots),
    overflow: plan.overflow.map((registrationNumber, i) => ({
      registrationNumber,
      firstDutyStartMin: startOf.get(registrationNumber) ?? null,
      reason: reasons[i] ?? 'no_lane_space',
    })),
    blocked: plan.blocked,
    parkedCount: plan.slots.length,
  };
}

function capacityOf(detail: DepotDetailResponse, bays: number): ParkingCapacity {
  const yardKnown = detail.yard.value !== null;
  return {
    bays: { value: bays, provenance: 'modelled' },
    // The yard is inferred, so what stands in it is DERIVED, not LIVE.
    inYard: { value: yardKnown ? detail.locationMix.in_yard : null, provenance: 'derived' },
    visiting: { value: detail.visitors.length, provenance: 'derived' },
    fleet: { value: detail.depot.fleet, provenance: 'live' },
  };
}

interface PlannedDate {
  readonly operatingDate: string;
  readonly planned: DutyPlan | null;
}

/**
 * The date the night order plans and the plan it reads.
 * Before the first duty of the feed's date that day has not begun: its yard
 * buses leave for it, so the order reads that day's one shared plan. From the
 * first duty on, it plans the next date with the later-day plan, which covers
 * only the buses in the yard.
 */
function plannedDate(analysis: SnapshotAnalysis, depotId: string, feedDate: string): PlannedDate {
  const today = dutyPlanFor(analysis, depotId, feedDate);
  if (today?.mode === 'before_first_duty') return { operatingDate: feedDate, planned: today };
  const operatingDate = nextOperatingDate(feedDate);
  return { operatingDate, planned: laterDayPlanFor(analysis, depotId, operatingDate) };
}

function buildBody(
  detail: DepotDetailResponse,
  operatingDate: string,
  planned: DutyPlan | null,
): ParkingBody | null {
  if (!planned) return null;
  const bays = modelDepotMaster(detail.depot).parkingCapacity;
  const capacity = capacityOf(detail, bays);
  const base = { depot: { id: detail.depot.id, name: detail.depot.name }, operatingDate, capacity };
  const empty = (state: ParkingState): ParkingBody => ({
    ...base,
    state,
    order: null,
    droppedRows: 0,
  });
  if (detail.yard.value === null) return empty('no_yard');
  const { parked, dropped } = parkedBuses(detail.buses, firstDutyByBus(planned));
  const withDropped = (state: ParkingState, order: ParkingOrder | null): ParkingBody => ({
    ...base,
    state,
    order,
    droppedRows: dropped,
  });
  if (parked.length === 0) return withDropped('no_buses', null);
  try {
    // Visiting buses stand in places too: shorten the lanes from the back by that many.
    const places = Math.max(0, bays - detail.visitors.length);
    const order = orderFor(modelYardLayout(detail.depot, places), parked, bays);
    return withDropped('planned', order);
  } catch (error) {
    // The planner and the layout reject only malformed input; that is an empty state, not a
    // 500. It is logged, so a planner fault does not pass for rows that cannot be planned.
    if (!(error instanceof RangeError)) throw error;
    logDepotError('parking', error);
    return withDropped('not_plannable', null);
  }
}

/*
 * The body depends on the rows (through the analysis), the depot and the date,
 * so it is held per analysis under that key. The envelope is never part of it.
 */
const bodies = new WeakMap<SnapshotAnalysis, Map<string, ParkingBody>>();

/**
 * One depot's night parking order, or null when the feed has no such depot.
 * It is for the day after the feed date, except before the first duty of the
 * feed date, when it is for that date itself; `operatingDate`
 * says which. For the day after, each bus's first duty comes from the
 * later-day plan, which covers the YARD BUSES ONLY (every bus out now is held
 * out): it says which yard bus leaves first, never how many duties the depot
 * can cover that day. The order rests on modelled duties and a
 * modelled yard layout, so it is tagged MODELLED; it is a suggestion only and
 * nothing is dispatched. The clock is the feed's, never the wall clock.
 */
export function buildParkingResponse(
  view: FleetSnapshotView,
  depotId: string,
): ParkingResponse | null {
  const analysis = analyseSnapshot(view);
  if (!analysis.depotsById.has(depotId)) return null;
  const feedDate = operatingDateOf(view.feedNow, view.fetchedAt);
  const held = bodies.get(analysis) ?? new Map<string, ParkingBody>();
  bodies.set(analysis, held);
  // The planned date follows from the analysis, the depot and the feed date, so those key it.
  const key = `${depotId}|${feedDate}`;
  const cached = held.get(key);
  if (cached) return { ...feedEnvelope(view), ...cached };
  const detail = buildDepotDetail(view, depotId);
  if (!detail) return null;
  // The plan's mode rests on the feed clock, which is the analysis's, so the date is too.
  const { operatingDate, planned } = plannedDate(analysis, depotId, feedDate);
  const body = buildBody(detail, operatingDate, planned);
  if (!body) return null;
  held.set(key, body);
  return { ...feedEnvelope(view), ...body };
}
