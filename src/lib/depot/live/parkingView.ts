import type { DepotBusView, DepotDetailResponse } from '../api';
import type { Lane } from '../duties/types';
import type { FleetSnapshotView } from '../repositories/types';
import { planParking } from '../optimise/parkingOrder';
import { modelDepotMaster } from '../sim/depotMaster';
import { operatingDateOf } from '../sim/seed';
import { modelYardLayout } from '../sim/yardLayout';
import type {
  ParkingCapacity,
  ParkingLane,
  ParkingOrder,
  ParkingResponse,
  ParkingState,
} from '../yard/parkingApi';
import { analyseSnapshot, feedEnvelope, type SnapshotAnalysis } from './analysis';
import { buildDepotDetail } from './depotView';
import { planDutiesFor } from './dutyView';

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

/** The earliest start among the duties each bus was assigned; no entry means no duty. */
function firstDutyByBus(
  planned: NonNullable<ReturnType<typeof planDutiesFor>>,
): ReadonlyMap<string, number> {
  const startOf = new Map(planned.duties.map((d) => [d.id, d.startMin]));
  const first = new Map<string, number>();
  for (const a of planned.plan.assignments) {
    const start = startOf.get(a.dutyId);
    if (a.registrationNumber === null || start === undefined || !Number.isFinite(start)) continue;
    const known = first.get(a.registrationNumber);
    if (known === undefined || start < known) first.set(a.registrationNumber, start);
  }
  return first;
}

/**
 * The buses to park tonight: the depot's own buses the feed places in its yard
 * now, plus its buses standing with no duty tomorrow. A blank or repeated
 * registration is dropped here so the planner, which rejects both, never sees it.
 */
function parkedBuses(
  buses: readonly DepotBusView[],
  firstDuty: ReadonlyMap<string, number>,
): ParkedBus[] {
  const seen = new Set<string>();
  const parked: ParkedBus[] = [];
  for (const bus of buses) {
    const registration = bus.registrationNumber.trim();
    const start = firstDuty.get(bus.registrationNumber) ?? null;
    const inScope = bus.location === 'in_yard' || (bus.state === 'standing' && start === null);
    if (registration === '' || seen.has(registration) || !inScope) continue;
    seen.add(registration);
    parked.push({ registrationNumber: registration, firstDutyStartMin: start });
  }
  return parked;
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

function orderFor(lanes: readonly Lane[], parked: readonly ParkedBus[]): ParkingOrder {
  const plan = planParking(lanes, parked);
  const startOf = new Map(parked.map((b) => [b.registrationNumber, b.firstDutyStartMin]));
  return {
    provenance: 'modelled',
    lanes: toLanes(lanes, plan.slots),
    overflow: plan.overflow.map((registrationNumber) => ({
      registrationNumber,
      firstDutyStartMin: startOf.get(registrationNumber) ?? null,
      reason: 'no_lane_space',
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

function buildBody(
  analysis: SnapshotAnalysis,
  detail: DepotDetailResponse,
  operatingDate: string,
): ParkingBody | null {
  const planned = planDutiesFor(analysis, detail.depot.id, detail.buses, operatingDate);
  if (!planned) return null;
  const bays = modelDepotMaster(detail.depot).parkingCapacity;
  const capacity = capacityOf(detail, bays);
  const base = { depot: { id: detail.depot.id, name: detail.depot.name }, operatingDate, capacity };
  const empty = (state: ParkingState): ParkingBody => ({ ...base, state, order: null });
  if (detail.yard.value === null) return empty('no_yard');
  const parked = parkedBuses(detail.buses, firstDutyByBus(planned));
  if (parked.length === 0) return empty('no_buses');
  try {
    const order = orderFor(modelYardLayout(detail.depot, bays), parked);
    return { ...base, state: 'planned', order };
  } catch (error) {
    // The planner and the layout reject only malformed input; that is an empty state, not a 500.
    if (error instanceof RangeError) return empty('not_plannable');
    throw error;
  }
}

/*
 * The body depends on the rows (through the analysis), the depot and the date,
 * so it is held per analysis under that key. The envelope is never part of it.
 */
const bodies = new WeakMap<SnapshotAnalysis, Map<string, ParkingBody>>();

/**
 * One depot's night parking order for the day after the feed date, or null
 * when the feed has no such depot. The order rests on modelled duties and a
 * modelled yard layout, so it is tagged MODELLED; it is a suggestion only and
 * nothing is dispatched. The clock is the feed's, never the wall clock.
 */
export function buildParkingResponse(
  view: FleetSnapshotView,
  depotId: string,
): ParkingResponse | null {
  const detail = buildDepotDetail(view, depotId);
  if (!detail) return null;
  const analysis = analyseSnapshot(view);
  const operatingDate = nextOperatingDate(operatingDateOf(view.feedNow, view.fetchedAt));
  const held = bodies.get(analysis) ?? new Map<string, ParkingBody>();
  bodies.set(analysis, held);
  const key = `${depotId}|${operatingDate}`;
  let body = held.get(key);
  if (!body) {
    const built = buildBody(analysis, detail, operatingDate);
    if (!built) return null;
    body = built;
    held.set(key, body);
  }
  return { ...feedEnvelope(view), ...body };
}
