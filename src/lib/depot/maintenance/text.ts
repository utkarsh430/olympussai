import type { DepotVehicleStatus } from '@/models/depotLive';
import { formatCount } from '../format';
import { lastHeardText } from '../roster/rosterModel';
import type { ServiceClass } from '../sim/types';
import type { Coverage } from '../types';
import type { ServiceGroup } from './serviceModel';
import type { WorkshopLoad } from './workshop';

/*
 * Every sentence the maintenance page shows is built here, so the wording is
 * asserted in tests and the components only place it. Modelled figures are
 * always named as modelled in the sentence that carries them.
 */

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

export function offRoadHeadline(count: number): string {
  return count === 1
    ? '1 bus is off the road now.'
    : `${formatCount(count)} buses are off the road now.`;
}

export function offRoadEmptyText(): string {
  return 'The live feed reports no bus under maintenance at this depot.';
}

const STATUS_WORD: Readonly<Record<DepotVehicleStatus, string>> = {
  live: 'Live',
  stationary: 'Stationary',
  no_signal: 'No signal',
  under_maintenance: 'Under maintenance',
  unknown: 'Unknown',
};

/** The feed's own status word, spelled for reading. */
export function statusWordLabel(status: DepotVehicleStatus): string {
  return STATUS_WORD[status];
}

/** How long since the bus last reported, as the roster words it. */
export function silenceText(gpsAgeMin: number | null): string {
  return lastHeardText(gpsAgeMin);
}

/**
 * Why the preventive view does not use the feed's distance field. No unit is
 * named for it: until the calibration evidence is judged, it is not kilometres.
 */
export function distanceNotice(coverage: Coverage): string {
  return (
    "The feed's distance field is not used on this page because its unit is unconfirmed, " +
    `and only ${formatCount(coverage.n)} of ${formatCount(coverage.of)} buses at this depot carry it.`
  );
}

const GROUP_LABEL: Readonly<Record<ServiceGroup, string>> = {
  overdue: 'Overdue',
  due_soon: 'Due soon',
  not_due: 'Not due',
};

export function serviceGroupLabel(group: ServiceGroup): string {
  return GROUP_LABEL[group];
}

export function kmToNextText(kmToNextService: number): string {
  if (kmToNextService < 0) return `Overdue by ${formatCount(-kmToNextService)} km`;
  if (kmToNextService === 0) return 'Due now';
  return `${formatCount(kmToNextService)} km to next service`;
}

export function groupSummary(counts: Readonly<Record<ServiceGroup, number>>): string {
  const total = counts.overdue + counts.due_soon + counts.not_due;
  if (total === 0) return 'The depot has no buses.';
  return (
    `Of ${formatCount(total)} buses: ${formatCount(counts.overdue)} overdue, ` +
    `${formatCount(counts.due_soon)} due soon, ${formatCount(counts.not_due)} not due.`
  );
}

export function noAttentionText(): string {
  return 'No bus is overdue or due soon on the modelled service history.';
}

export function preventiveNote(dueSoonWithinKm: number): string {
  return (
    'Each bus has a modelled odometer and service history, anchored on its modelled age, with a ' +
    `service interval set per class. Due soon means within ${formatCount(dueSoonWithinKm)} km of ` +
    'the next service. These are proposals for planning, not workshop records.'
  );
}

const CLASS_NAME: Readonly<Record<ServiceClass, string>> = {
  ordinary: 'Ordinary',
  express: 'Express',
  ac: 'AC',
  premium: 'Premium',
};

export function serviceClassLabel(serviceClass: ServiceClass): string {
  return CLASS_NAME[serviceClass];
}

export function intervalText(serviceClass: ServiceClass, intervalKm: number): string {
  return `${CLASS_NAME[serviceClass]}: every ${formatCount(intervalKm)} km`;
}

export function workshopSentence(load: WorkshopLoad): string {
  const { bays, offRoad, queue, freeBays } = load;
  if (bays === 0) {
    return `The depot has no modelled workshop bay, so ${formatCount(offRoad)} ${plural(offRoad, 'bus', 'buses')} off the road would wait.`;
  }
  if (offRoad === 0) {
    return `No bus is off the road, so all ${formatCount(bays)} modelled bays are free.`;
  }
  const buses = `${formatCount(offRoad)} ${plural(offRoad, 'bus', 'buses')} off the road`;
  if (queue === 0) {
    return `${buses} fit in ${formatCount(bays)} modelled bays; ${formatCount(freeBays)} ${plural(freeBays, 'bay is', 'bays are')} free.`;
  }
  return `${buses} against ${formatCount(bays)} modelled bays: ${formatCount(queue)} would wait for a bay.`;
}
