import { formatCount } from '@/lib/depot/format';
import { datedFeedTime } from './rosterCells';
import { busLocationText } from '@/lib/depot/infer/locationText';
import { BUS_STATE_LABEL } from '@/lib/depot/labels';
import type { RosterRow } from './rosterModel';

/**
 * The bus drawer's facts. The roster page declares its default once (DERIVED, from
 * the live feed), so no fact carries a tag: every one is either live or derived from
 * it. Location comes from the same function as the roster row; times are formatted.
 */

export interface DrawerFact {
  readonly label: string;
  readonly value: string;
}

const DASH = '—';

export function drawerFacts(row: RosterRow): readonly DrawerFact[] {
  const { bus } = row;
  return [
    { label: 'State', value: BUS_STATE_LABEL[bus.state] },
    { label: 'Location', value: busLocationText(bus) },
    { label: 'Route', value: bus.routeName ?? DASH },
    { label: 'Scheduled start', value: datedFeedTime(bus.scheduledStart) },
    { label: 'Scheduled end', value: datedFeedTime(bus.scheduledEnd) },
    ...(row.delay ? [{ label: 'Running', value: row.delay }] : []),
    { label: 'Trip status', value: bus.tripStatus ?? DASH },
    {
      label: 'Speed',
      value: bus.speedKmph === null ? DASH : `${formatCount(Math.round(bus.speedKmph))} km/h`,
    },
    { label: 'Last heard', value: row.lastHeard },
    { label: 'Device flags', value: row.flags.length === 0 ? 'None raised' : row.flags.join('; ') },
  ];
}
