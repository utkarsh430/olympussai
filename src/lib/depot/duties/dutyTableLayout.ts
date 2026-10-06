/*
 * The duty table's columns per width, and their widths, so no column is cut at 1440,
 * 1280 or 1024 and each narrower width shows a deliberate set (round 3). What a set drops
 * is in the row expander ("Show this duty in full": route, time, class, state) or the
 * cell's title. Widths in px; the shared expander column after the first is 36 px.
 */

export type DutyColumnKey = 'route' | 'class' | 'start' | 'end' | 'state' | 'bus' | 'now';

export type DutyTableTier = 'wide' | 'medium' | 'phone';

export const DUTY_COLUMN_WIDTH_PX: Readonly<Record<DutyColumnKey, number>> = {
  route: 136,
  class: 180,
  start: 64,
  end: 112,
  state: 104,
  bus: 112,
  now: 156,
};

/*
 * The middle tier from 640 px, where the shell's gutter is 24 px a side: 640 less both
 * gutters leaves 592, and the table's frame takes 2 of those. State and bus give up the
 * slack beyond their longest typical values ("Unmatched", a ten-character registration),
 * so the five columns and the expander fit in 588.
 */
const MEDIUM_COLUMN_WIDTH_PX: Readonly<Record<DutyColumnKey, number>> = {
  ...DUTY_COLUMN_WIDTH_PX,
  state: 100,
  bus: 108,
};

const COLUMNS_BY_TIER: Readonly<Record<DutyTableTier, readonly DutyColumnKey[]>> = {
  // 1024 and up: every column.
  wide: ['route', 'class', 'start', 'end', 'state', 'bus', 'now'],
  // 640 to 1023: class and end go to the expander (its TIME line gives both ends).
  medium: ['route', 'start', 'state', 'bus', 'now'],
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

/** The column widths a tier draws at: the middle tier's are trimmed, the others shared. */
export function dutyColumnWidths(tier: DutyTableTier): Readonly<Record<DutyColumnKey, number>> {
  return tier === 'medium' ? MEDIUM_COLUMN_WIDTH_PX : DUTY_COLUMN_WIDTH_PX;
}
