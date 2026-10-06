/**
 * The roster's column set and widths, in px. Every column is visible at 1440 without
 * sideways scroll: with RUNNING the widths sum to 1168 against the 1190px of content the
 * frame has inside its borders at that width (1440 less the 200px rail and the 24px
 * gutters); without RUNNING 1048. At a phone the table keeps three short columns (358px
 * of content at 390).
 */

export type RosterColumnKey =
  | 'registration'
  | 'state'
  | 'location'
  | 'route'
  | 'start'
  | 'running'
  | 'heard'
  | 'flags';

export const ROSTER_COLUMN_ORDER: readonly RosterColumnKey[] = [
  'registration',
  'state',
  'location',
  'route',
  'start',
  'running',
  'heard',
  'flags',
];

export const ROSTER_COLUMN_WIDTHS: Readonly<Record<RosterColumnKey, number>> = {
  registration: 120,
  state: 116,
  location: 196,
  route: 152,
  start: 160,
  running: 120,
  heard: 184,
  flags: 120,
};

/** At a phone: the state is the square alone, so its column is only as wide as a mark. */
export const ROSTER_PHONE_COLUMNS: readonly RosterColumnKey[] = ['registration', 'state', 'location'];
const ROSTER_PHONE_WIDTHS: Readonly<Partial<Record<RosterColumnKey, number>>> = {
  registration: 128,
  state: 48,
  location: 120,
};

export interface RosterColumnChoice {
  readonly phone: boolean;
  /** False when every visible row has no running value: the column is a constant dash. */
  readonly running: boolean;
}

export function rosterColumnKeys({ phone, running }: RosterColumnChoice): readonly RosterColumnKey[] {
  if (phone) return ROSTER_PHONE_COLUMNS;
  return ROSTER_COLUMN_ORDER.filter((key) => key !== 'running' || running);
}

export function rosterColumnWidth(key: RosterColumnKey, phone: boolean): number {
  return (phone ? ROSTER_PHONE_WIDTHS[key] : undefined) ?? ROSTER_COLUMN_WIDTHS[key];
}

export function rosterWidthSum(choice: RosterColumnChoice): number {
  return rosterColumnKeys(choice).reduce(
    (sum, key) => sum + rosterColumnWidth(key, choice.phone),
    0,
  );
}
