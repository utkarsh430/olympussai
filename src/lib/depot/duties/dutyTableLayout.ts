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
