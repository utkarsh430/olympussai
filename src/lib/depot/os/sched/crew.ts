import { SeededRandom } from '../../../simulation/seededRandom';
import type { CrewRole } from '../../crew/types';
import { modelCrew } from '../../sim/crew';
import { STATIC_SEED_DATE } from '../../sim/config';
import { seedFor } from '../../sim/seed';
import type { DepotSummary } from '../../types';
import { AC_ENDORSED_SHARE, CREW_RELEASE_GAP_MIN } from './config';
import type { BusBlock, Conflict, CrewAssignment, CrewMetrics, CrewParams, CrewRoster, CrewShift, CrewSlotView, Trip } from './types';

/*
 * Crew rostering. A bus's day becomes crew shifts: a gap long enough releases the crew
 * (a split duty), and a stretch longer than the daily limit is relieved at a terminal
 * between trips. Every shift needs one driver and one conductor; slots are anonymous
 * (D-014), drawn from the depot's crew model, and nothing here judges a person. The
 * optimiser respects availability, the AC endorsement, the daily limit with any allowed
 * overtime, and the break between a slot's shifts; the baseline takes the first free
 * slot in roster order and checks the rules afterwards.
 */

const ROLES: readonly CrewRole[] = ['driver', 'conductor'];
const ABSENCE_LABEL = { weekly_off: 'Weekly off', leave: 'Leave', training: 'Training', absent: 'Absent' } as const;
const ROLE_WORD: Readonly<Record<CrewRole, string>> = { driver: 'driver', conductor: 'conductor' };

/** A bus block's crew shifts. */
export function shiftsOf(blocks: readonly BusBlock[], params: Pick<CrewParams, 'maxDutyHours'>): CrewShift[] {
  const limit = params.maxDutyHours * 60;
  const shifts: CrewShift[] = [];
  for (const block of blocks) {
    if (block.unavailable !== null) continue;
    let group: Trip[] = [];
    const close = (): void => {
      if (group.length === 0) return;
      const index = shifts.filter((s) => s.registration === block.registration).length;
      shifts.push({
        id: `${block.registration}#${index + 1}`,
        registration: block.registration,
        start: group[0]!.dep,
        end: group[group.length - 1]!.arr,
        trips: group.map((t) => t.id),
        needsAc: group.some((t) => t.serviceClass === 'ac' || t.serviceClass === 'premium'),
      });
      group = [];
    };
    for (const trip of block.trips) {
      const prev = group[group.length - 1];
      if (prev && (trip.dep - prev.arr >= CREW_RELEASE_GAP_MIN || trip.arr - group[0]!.dep > limit)) close();
      group.push(trip);
    }
    close();
  }
  return shifts.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}

/**
 * The depot's crew for the day from the shared crew model (the same slots and absences
 * the Crew Availability page shows for that workload), with the AC endorsement each
 * driver slot holds and any extra slots a person marks unavailable.
 */
export function crewPool(depot: DepotSummary, shiftCount: number, operatingDate: string, extra: Readonly<Record<CrewRole, number>>): CrewSlotView[] {
  const slots = modelCrew(depot, Math.max(0, Math.round(shiftCount)), operatingDate);
  const views: CrewSlotView[] = slots.map((slot) => {
    const rng = new SeededRandom(seedFor(depot.id, STATIC_SEED_DATE, `crew-endorsement:${slot.id}`));
    return {
      id: slot.id,
      role: slot.role,
      available: slot.availability === 'available',
      absence: slot.availability === 'available' ? null : ABSENCE_LABEL[slot.availability],
      acEndorsed: slot.role === 'driver' && rng.float(0, 1) < AC_ENDORSED_SHARE,
    };
  });
  // Extra unavailability is taken from the highest-numbered available slots of the role.
  const out = [...views];
  for (const role of ROLES) {
    let left = extra[role] ?? 0;
    for (let i = out.length - 1; i >= 0 && left > 0; i -= 1) {
      const v = out[i]!;
      if (v.role !== role || !v.available) continue;
      out[i] = { ...v, available: false, absence: 'Marked unavailable' };
      left -= 1;
    }
  }
  return out;
}

interface SlotState {
  readonly slot: CrewSlotView;
  minutes: number;
  lastEnd: number | null;
}

function chooseSlot(states: readonly SlotState[], shift: CrewShift, role: CrewRole, params: CrewParams): SlotState | null {
  const len = shift.end - shift.start;
  const limit = params.maxDutyHours * 60;
  const allowance = params.objective === 'min_overtime' ? 0 : params.overtimeHours * 60;
  const candidates = states.filter(
    (st) =>
      st.slot.role === role &&
      st.slot.available &&
      (role !== 'driver' || !shift.needsAc || !params.requireAcEndorsement || st.slot.acEndorsed) &&
      (st.lastEnd === null || st.lastEnd + params.minBreakMin <= shift.start) &&
      st.minutes + len <= limit + Math.max(allowance, st.minutes === 0 ? Math.max(0, len - limit) : 0),
  );
  if (candidates.length === 0) return null;
  const rank = (st: SlotState): number[] => {
    const overtime = Math.max(0, st.minutes + len - limit);
    // Keep endorsed drivers for the AC shifts that need them.
    const spendsEndorsement = role === 'driver' && !shift.needsAc && st.slot.acEndorsed ? 1 : 0;
    const packing = params.objective === 'min_crew' ? -st.minutes : st.minutes;
    return [overtime, spendsEndorsement, packing];
  };
  return [...candidates].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i += 1) if (ra[i] !== rb[i]) return ra[i]! - rb[i]!;
    return a.slot.id.localeCompare(b.slot.id);
  })[0]!;
}

function metricsOf(assignments: readonly CrewAssignment[], slots: readonly CrewSlotView[], minutes: ReadonlyMap<string, number>, params: CrewParams): CrewMetrics {
  const used = { driver: 0, conductor: 0 };
  const available = { driver: 0, conductor: 0 };
  for (const s of slots) if (s.available) available[s.role] += 1;
  const roleOf = new Map(slots.map((s) => [s.id, s.role]));
  const worked: number[] = [];
  for (const [id, m] of minutes) {
    if (m <= 0) continue;
    used[roleOf.get(id) ?? 'driver'] += 1;
    worked.push(m / 60);
  }
  const limit = params.maxDutyHours * 60;
  const overtime = [...minutes.values()].reduce((s, m) => s + Math.max(0, m - limit), 0) / 60;
  const issues = assignments.flatMap((a) => a.issues);
  const covered = assignments.filter((a) => a.driver && a.conductor).length;
  const hours = worked.reduce((s, h) => s + h, 0);
  return {
    shifts: assignments.length,
    covered,
    uncovered: assignments.length - covered,
    overtimeHours: overtime,
    restViolations: issues.filter((i) => i.kind === 'rest').length,
    qualificationViolations: issues.filter((i) => i.kind === 'qualification').length,
    hoursViolations: issues.filter((i) => i.kind === 'hours').length,
    used,
    available,
    reserve: { driver: Math.max(0, available.driver - used.driver), conductor: Math.max(0, available.conductor - used.conductor) },
    utilisation: worked.length > 0 ? hours / (worked.length * params.maxDutyHours) : 0,
    workloadSpread: worked.length > 0 ? Math.max(...worked) - Math.min(...worked) : 0,
    crewHours: hours,
  };
}

/** The optimised roster: every rule respected; a shift with no crew for a role stays uncovered. */
export function rosterCrew(shifts: readonly CrewShift[], slots: readonly CrewSlotView[], params: CrewParams): CrewRoster {
  const states: SlotState[] = slots.map((slot) => ({ slot, minutes: 0, lastEnd: null }));
  const assignments: CrewAssignment[] = [];
  for (const shift of shifts) {
    const picked = ROLES.map((role) => chooseSlot(states, shift, role, params));
    const [driver, conductor] = picked;
    if (!driver || !conductor) {
      const issues: Conflict[] = ROLES.flatMap((role, i) =>
        picked[i] ? [] : [{ kind: 'no_crew' as const, subject: shift.id, text: `No ${ROLE_WORD[role]} free within the rules for ${shift.registration}'s shift.` }],
      );
      assignments.push({ shift, driver: null, conductor: null, overtimeMin: 0, issues });
      continue;
    }
    const len = shift.end - shift.start;
    for (const st of [driver, conductor]) {
      st.minutes += len;
      st.lastEnd = shift.end;
    }
    const overtimeMin = Math.max(0, Math.max(driver.minutes, conductor.minutes) - params.maxDutyHours * 60);
    assignments.push({ shift, driver: driver.slot.id, conductor: conductor.slot.id, overtimeMin, issues: [] });
  }
  const minutes = new Map(states.map((s) => [s.slot.id, s.minutes]));
  return { kind: 'optimised', assignments, slots, hoursBySlot: Object.fromEntries([...minutes].map(([k, m]) => [k, m / 60])), metrics: metricsOf(assignments, slots, minutes, params) };
}

/**
 * The baseline roster: each shift takes the first free slot of each role in roster
 * order, within the daily limit, without regard to the break or the AC endorsement; the
 * rules are then checked and every breach listed.
 */
export function sequentialRoster(shifts: readonly CrewShift[], slots: readonly CrewSlotView[], params: CrewParams): CrewRoster {
  const states: SlotState[] = slots.map((slot) => ({ slot, minutes: 0, lastEnd: null }));
  const limit = (params.maxDutyHours + params.overtimeHours) * 60;
  const assignments: CrewAssignment[] = [];
  for (const shift of shifts) {
    const len = shift.end - shift.start;
    const picked = ROLES.map((role) =>
      states.find((st) => st.slot.role === role && st.slot.available && (st.lastEnd === null || st.lastEnd <= shift.start) && (st.minutes + len <= limit || st.minutes === 0)) ?? null,
    );
    const [driver, conductor] = picked;
    if (!driver || !conductor) {
      assignments.push({ shift, driver: null, conductor: null, overtimeMin: 0, issues: [{ kind: 'no_crew', subject: shift.id, text: `No free crew in roster order for ${shift.registration}'s shift.` }] });
      continue;
    }
    const issues: Conflict[] = [];
    for (const st of [driver, conductor]) {
      if (st.lastEnd !== null && shift.start - st.lastEnd < params.minBreakMin) {
        issues.push({ kind: 'rest', subject: st.slot.id, text: `${st.slot.id} gets ${shift.start - st.lastEnd} minutes between shifts; the rule is ${params.minBreakMin}.` });
      }
      st.minutes += len;
      st.lastEnd = shift.end;
    }
    if (shift.needsAc && params.requireAcEndorsement && !driver.slot.acEndorsed) {
      issues.push({ kind: 'qualification', subject: driver.slot.id, text: `${driver.slot.id} has no AC endorsement for ${shift.registration}'s AC service.` });
    }
    const overtimeMin = Math.max(0, Math.max(driver.minutes, conductor.minutes) - params.maxDutyHours * 60);
    if (overtimeMin > params.overtimeHours * 60) {
      issues.push({ kind: 'hours', subject: driver.slot.id, text: `${shift.registration}'s crew passes the daily limit and the overtime allowance.` });
    }
    assignments.push({ shift, driver: driver.slot.id, conductor: conductor.slot.id, overtimeMin, issues });
  }
  const minutes = new Map(states.map((s) => [s.slot.id, s.minutes]));
  return { kind: 'baseline', assignments, slots, hoursBySlot: Object.fromEntries([...minutes].map(([k, m]) => [k, m / 60])), metrics: metricsOf(assignments, slots, minutes, params) };
}
