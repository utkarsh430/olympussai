import type { DepotBusView } from '../../api';
import type { CrewResponse } from '../../crew/api';
import type { BoardDuty, DutyBoardResponse } from '../../duties/api';
import type { VehicleHealth } from './vehicleHealth';

/**
 * Departure readiness: each of the depot's duties checked for its bus, its crew and its
 * bus's maintenance, against the feed clock. The duty plan and the crew roster are the
 * Duties and Crew pages' own; the bus's state and position are the feed's. A check whose
 * input is missing reads "unverified", never "ready".
 */

export type Readiness = 'ready' | 'at_risk' | 'blocked' | 'unverified' | 'departed' | 'completed';

export const READINESS_LABEL: Readonly<Record<Readiness, string>> = {
  ready: 'Ready',
  at_risk: 'At risk',
  blocked: 'Blocked',
  unverified: 'Unverified',
  departed: 'Departed',
  completed: 'Completed',
};

export type CheckState = 'ok' | 'warn' | 'fail' | 'unknown';

export interface ReadinessCheck {
  readonly key: 'vehicle' | 'position' | 'crew' | 'maintenance' | 'timing';
  readonly label: string;
  readonly state: CheckState;
  readonly detail: string;
}

export interface Departure {
  readonly dutyId: string;
  readonly routeName: string;
  readonly startMin: number;
  readonly endMin: number;
  readonly registration: string | null;
  readonly readiness: Readiness;
  readonly checks: readonly ReadinessCheck[];
  /** Minutes from the feed clock to the start; negative once past. */
  readonly startsInMin: number | null;
}

export interface AlternativeBus {
  readonly registration: string;
  readonly risk: number;
  readonly reason: string;
}

const LATE_GRACE_MIN = 10;
const MINUTES_PER_DAY = 1440;

/** Minutes past midnight on the feed's own clock (its wall-clock string, read as written). */
export function feedMinuteOf(feedNow: string | null): number | null {
  if (!feedNow) return null;
  const match = /T(\d{2}):(\d{2})/.exec(feedNow);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function clockOf(min: number): string {
  const m = ((Math.round(min) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

interface CrewIndex {
  readonly known: boolean;
  readonly covered: ReadonlySet<string>;
  readonly short: ReadonlyMap<string, readonly string[]>;
  readonly complete: boolean;
}

function crewIndex(crew: CrewResponse | null): CrewIndex {
  if (!crew) return { known: false, covered: new Set(), short: new Map(), complete: false };
  const covered = new Set(crew.roster.filter((r) => r.shiftIndex === 0).map((r) => r.dutyId));
  const short = new Map<string, readonly string[]>();
  for (const u of crew.uncovered) {
    if (u.shiftIndex === 0) short.set(u.dutyId, u.shortRoles);
  }
  const complete = crew.rosterTotal <= crew.rosterCap && crew.uncoveredTotal <= crew.uncoveredCap;
  return { known: true, covered, short, complete };
}

function crewCheck(duty: BoardDuty, index: CrewIndex): ReadinessCheck {
  if (!index.known) return { key: 'crew', label: 'Crew', state: 'unknown', detail: 'Crew roster not loaded' };
  const short = index.short.get(duty.id);
  if (short && short.length > 0) {
    const driver = short.includes('driver');
    return {
      key: 'crew',
      label: 'Crew',
      state: driver ? 'fail' : 'warn',
      detail: `No ${short.join(' or ')} slot free for the first shift`,
    };
  }
  if (index.covered.has(duty.id)) return { key: 'crew', label: 'Crew', state: 'ok', detail: 'Driver and conductor slots rostered' };
  return {
    key: 'crew',
    label: 'Crew',
    state: 'unknown',
    detail: index.complete ? 'Not in the roster' : 'Beyond the roster shown; confirm on the Crew page',
  };
}

function vehicleChecks(duty: BoardDuty, bus: DepotBusView | null, health: VehicleHealth | null): ReadinessCheck[] {
  if (duty.registrationNumber === null || duty.state === 'no_bus') {
    return [{ key: 'vehicle', label: 'Bus', state: 'fail', detail: 'No eligible bus left for this duty' }];
  }
  const checks: ReadinessCheck[] = [{ key: 'vehicle', label: 'Bus', state: 'ok', detail: duty.registrationNumber }];
  if (duty.state === 'bus_not_in_yard') {
    checks.push({ key: 'position', label: 'Position', state: 'warn', detail: 'Assigned bus is away from the yard' });
  } else if (!bus) {
    checks.push({ key: 'position', label: 'Position', state: 'unknown', detail: 'Bus not in the latest snapshot' });
  } else if (bus.state === 'dark') {
    checks.push({ key: 'position', label: 'Position', state: 'unknown', detail: 'No GPS signal' });
  } else if (bus.state === 'off_road') {
    checks.push({ key: 'position', label: 'Position', state: 'fail', detail: 'Flagged off the road' });
  } else {
    checks.push({
      key: 'position',
      label: 'Position',
      state: 'ok',
      detail: bus.location === 'in_yard' ? 'In the yard' : bus.state === 'in_service' || bus.state === 'on_road' ? 'Out working' : 'Standing',
    });
  }
  if (!health) {
    checks.push({ key: 'maintenance', label: 'Maintenance', state: 'unknown', detail: 'No service record' });
  } else if (health.band === 'high') {
    checks.push({ key: 'maintenance', label: 'Maintenance', state: 'warn', detail: `High breakdown risk (${health.risk})` });
  } else if (health.service.group === 'overdue') {
    checks.push({ key: 'maintenance', label: 'Maintenance', state: 'warn', detail: `Service overdue by ${Math.round(-health.service.kmToNextService)} km` });
  } else {
    checks.push({ key: 'maintenance', label: 'Maintenance', state: 'ok', detail: `Risk ${health.risk}` });
  }
  return checks;
}

function verdict(checks: readonly ReadinessCheck[]): Readiness {
  if (checks.some((c) => c.state === 'fail')) return 'blocked';
  if (checks.some((c) => c.state === 'warn')) return 'at_risk';
  if (checks.some((c) => c.state === 'unknown')) return 'unverified';
  return 'ready';
}

export interface ReadinessBoard {
  readonly nowMin: number | null;
  readonly departures: readonly Departure[];
  readonly counts: Readonly<Record<Readiness, number>>;
}

export function buildReadiness(
  duties: DutyBoardResponse,
  crew: CrewResponse | null,
  buses: readonly DepotBusView[],
  healthByReg: ReadonlyMap<string, VehicleHealth>,
  nowMin: number | null,
): ReadinessBoard {
  const byReg = new Map(buses.map((b) => [b.registrationNumber, b]));
  const index = crewIndex(crew);
  const departures = duties.duties.map((duty): Departure => {
    const bus = duty.registrationNumber ? (byReg.get(duty.registrationNumber) ?? null) : null;
    const startsInMin = nowMin === null ? null : duty.startMin - nowMin;
    const outWorking = bus !== null && (bus.state === 'in_service' || bus.state === 'on_road');
    if (nowMin !== null && duty.endMin <= nowMin && duty.registrationNumber) {
      return { dutyId: duty.id, routeName: duty.routeName, startMin: duty.startMin, endMin: duty.endMin, registration: duty.registrationNumber, readiness: 'completed', checks: [], startsInMin };
    }
    if (nowMin !== null && duty.startMin <= nowMin && outWorking) {
      return { dutyId: duty.id, routeName: duty.routeName, startMin: duty.startMin, endMin: duty.endMin, registration: duty.registrationNumber, readiness: 'departed', checks: [{ key: 'timing', label: 'Timing', state: 'ok', detail: 'Out on the road' }], startsInMin };
    }
    const checks = [...vehicleChecks(duty, bus, duty.registrationNumber ? (healthByReg.get(duty.registrationNumber) ?? null) : null), crewCheck(duty, index)];
    if (nowMin !== null && duty.startMin + LATE_GRACE_MIN < nowMin) {
      checks.push({ key: 'timing', label: 'Timing', state: 'warn', detail: `Due out at ${clockOf(duty.startMin)}; not seen leaving` });
    }
    return {
      dutyId: duty.id,
      routeName: duty.routeName,
      startMin: duty.startMin,
      endMin: duty.endMin,
      registration: duty.registrationNumber,
      readiness: verdict(checks),
      checks,
      startsInMin,
    };
  });
  const counts: Record<Readiness, number> = { ready: 0, at_risk: 0, blocked: 0, unverified: 0, departed: 0, completed: 0 };
  for (const d of departures) counts[d.readiness] += 1;
  return { nowMin, departures, counts };
}

/** Spare buses fit to take a duty: standing in the yard, not overdue, lowest risk first. */
export function fitSpares(
  duties: DutyBoardResponse,
  buses: readonly DepotBusView[],
  healthByReg: ReadonlyMap<string, VehicleHealth>,
): AlternativeBus[] {
  const byReg = new Map(buses.map((b) => [b.registrationNumber, b]));
  return duties.spareBuses
    .map((reg) => ({ reg, bus: byReg.get(reg), health: healthByReg.get(reg) }))
    .filter(({ bus, health }) => bus && bus.state === 'standing' && (!health || (health.band !== 'high' && health.service.group !== 'overdue')))
    .map(({ reg, bus, health }) => ({
      registration: reg,
      risk: health?.risk ?? 0,
      reason: `${bus?.location === 'in_yard' ? 'In the yard' : 'Standing'}${health ? `, risk ${health.risk}, next service in ${Math.max(0, Math.round(health.service.kmToNextService)).toLocaleString('en-IN')} km` : ''}`,
    }))
    .sort((a, b) => a.risk - b.risk || a.registration.localeCompare(b.registration));
}

export interface ReallocationPlan {
  readonly swaps: readonly { readonly dutyId: string; readonly from: string | null; readonly to: string; readonly why: string }[];
  readonly before: Readonly<Record<Readiness, number>>;
  readonly after: Readonly<Record<Readiness, number>>;
}

/**
 * A proposed reallocation: fit spare buses go, in start order, to the upcoming departures
 * whose bus check fails or warns. Crew problems are not solved by a bus and stay as they
 * are; the after-counts say so.
 */
export function proposeReallocation(board: ReadinessBoard, spares: readonly AlternativeBus[]): ReallocationPlan {
  const pool = [...spares];
  const swaps: ReallocationPlan['swaps'][number][] = [];
  const after: Record<Readiness, number> = { ...board.counts };
  const upcoming = [...board.departures]
    .filter((d) => d.readiness === 'blocked' || d.readiness === 'at_risk')
    .sort((a, b) => a.startMin - b.startMin);
  for (const d of upcoming) {
    const busProblem = d.checks.find((c) => (c.key === 'vehicle' || c.key === 'position' || c.key === 'maintenance') && (c.state === 'fail' || c.state === 'warn'));
    if (!busProblem) continue;
    const next = pool.shift();
    if (!next) break;
    swaps.push({ dutyId: d.dutyId, from: d.registration, to: next.registration, why: busProblem.detail });
    const remaining = d.checks.filter((c) => c !== busProblem && !(c.key === 'position' || c.key === 'maintenance' || c.key === 'vehicle'));
    const newState = verdict(remaining);
    after[d.readiness] -= 1;
    after[newState] += 1;
  }
  return { swaps, before: board.counts, after };
}
