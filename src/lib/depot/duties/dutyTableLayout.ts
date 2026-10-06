/*
 * The duty table's columns per width, and their widths, so no column is cut at 1440,
 * 1280 or 1024 and each narrower width shows a deliberate set. What a set drops
 * is in the row expander ("Show this duty in full": route, time, class, state, how the bus
 * stands) or the cell's title. Widths in px; the shared expander column before the first
 * is 24 px.
 *
 * The table's cells never wrap, so a column is as wide as its longest value whatever width
 * it is given: a width here is at least the room its longest typical value needs.
 */

export type DutyColumnKey = 'route' | 'class' | 'start' | 'end' | 'state' | 'bus' | 'now';

export type DutyTableTier = 'wide' | 'medium' | 'phone';

export const DUTY_COLUMN_WIDTH_PX: Readonly<Record<DutyColumnKey, number>> = {
  // A 16-character route name: 16 glyphs of 13 px mono (7.8 px each) and 12 px a side.
  route: 152,
  class: 180,
  start: 64,
  end: 112,
  state: 104,
  bus: 112,
  now: 156,
};

/** The longest value a column typically holds, which its width must give room to. */
export const DUTY_LONGEST_TEXT: Readonly<Partial<Record<DutyColumnKey, string>>> = {
  route: 'KSB_1284_ORD_OUT',
  start: '23:45',
  end: '05:40 next day',
  state: 'Unmatched',
  bus: 'UP78FN5435',
  now: 'Standing, no yard established',
};

const COLUMNS_BY_TIER: Readonly<Record<DutyTableTier, readonly DutyColumnKey[]>> = {
  // 1024 and up: every column.
  wide: ['route', 'class', 'start', 'end', 'state', 'bus', 'now'],
  // 640 to 1023: class, end and how the bus stands go to the expander (its TIME line gives
  // both ends). How the bus stands runs to 29 characters ("Standing, no yard established",
  // 250 px), which with the other four cannot fit the 590 px frame at 640.
  medium: ['route', 'start', 'state', 'bus'],
  // Under 640: the route, when it starts and its bus ("—" when unmatched; the state, the
  // end and how the bus stands are in the expander).
  phone: ['route', 'start', 'bus'],
};

export function dutyTableTier(belowDesktop: boolean, phone: boolean): DutyTableTier {
  if (phone) return 'phone';
  return belowDesktop ? 'medium' : 'wide';
}

export function dutyColumnKeys(tier: DutyTableTier): readonly DutyColumnKey[] {
  return COLUMNS_BY_TIER[tier];
}

/* The table asks for its widths by tier; every tier draws at the shared widths. */
const WIDTHS_BY_TIER: Readonly<Record<DutyTableTier, Readonly<Record<DutyColumnKey, number>>>> = {
  wide: DUTY_COLUMN_WIDTH_PX,
  medium: DUTY_COLUMN_WIDTH_PX,
  phone: DUTY_COLUMN_WIDTH_PX,
};

/** The column widths a tier draws at. */
export function dutyColumnWidths(tier: DutyTableTier): Readonly<Record<DutyColumnKey, number>> {
  return WIDTHS_BY_TIER[tier];
}
