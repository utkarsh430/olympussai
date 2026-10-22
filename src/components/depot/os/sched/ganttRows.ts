import { clockOf } from '@/lib/depot/os/intel/readiness';
import { RESTRICTION_LABEL } from '@/lib/depot/os/sched/vehicles';
import type { BusPlan, CrewRoster, Trip, UncoveredTrip } from '@/lib/depot/os/sched/types';
import type { ServiceClass } from '@/lib/depot/sim/types';
import type { GanttBar, GanttRow, GanttTone } from '../gantt/Gantt';

/*
 * Plans and rosters as Gantt rows: one row per bus (its departures as bars), per crew
 * slot (its shifts), with the uncovered work packed into lanes on top. Bars carry links
 * to what they belong to, so selecting a bus lights its crew shifts and the reverse.
 */

export const CLASS_TONE: Readonly<Record<ServiceClass, GanttTone>> = { ordinary: 'cyan', express: 'teal', ac: 'violet', premium: 'violet' };
export const CLASS_WORD: Readonly<Record<ServiceClass, string>> = { ordinary: 'Ordinary', express: 'Express', ac: 'AC', premium: 'Premium' };

const span = (t: Pick<Trip, 'dep' | 'arr'>): string => `${clockOf(t.dep % 1440)}–${clockOf(t.arr % 1440)}`;

function tripBar(trip: Trip, registration: string | null, tone: GanttTone, hatched = false): GanttBar {
  return {
    id: trip.id,
    start: trip.dep,
    end: trip.arr,
    tone,
    hatched,
    label: trip.routeId.split('-').slice(1).join('-'),
    title: `${trip.routeId} · ${span(trip)} · ${trip.passengers} passengers${registration ? ` · ${registration}` : ''}`,
    links: registration ? [registration] : [],
  };
}

/** Packs bars into the fewest lanes where none overlap. */
function lanesOf<T extends { readonly start: number; readonly end: number }>(items: readonly T[]): T[][] {
  const lanes: T[][] = [];
  for (const item of [...items].sort((a, b) => a.start - b.start)) {
    const lane = lanes.find((l) => l[l.length - 1]!.end <= item.start);
    if (lane) lane.push(item);
    else lanes.push([item]);
  }
  return lanes;
}

export function uncoveredRows(uncovered: readonly UncoveredTrip[], label = 'Uncovered'): GanttRow[] {
  const bars = uncovered.map((u) => ({ ...tripBar(u.trip, null, 'crimson', true), title: `${u.trip.routeId} · ${span(u.trip)} · ${u.trip.passengers} passengers · not covered` }));
  return lanesOf(bars).map((lane, i) => ({ id: `uncovered-${i}`, label: i === 0 ? label : '', sub: i === 0 ? `${uncovered.length} departures` : undefined, flag: 'crimson', bars: lane }));
}

export function busRows(plan: BusPlan): GanttRow[] {
  const blocks = [...plan.blocks].sort((a, b) => a.start - b.start || a.registration.localeCompare(b.registration));
  return [
    ...uncoveredRows(plan.uncovered),
    ...blocks.map((b) => ({
      id: b.registration,
      label: b.registration,
      sub: b.unavailable ? RESTRICTION_LABEL[b.unavailable] : `${CLASS_WORD[b.serviceClass]} · ${b.trips.length}`,
      flag: b.unavailable ? ('crimson' as const) : undefined,
      bars: b.trips.map((t) => tripBar(t, b.registration, b.unavailable ? 'crimson' : CLASS_TONE[t.serviceClass], b.unavailable !== null)),
    })),
  ];
}

/** Crew rows by slot for one role, or by shift (`duties`) with both slots named. */
export function crewRows(roster: CrewRoster, view: 'driver' | 'conductor' | 'duties'): GanttRow[] {
  const uncovered = roster.assignments.filter((a) => !a.driver || !a.conductor);
  const unassigned = lanesOf(
    uncovered.map((a) => ({
      id: a.shift.id,
      start: a.shift.start,
      end: a.shift.end,
      tone: 'crimson' as const,
      hatched: true,
      label: a.shift.registration,
      title: `${a.shift.registration} · ${clockOf(a.shift.start % 1440)}–${clockOf(a.shift.end % 1440)} · no crew`,
      links: [a.shift.registration],
    })),
  ).map((lane, i) => ({ id: `unassigned-${i}`, label: i === 0 ? 'Unassigned' : '', sub: i === 0 ? `${uncovered.length} shifts` : undefined, flag: 'crimson' as const, bars: lane }));
  const barOf = (a: (typeof roster.assignments)[number], who: string): GanttBar => {
    const issue = a.issues.length > 0;
    return {
      id: a.shift.id,
      start: a.shift.start,
      end: a.shift.end,
      tone: issue ? 'crimson' : a.overtimeMin > 0 ? 'amber' : a.shift.needsAc ? 'violet' : 'teal',
      label: who,
      title: `${a.shift.registration} · ${clockOf(a.shift.start % 1440)}–${clockOf(a.shift.end % 1440)} · ${a.driver ?? '—'} / ${a.conductor ?? '—'}${a.overtimeMin > 0 ? ` · ${Math.round(a.overtimeMin)} min overtime` : ''}${issue ? ` · ${a.issues.map((x) => x.text).join(' ')}` : ''}`,
      links: [a.shift.registration],
    };
  };
  if (view === 'duties') {
    return [
      ...unassigned,
      ...roster.assignments
        .filter((a) => a.driver && a.conductor)
        .map((a) => ({ id: `duty-${a.shift.id}`, label: a.shift.registration, sub: `${a.driver} · ${a.conductor}`, flag: a.issues.length > 0 ? ('crimson' as const) : undefined, bars: [barOf(a, `${a.driver} ${a.conductor}`)] })),
    ];
  }
  const bySlot = new Map<string, (typeof roster.assignments)[number][]>();
  for (const a of roster.assignments) {
    const slot = view === 'driver' ? a.driver : a.conductor;
    if (slot) bySlot.set(slot, [...(bySlot.get(slot) ?? []), a]);
  }
  return [
    ...unassigned,
    ...[...bySlot]
      .sort((a, b) => a[1][0]!.shift.start - b[1][0]!.shift.start || a[0].localeCompare(b[0]))
      .map(([slot, list]) => ({
        id: slot,
        label: slot,
        sub: `${(roster.hoursBySlot[slot] ?? 0).toFixed(1)} h`,
        flag: list.some((a) => a.issues.length > 0) ? ('crimson' as const) : list.some((a) => a.overtimeMin > 0) ? ('amber' as const) : undefined,
        bars: list.map((a) => barOf(a, a.shift.registration)),
      })),
  ];
}
