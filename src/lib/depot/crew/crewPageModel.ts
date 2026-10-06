import { formatCount } from '../format';
import type { AvailabilityCounts } from './api';
import type { CrewAvailability, CrewRole, RoleShortfall, ShortfallCause } from './types';

/*
 * Every sentence, grouping and page slice the crew page shows is built here,
 * so the wording is asserted in tests and components only place it. Nothing
 * here describes a person: crew are anonymous slots, and no per-slot figure
 * exists to word.
 */

/** Shown where it cannot be missed, in this exact form. */
export const PEOPLE_SENTENCE = 'Availability and rostering only. No individual is assessed.';

export const ROSTER_NOTE =
  'The roster is a simple first-fit suggestion, not an optimised one: earliest shift first, lowest slot number first. Nothing is assigned or instructed.';

export const SOURCES_HREF = '/project/depots/sources';

export const AVAILABILITY_ORDER: readonly CrewAvailability[] = [
  'available',
  'weekly_off',
  'leave',
  'training',
  'absent',
];

const AVAILABILITY_LABEL: Readonly<Record<CrewAvailability, string>> = {
  available: 'Available',
  weekly_off: 'Weekly off',
  leave: 'On leave',
  training: 'In training',
  absent: 'Absent',
};

/** The same words in running text. */
const AVAILABILITY_PHRASE: Readonly<Record<CrewAvailability, string>> = {
  available: 'available',
  weekly_off: 'weekly off',
  leave: 'on leave',
  training: 'in training',
  absent: 'absent',
};

const PERCENT = 100;

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);
const countOf = (n: number, one: string, many: string): string =>
  `${formatCount(n)} ${plural(n, one, many)}`;

export interface AvailabilitySegment {
  readonly key: CrewAvailability;
  readonly label: string;
  readonly count: number;
  /** Share of the role's slots, 0 to 100; 0 for every segment of an empty role. */
  readonly widthPct: number;
}

export function totalSlots(counts: AvailabilityCounts): number {
  return AVAILABILITY_ORDER.reduce((sum, key) => sum + counts[key], 0);
}

export function availabilitySegments(counts: AvailabilityCounts): readonly AvailabilitySegment[] {
  const total = totalSlots(counts);
  return AVAILABILITY_ORDER.map((key) => ({
    key,
    label: AVAILABILITY_LABEL[key],
    count: counts[key],
    widthPct: total === 0 ? 0 : (counts[key] * PERCENT) / total,
  }));
}

const ROLE_PLURAL: Readonly<Record<CrewRole, string>> = {
  driver: 'Drivers',
  conductor: 'Conductors',
};

/** The text equivalent of one role's bar. */
export function availabilityText(role: CrewRole, counts: AvailabilityCounts): string {
  const total = totalSlots(counts);
  const parts = AVAILABILITY_ORDER.map(
    (key) => `${formatCount(counts[key])} ${AVAILABILITY_PHRASE[key]}`,
  );
  return `${ROLE_PLURAL[role]}, ${countOf(total, 'slot', 'slots')}: ${parts.join(', ')}.`;
}

const CAUSE_TEXT: Readonly<Record<ShortfallCause, (role: CrewRole) => string>> = {
  no_slot_available: (role) => `no ${role} is available today.`,
  all_rostered: (role) => `all available ${role}s are already rostered at this time.`,
  hours_limit: () => 'would exceed the hours limit.',
};

const capitalise = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/** Why a shift is uncovered: each short role on its own, never "driver or conductor". */
export function shortfallText(shortfalls: readonly RoleShortfall[]): string {
  return shortfalls
    .map(({ role, cause }) => `${capitalise(role)}: ${CAUSE_TEXT[cause](role)}`)
    .join(' ');
}

export function shiftLabel(shift: {
  readonly dutyId: string;
  readonly shiftIndex: number;
  readonly shiftCount: number;
}): string {
  if (shift.shiftCount <= 1) return shift.dutyId;
  return `${shift.dutyId}, shift ${shift.shiftIndex + 1} of ${shift.shiftCount}`;
}

export function shiftsSentence(required: number, covered: number, uncovered: number): string {
  return (
    `${countOf(required, 'shift is', 'shifts are')} required today; ` +
    `${formatCount(covered)} ${plural(covered, 'is', 'are')} covered and ` +
    `${formatCount(uncovered)} ${plural(uncovered, 'is', 'are')} uncovered (MODELLED).`
  );
}

export function strengthSentence(
  role: CrewRole,
  figures: { readonly required: number; readonly available: number },
): string {
  const verb = figures.available === 1 ? 'is' : 'are';
  return (
    `${countOf(figures.available, role, `${role}s`)} ${verb} available across the day for ` +
    `${countOf(figures.required, 'shift', 'shifts')}, some of which overlap.`
  );
}

export function dutiesSentence(full: number, partly: number, none: number): string {
  return (
    `${countOf(full, 'duty', 'duties')} fully covered, ` +
    `${formatCount(partly)} partly covered, ${formatCount(none)} uncovered.`
  );
}

export function reliefSentence(count: number): string {
  if (count === 0) return 'No duty needs a relief crew.';
  return `${countOf(count, 'duty needs', 'duties need')} a relief crew.`;
}

export function emptyCrewSentence(): string {
  return 'No duties are modelled for this depot today (no route is seen running from it), so there are no crew shifts to cover.';
}

export function rosterCountSentence(shown: number, total: number): string {
  if (shown >= total) return `${countOf(total, 'covered shift', 'covered shifts')}.`;
  return `Showing the first ${formatCount(shown)} of ${countOf(total, 'covered shift', 'covered shifts')}.`;
}

export function modelledStatement(limits: {
  readonly dailyHours: number;
  readonly weeklyHours: number;
}): string {
  return (
    'No crew feed exists yet, so everything on this page is MODELLED: crew strength as a ratio ' +
    'of the day’s shifts, the mix of weekly off, leave, training and absence, and hours ' +
    `worked this week. A slot is limited to ${limits.dailyHours} hours a day and ` +
    `${limits.weeklyHours} hours a week. A crew roster and leave feed from the depot will ` +
    'replace the model. A shortfall here is an outcome of the model: a drawn mix of weekly ' +
    'off, leave, training and absence, and shifts that start together. It is not a finding ' +
    'about this depot.'
  );
}

export interface Page<T> {
  readonly page: number;
  readonly pageCount: number;
  readonly rows: readonly T[];
}

/** One page of rows; an out-of-range page is clamped, never empty by accident. */
export function pageOf<T>(rows: readonly T[], page: number, size: number): Page<T> {
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  const clamped = Math.min(Math.max(0, page), pageCount - 1);
  return { page: clamped, pageCount, rows: rows.slice(clamped * size, (clamped + 1) * size) };
}
