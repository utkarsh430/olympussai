import type { DepotDetailResponse } from '@/lib/depot/api';
import { depotHref } from '@/lib/depot/depotNav';
import { formatCount } from '@/lib/depot/format';
import { DARK_AFTER_MIN } from '@/lib/depot/infer/thresholds';
import { DEPOTS_ROOT } from '@/lib/depot/nav';
import { hasTamperCode, notHeardText } from '@/lib/depot/roster/rosterModel';
import { rosterFilterHref } from '@/lib/depot/roster/rosterQuery';

/**
 * The cockpit's hero: what needs attention now, as a few counted lines, most
 * pressing first, each a link to the list that holds those buses.
 */

export const ATTENTION_MAX_LINES = 6;
const MINUTES_PER_HOUR = 60;
/** The reporting window the server's `notHeardMin` flag is measured against. */
const NOT_HEARD_AFTER_MIN = 30;

export interface AttentionLine {
  readonly key: string;
  readonly count: number;
  readonly text: string;
  readonly href: string;
  /** Where the link lands, shown muted at the line's end so the line reads as a link. */
  readonly destination: string;
}

export interface Attention {
  readonly lines: readonly AttentionLine[];
  /** One calm sentence when no line has a count; null otherwise. */
  readonly calm: string | null;
}

export const CALM_SENTENCE =
  'Nothing needs attention on this snapshot: no bus is dark, off the road, without main power or unheard, and no departure is overdue.';

function buses(n: number): string {
  return `${formatCount(n)} ${n === 1 ? 'bus' : 'buses'}`;
}

function verb(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export function buildAttention(detail: DepotDetailResponse, depotId: string): Attention {
  const all = detail.buses;
  const count = (test: (bus: (typeof all)[number]) => boolean): number => all.filter(test).length;
  const emergency = new Set(
    detail.exceptions.bus.filter((e) => e.kind === 'emergency').map((e) => e.registrationNumber),
  ).size;
  const powerOff = count((b) => b.mainPowerOn === false);
  const overdue = detail.outshed.rows.filter((r) => r.state === 'overdue').length;
  const dark = count((b) => b.state === 'dark');
  const offRoad = count((b) => b.state === 'off_road');
  const notHeard = count((b) => notHeardText(b) !== null);
  const tamper = count(hasTamperCode);

  const candidates: AttentionLine[] = [
    {
      key: 'emergency',
      count: emergency,
      text: `${buses(emergency)} ${verb(emergency, 'raises', 'raise')} the emergency flag`,
      // The exception centre owns the emergency list; narrowed to this depot.
      href: `${DEPOTS_ROOT}/exceptions?kind=emergency&depot=${encodeURIComponent(depotId)}`,
      destination: 'Exceptions',
    },
    {
      key: 'power_off',
      count: powerOff,
      text: `${buses(powerOff)} ${verb(powerOff, 'reports', 'report')} main power off`,
      href: rosterFilterHref(depotId, { flag: 'power_off' }),
      destination: 'Roster',
    },
    {
      key: 'overdue',
      count: overdue,
      text: `${formatCount(overdue)} ${verb(overdue, 'departure is', 'departures are')} overdue`,
      href: `${depotHref(depotId)}#depot-outshed`,
      destination: 'Departures',
    },
    {
      key: 'dark',
      count: dark,
      text: `${buses(dark)} ${verb(dark, 'is', 'are')} dark: no signal for ${DARK_AFTER_MIN / MINUTES_PER_HOUR} h or more`,
      href: rosterFilterHref(depotId, { states: ['dark'] }),
      destination: 'Roster',
    },
    {
      key: 'off_road',
      count: offRoad,
      text: `${buses(offRoad)} ${verb(offRoad, 'is', 'are')} off the road`,
      href: rosterFilterHref(depotId, { states: ['off_road'] }),
      destination: 'Roster',
    },
    {
      key: 'not_heard',
      count: notHeard,
      text: `${buses(notHeard)} ${verb(notHeard, 'has', 'have')} not been heard for over ${NOT_HEARD_AFTER_MIN} min`,
      href: rosterFilterHref(depotId, { flag: 'not_heard' }),
      destination: 'Roster',
    },
    {
      key: 'tamper',
      count: tamper,
      text: `${buses(tamper)} ${verb(tamper, 'reports', 'report')} a tamper code`,
      href: rosterFilterHref(depotId, { flag: 'tamper' }),
      destination: 'Roster',
    },
  ];
  const lines = candidates.filter((line) => line.count > 0).slice(0, ATTENTION_MAX_LINES);
  return { lines, calm: lines.length === 0 ? CALM_SENTENCE : null };
}
