import { formatCount, formatPlainDate } from '../format';
import { noDutiesReason } from '../sim/operatingDayWording';
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

/** Under the roster: slot numbers must not read as a ranking or a workload. */
export const SLOT_NOTE =
  'Slot numbers only reflect the order in which the roster picked them and say nothing about a person.';

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

/**
 * How each availability word is drawn, so the segments differ by texture and not only
 * by tone (dataviz: a secondary encoding where colours sit close). Available is the
 * solid accent; weekly off a solid grey; leave 45 degree hatching; training dots;
 * absent vertical stripes. The words and counts on the legend line say the same.
 */
export type SegmentPattern = 'solid' | 'grey' | 'diagonal' | 'dots' | 'vertical';

export const AVAILABILITY_PATTERN: Readonly<Record<CrewAvailability, SegmentPattern>> = {
  available: 'solid',
  weekly_off: 'grey',
  leave: 'diagonal',
  training: 'dots',
  absent: 'vertical',
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

/** A role bar's one mono label: "Drivers · 234 slots" (shown in capitals). */
export function roleBarLabel(title: string, slots: number): string {
  return `${title} · ${formatCount(slots)} ${slots === 1 ? 'slot' : 'slots'}`;
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

/**
 * The modelled day, in words, for a sentence that stands on the page: dated when the
 * response gave its operating date. The day is a model rebuilt from the live fleet, so
 * no sentence on this page says "today".
 */
export function modelledDayPhrase(operatingDate?: string): string {
  return operatingDate === undefined
    ? 'in the modelled day'
    : `in the modelled day for ${formatPlainDate(operatingDate)}`;
}

/*
 * A line repeated on every row of a table says "in the modelled day" without the date:
 * the date is said once, in the provenance line above the page's first figure.
 */
const CAUSE_TEXT: Readonly<Record<ShortfallCause, (role: CrewRole) => string>> = {
  no_slot_available: (role) => `no ${role} is available ${modelledDayPhrase()}.`,
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

/** A modelled duty's id: depot, the day's YYYY-MM-DD, then the duty's number. */
const DATED_DUTY_ID = /^.+-\d{4}-\d{2}-\d{2}-(\d+)$/;

/**
 * A shift's name: "Duty 009" for a modelled duty (its id carries the day's raw date, which
 * never reaches the screen, a title or a label; the page says the day once), any other id
 * as it is, then "shift 2 of 3" when the duty has more than one.
 */
export function shiftLabel(shift: {
  readonly dutyId: string;
  readonly shiftIndex: number;
  readonly shiftCount: number;
}): string {
  const dated = DATED_DUTY_ID.exec(shift.dutyId);
  const name = dated ? `Duty ${dated[1]}` : shift.dutyId;
  if (shift.shiftCount <= 1) return name;
  return `${name}, shift ${shift.shiftIndex + 1} of ${shift.shiftCount}`;
}

export function shiftsSentence(
  required: number,
  covered: number,
  uncovered: number,
  operatingDate?: string,
): string {
  return (
    `${countOf(required, 'shift is', 'shifts are')} required ${modelledDayPhrase(operatingDate)}; ` +
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

/** Crew C: the one sentence of the state panel; the remedy line and link are separate. */
export function emptyCrewSentence(operatingDate?: string): string {
  const date = operatingDate === undefined ? undefined : formatPlainDate(operatingDate);
  return `${noDutiesReason(date)}, so there are no crew shifts to cover.`;
}

/** What would change the empty state, as the panel's one muted line. */
export const EMPTY_CREW_REMEDY =
  'Crew shifts appear once the feed shows a route running from this depot; the data sources page says which feeds the day is built from.';

export function rosterCountSentence(shown: number, total: number): string {
  if (shown >= total) return `${countOf(total, 'covered shift', 'covered shifts')}.`;
  return `Showing the first ${formatCount(shown)} of ${countOf(total, 'covered shift', 'covered shifts')}.`;
}

export function uncoveredCountSentence(shown: number, total: number): string {
  if (shown >= total) return `${countOf(total, 'uncovered shift', 'uncovered shifts')}.`;
  return `Showing the first ${formatCount(shown)} of ${countOf(total, 'uncovered shift', 'uncovered shifts')}, most pressing first.`;
}

/** Visible in one line whenever a shortfall is shown: it stops a model outcome reading as a finding. */
export const SHORTFALL_EXPLANATION =
  'A shortfall here is an outcome of the model: a drawn mix of weekly off, leave, training and ' +
  'absence, and shifts that start together. It is not a finding about this depot.';

const CAUSE_COUNT_TEXT: Readonly<Record<ShortfallCause, string>> = {
  no_slot_available: 'none available',
  all_rostered: 'all already rostered at the time',
  hours_limit: 'hours limit',
};

const CAUSE_ORDER: readonly ShortfallCause[] = ['no_slot_available', 'all_rostered', 'hours_limit'];

/** Per role, how many uncovered shifts are short for each cause, from the rows given. */
export function shortfallCounts(
  rows: readonly { readonly shortfalls: readonly RoleShortfall[] }[],
): Readonly<Record<CrewRole, Readonly<Record<ShortfallCause, number>>>> {
  const blank = (): Record<ShortfallCause, number> => ({
    no_slot_available: 0,
    all_rostered: 0,
    hours_limit: 0,
  });
  const out: Record<CrewRole, Record<ShortfallCause, number>> = {
    driver: blank(),
    conductor: blank(),
  };
  for (const row of rows) {
    for (const { role, cause } of row.shortfalls) out[role][cause] += 1;
  }
  return out;
}

export interface CoverageInput {
  readonly shiftsRequired: number;
  readonly shiftsCovered: number;
  readonly shiftsUncovered: number;
  readonly dutiesNeedingRelief: number;
}

/**
 * The one coverage line of the hero. Covered in full: "160 of 160 shifts covered; no
 * relief needed". Otherwise the shortfall with each role's reasons counted (from the
 * listed rows; when the list is capped it says so).
 */
export function coverageLine(
  summary: CoverageInput,
  uncovered: readonly { readonly shortfalls: readonly RoleShortfall[] }[],
): string {
  const head = `${formatCount(summary.shiftsCovered)} of ${formatCount(summary.shiftsRequired)} shifts covered`;
  if (summary.shiftsUncovered === 0) {
    return summary.dutiesNeedingRelief === 0
      ? `${head}; no relief needed.`
      : `${head}; ${countOf(summary.dutiesNeedingRelief, 'duty needs', 'duties need')} a relief crew.`;
  }
  const counts = shortfallCounts(uncovered);
  const roles = (['driver', 'conductor'] as const).flatMap((role) => {
    const parts = CAUSE_ORDER.filter((cause) => counts[role][cause] > 0).map(
      (cause) => `${formatCount(counts[role][cause])} ${CAUSE_COUNT_TEXT[cause]}`,
    );
    return parts.length === 0 ? [] : [`${role}s: ${parts.join(', ')}`];
  });
  const listed = uncovered.length < summary.shiftsUncovered ? ' (counted over the shifts listed)' : '';
  const reasons = roles.length === 0 ? '' : `; ${roles.join('; ')}${listed}`;
  return `${head}; ${formatCount(summary.shiftsUncovered)} uncovered${reasons}.`;
}

/** The status line shown instead of an empty table. */
export const NO_UNCOVERED_SENTENCE = 'Every shift has a driver and a conductor on the modelled crew.';

export function modelledStatement(limits: {
  readonly dailyHours: number;
  readonly weeklyHours: number;
}): string {
  return (
    'No crew feed exists yet, so everything on this page is MODELLED: crew strength as a ratio ' +
    'of the day’s shifts, the mix of weekly off, leave, training and absence, and hours ' +
    `in the modelled week. A slot is limited to ${limits.dailyHours} hours a day and ` +
    `${limits.weeklyHours} hours a week. A crew roster and leave feed from the depot will ` +
    `replace the model. ${SHORTFALL_EXPLANATION}`
  );
}

export interface Page<T> {
  readonly page: number;
  readonly pageCount: number;
  readonly rows: readonly T[];
}

export interface CrewDisclosureSection {
  readonly heading: string;
  readonly lines: readonly string[];
}

/**
 * The closing disclosure, "How these figures are produced": the figures' definitions,
 * the modelled statement with the limits used, and the shortfall explanation. What the
 * page used to say in six tiles, three sentences and an "About this page" panel.
 */
export function crewDisclosure(
  summary: {
    readonly shiftsRequired: number;
    readonly shiftsCovered: number;
    readonly shiftsUncovered: number;
    readonly driver: { readonly required: number; readonly available: number };
    readonly conductor: { readonly required: number; readonly available: number };
    readonly dutiesFullyCovered: number;
    readonly dutiesPartlyCovered: number;
    readonly dutiesUncovered: number;
    readonly dutiesNeedingRelief: number;
  },
  limits: { readonly dailyHours: number; readonly weeklyHours: number },
  operatingDate?: string,
): readonly CrewDisclosureSection[] {
  return [
    {
      heading: 'Cover in the modelled day',
      lines: [
        shiftsSentence(
          summary.shiftsRequired,
          summary.shiftsCovered,
          summary.shiftsUncovered,
          operatingDate,
        ),
        `${strengthSentence('driver', summary.driver)} ${strengthSentence('conductor', summary.conductor)}`,
        `${dutiesSentence(summary.dutiesFullyCovered, summary.dutiesPartlyCovered, summary.dutiesUncovered)} ${reliefSentence(summary.dutiesNeedingRelief)}`,
      ],
    },
    {
      heading: 'What is modelled',
      lines: [modelledStatement(limits), 'Nothing here is written back to any system.'],
    },
  ];
}
