import { barGeometry, type BarGeometry } from '../duties/dutyBoardModel';
import { formatCount, formatMinute, formatOneDecimal } from '../format';
import type { DepotMeaning } from '../palette';
import { compareText } from '../stats/order';
import { MINUTES_PER_HOUR } from '../units';
import { coveredAt, type FigureRun } from './figures';
import { HOLD_REASON_TEXT, UNCOVERED_REASON_TEXT } from './scheduleWording';
import type { SchedulePlan } from './types';

/*
 * The depot page's rows and figures, read off the plan. Pure, so a test can
 * pin them without a browser.
 */

export interface ScheduleFigure {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly caption: string;
  readonly tone: DepotMeaning;
  readonly lead?: boolean;
}

const freedWord = (n: number, what: string): string =>
  n > 0 ? `${formatCount(n)} ${what} freed` : n < 0 ? `${formatCount(-n)} more ${what}` : `same ${what} as today`;

export function scheduleFigures(plan: SchedulePlan): ScheduleFigure[] {
  const { figures, baseline, comparison, crew } = plan;
  const slots = (role: 'driver' | 'conductor'): string =>
    `${formatCount(figures.crewSlots[role])} of ${formatCount(crew.available[role])} available`;
  return [
    { key: 'buses', label: 'Buses scheduled', value: formatCount(figures.buses), caption: `of ${formatCount(baseline.figures.buses)} today · ${freedWord(comparison.busesFreed, 'buses')}`, tone: 'plan', lead: true },
    { key: 'drivers', label: 'Driver slots', value: formatCount(figures.crewSlots.driver), caption: slots('driver'), tone: 'count' },
    { key: 'conductors', label: 'Conductor slots', value: formatCount(figures.crewSlots.conductor), caption: slots('conductor'), tone: 'count' },
    { key: 'hours', label: 'Crew hours', value: formatOneDecimal(figures.crewHours.driver), caption: `vs ${formatOneDecimal(baseline.figures.crewHours.driver)} today`, tone: 'count' },
    { key: 'uncovered', label: 'Uncovered bus-hours', value: formatCount(figures.uncoveredBusHours), caption: figures.uncoveredBusHours === 0 ? 'every hour of need covered' : `${formatCount(plan.uncovered.length)} route-hours short`, tone: figures.uncoveredBusHours === 0 ? 'better' : 'critical' },
  ];
}

export interface CoverageCell {
  readonly hour: number;
  readonly needed: number;
  readonly scheduled: number;
  readonly short: boolean;
}

export interface CoverageRow {
  readonly routeName: string;
  readonly cells: readonly CoverageCell[];
  readonly shortHours: number;
}

function runsOf(plan: SchedulePlan): FigureRun[] {
  const busOf = new Map(plan.assignment.assignments.map((a) => [a.blockId, a.registrationNumber] as const));
  return plan.blocks.flatMap((block) =>
    block.pieces.map((p) => ({ routeName: p.routeName, startMin: p.startMin, endMin: p.endMin, hasBus: (busOf.get(block.id) ?? null) !== null })),
  );
}

export function coverageRows(plan: SchedulePlan): CoverageRow[] {
  const runs = runsOf(plan);
  return plan.routes.map((route) => {
    const cells = route.hours.map((h) => {
      const scheduled = coveredAt(runs, route.routeName, h.hour);
      return { hour: h.hour, needed: h.needed, scheduled, short: scheduled < h.needed };
    });
    return { routeName: route.routeName, cells, shortHours: cells.filter((c) => c.short).length };
  });
}

/** A route's colour index: routes in name order take the palette in turn. */
export function routeColourIndex(plan: SchedulePlan): ReadonlyMap<string, number> {
  const names = [...new Set(plan.blocks.flatMap((b) => b.routeNames))].sort(compareText);
  return new Map(names.map((name, i) => [name, i] as const));
}

export interface BlockLeg {
  readonly routeName: string;
  readonly startMin: number;
  readonly endMin: number;
  readonly geometry: BarGeometry;
  readonly colour: number;
}

export interface BlockRow {
  readonly id: string;
  readonly registrationNumber: string | null;
  readonly legs: readonly BlockLeg[];
  readonly spanText: string;
  readonly legsText: string;
  readonly hoursText: string;
  readonly statusText: string;
  readonly ariaLabel: string;
}

export function blockRows(plan: SchedulePlan): BlockRow[] {
  const colours = routeColourIndex(plan);
  const byBlock = new Map(plan.assignment.assignments.map((a) => [a.blockId, a] as const));
  return plan.blocks.map((block) => {
    const assignment = byBlock.get(block.id);
    const legs = block.pieces.map((p) => ({
      routeName: p.routeName,
      startMin: p.startMin,
      endMin: p.endMin,
      geometry: barGeometry(p.startMin, p.endMin),
      colour: colours.get(p.routeName) ?? 0,
    }));
    const legsText = legs.map((l) => `${l.routeName} ${formatMinute(l.startMin)}–${formatMinute(l.endMin)}`).join(', ');
    const registrationNumber = assignment?.registrationNumber ?? null;
    const statusText = registrationNumber === null ? 'No bus free for it' : assignment?.reason === 'locked' ? 'Locked to its route' : 'Assigned';
    return {
      id: block.id,
      registrationNumber,
      legs,
      spanText: `${formatMinute(block.startMin)}–${formatMinute(block.endMin)}`,
      legsText,
      hoursText: formatOneDecimal(block.workMinutes / MINUTES_PER_HOUR),
      statusText,
      ariaLabel: `${registrationNumber ?? 'No bus'}: ${legsText}`,
    };
  });
}

export interface ShiftRow {
  readonly id: string;
  readonly bus: string;
  readonly route: string;
  readonly startText: string;
  readonly endText: string;
  readonly driverSlot: string;
  readonly conductorSlot: string;
  readonly statusText: string;
  readonly covered: boolean;
}

const CAUSE_TEXT = {
  no_slot_available: 'no slot available today',
  all_rostered: 'every slot already rostered',
  hours_limit: 'the hours limit',
} as const;

export function shiftRows(plan: SchedulePlan): ShiftRow[] {
  const busOf = new Map(plan.assignment.assignments.map((a) => [a.blockId, a.registrationNumber] as const));
  const routeOf = new Map(plan.blocks.map((b) => [b.id, b.mainRouteName] as const));
  return plan.crew.shifts.map((s) => ({
    id: s.id,
    bus: busOf.get(s.blockId) ?? '',
    route: routeOf.get(s.blockId) ?? '',
    startText: formatMinute(s.startMin),
    endText: formatMinute(s.endMin),
    driverSlot: s.driverSlot ?? '—',
    conductorSlot: s.conductorSlot ?? '—',
    statusText: s.shortfalls.length === 0 ? 'Covered' : `Short: ${s.shortfalls.map((f) => `${f.role} — ${CAUSE_TEXT[f.cause]}`).join('; ')}`,
    covered: s.shortfalls.length === 0,
  }));
}

export interface UncoveredRow {
  readonly key: string;
  readonly routeName: string;
  readonly hoursText: string;
  readonly buses: number;
  readonly reasonText: string;
}

/** Uncovered hours grouped into runs per route and reason, most buses first. */
export function uncoveredRows(plan: SchedulePlan): UncoveredRow[] {
  const sorted = [...plan.uncovered].sort((a, b) => compareText(a.routeName, b.routeName) || a.hour - b.hour);
  const rows: { routeName: string; from: number; to: number; buses: number; reason: string }[] = [];
  for (const u of sorted) {
    const last = rows[rows.length - 1];
    if (last && last.routeName === u.routeName && last.reason === u.reason && last.to === u.hour - 1 && last.buses === u.buses) rows[rows.length - 1] = { ...last, to: u.hour };
    else rows.push({ routeName: u.routeName, from: u.hour, to: u.hour, buses: u.buses, reason: u.reason });
  }
  return rows
    .map((r) => ({
      key: `${r.routeName}|${r.from}|${r.reason}`,
      routeName: r.routeName,
      hoursText: `${formatMinute(r.from * MINUTES_PER_HOUR)}–${formatMinute((r.to + 1) * MINUTES_PER_HOUR)}`,
      buses: r.buses,
      reasonText: UNCOVERED_REASON_TEXT[r.reason as keyof typeof UNCOVERED_REASON_TEXT],
    }))
    .sort((a, b) => b.buses - a.buses || compareText(a.routeName, b.routeName));
}

/** The buses held out, with the reason in words, for the page's note. */
export function heldOutSentence(plan: SchedulePlan): string | null {
  const held = plan.assignment.excluded;
  if (held.length === 0) return null;
  const byReason = new Map<string, number>();
  for (const h of held) byReason.set(HOLD_REASON_TEXT[h.reason], (byReason.get(HOLD_REASON_TEXT[h.reason]) ?? 0) + 1);
  const parts = [...byReason].map(([text, n]) => `${formatCount(n)} ${text}`);
  return `${formatCount(held.length)} ${held.length === 1 ? 'bus' : 'buses'} held out: ${parts.join(', ')}.`;
}
