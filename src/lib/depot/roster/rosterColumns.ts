/**
 * The roster's column sets and widths, in px, per width tier. No column is ever cut: each
 * tier's widths sum inside the content frame the shell leaves at that viewport (the rail
 * shows from 1280):
 *
 *   wide    (1440 and up, ~1,158 px inside the frame): every column, 1,048 px.
 *   desk    (1280 to 1439, ~998 px): every column, tighter, 988 px.
 *   medium  (1024 to 1279, ~974 px): SCHEDULED START goes to the drawer, 880 px.
 *   narrow  (640 to 1023, ~590 px): registration, state, short location, last heard, 516 px.
 *   phone   (under 640, ~326 px at 360): registration, state (square and word), short location.
 *
 * RUNNING is never a column: it was a near-constant dash, and the drawer has it.
 */

import { tableRoomAt } from '../shell/geometry';

export type RosterColumnKey =
  | 'registration'
  | 'state'
  | 'location'
  | 'route'
  | 'start'
  | 'heard'
  | 'flags';

export type RosterTier = 'wide' | 'desk' | 'medium' | 'narrow' | 'phone';

/** The viewport width from which each tier applies (the widest first). */
export const ROSTER_TIER_FROM_PX: ReadonlyArray<readonly [RosterTier, number]> = [
  ['wide', 1440],
  ['desk', 1280],
  ['medium', 1024],
  ['narrow', 640],
  ['phone', 0],
];

/** The narrowest viewport each tier is checked at (where it starts; a 360 px phone). */
const TIER_CHECK_VIEWPORT_PX: Readonly<Record<RosterTier, number>> = {
  wide: 1440,
  desk: 1280,
  medium: 1024,
  narrow: 640,
  phone: 360,
};

/** The room inside the table's frame at the narrowest viewport of each tier, from the shell. */
export const ROSTER_TIER_FRAME_PX: Readonly<Record<RosterTier, number>> = {
  wide: tableRoomAt(TIER_CHECK_VIEWPORT_PX.wide),
  desk: tableRoomAt(TIER_CHECK_VIEWPORT_PX.desk),
  medium: tableRoomAt(TIER_CHECK_VIEWPORT_PX.medium),
  narrow: tableRoomAt(TIER_CHECK_VIEWPORT_PX.narrow),
  phone: tableRoomAt(TIER_CHECK_VIEWPORT_PX.phone),
};

type Widths = Readonly<Partial<Record<RosterColumnKey, number>>>;

const WIDE: Widths = {
  registration: 120,
  state: 116,
  location: 196,
  route: 152,
  start: 160,
  heard: 184,
  flags: 120,
};

const DESK: Widths = {
  registration: 112,
  state: 116,
  location: 188,
  route: 128,
  start: 160,
  heard: 172,
  flags: 112,
};

const MEDIUM: Widths = {
  registration: 120,
  state: 116,
  location: 196,
  route: 152,
  heard: 176,
  flags: 120,
};

const NARROW: Widths = {
  registration: 120,
  state: 116,
  location: 104,
  heard: 176,
};

const PHONE: Widths = {
  registration: 112,
  state: 116,
  location: 96,
};

/** Each tier's column widths; a column a tier does not show has none. */
export const ROSTER_TIER_WIDTHS: Readonly<Record<RosterTier, Widths>> = {
  wide: WIDE,
  desk: DESK,
  medium: MEDIUM,
  narrow: NARROW,
  phone: PHONE,
};

const COLUMN_ORDER: readonly RosterColumnKey[] = [
  'registration',
  'state',
  'location',
  'route',
  'start',
  'heard',
  'flags',
];

/** The tier for a viewport width. */
export function rosterTier(viewportPx: number): RosterTier {
  const found = ROSTER_TIER_FROM_PX.find(([, from]) => viewportPx >= from);
  return found ? found[0] : 'phone';
}

/** The columns a tier shows, in reading order. */
export function rosterColumnKeys(tier: RosterTier): readonly RosterColumnKey[] {
  const widths = ROSTER_TIER_WIDTHS[tier];
  return COLUMN_ORDER.filter((key) => widths[key] !== undefined);
}

export function rosterColumnWidth(key: RosterColumnKey, tier: RosterTier): number {
  return ROSTER_TIER_WIDTHS[tier][key] ?? 0;
}

/** LOCATION in its short form ("29 km", "Yard") below 1024. */
export function rosterShortLocation(tier: RosterTier): boolean {
  return tier === 'narrow' || tier === 'phone';
}
