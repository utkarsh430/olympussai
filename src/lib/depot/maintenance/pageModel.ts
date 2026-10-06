import { formatCount } from '../format';
import type { Provenance } from '../types';
import type { OffRoadBus } from './api';
import type { ServiceGroup } from './serviceModel';
import type { Coverage } from '../types';
import {
  distanceNotice,
  groupSummary,
  preventiveNote,
  statusWordLabel,
  workshopBaysNote,
} from './text';
import type { WorkshopLoad } from './workshop';

/*
 * What the maintenance page lays out, decided here so it is tested: the
 * three-figure band, the statement of what every off-road row shares, the
 * time a bus was last heard, and the lines of the closing disclosure.
 */

export interface BandFigure {
  readonly key: 'off_road' | 'overdue' | 'due_soon';
  readonly label: string;
  readonly value: string;
  readonly caption: string;
  /** Present only when the figure differs from the page's live default. */
  readonly tag?: Provenance;
}

export interface PreventiveCounts {
  readonly counts: Readonly<Record<ServiceGroup, number>>;
  readonly dueSoonWithinKm: number;
}

const fleetOf = (counts: Readonly<Record<ServiceGroup, number>>): number =>
  counts.overdue + counts.due_soon + counts.not_due;

/** The live figure is always there; the modelled two follow once the model has answered. */
export function bandFigures(
  offRoadCount: number,
  preventive: PreventiveCounts | null,
): readonly BandFigure[] {
  const offRoad: BandFigure = {
    key: 'off_road',
    label: 'Off the road now',
    value: formatCount(offRoadCount),
    caption: 'reported by the feed',
  };
  if (preventive === null) return [offRoad];
  const fleet = `of ${formatCount(fleetOf(preventive.counts))} buses`;
  return [
    offRoad,
    {
      key: 'overdue',
      label: 'Overdue',
      value: formatCount(preventive.counts.overdue),
      caption: fleet,
      tag: 'modelled',
    },
    {
      key: 'due_soon',
      label: 'Due soon',
      value: formatCount(preventive.counts.due_soon),
      caption: `within ${formatCount(preventive.dueSoonWithinKm)} km`,
      tag: 'modelled',
    },
  ];
}

export interface OffRoadShared {
  /** What every row has in common, said once above the table; null when nothing is shared. */
  readonly statement: string | null;
  readonly showTripStatus: boolean;
  readonly showFlags: boolean;
}

const sameAll = (values: readonly (string | null)[]): boolean =>
  values.every((value) => value === values[0]);

/**
 * A column that says the same on every row is removed and stated once. The feed
 * status is constant by construction (off the road means "under maintenance");
 * the trip status and the flags are tested rather than assumed.
 */
export function sharedOffRoad(buses: readonly OffRoadBus[]): OffRoadShared {
  if (buses.length === 0) return { statement: null, showTripStatus: true, showFlags: true };
  const statuses = buses.map((bus) => bus.vehicleStatus);
  const statusShared = sameAll(statuses);
  const trips = buses.map((bus) => bus.tripStatus);
  const tripShared = sameAll(trips);
  const noFlags = buses.every((bus) => bus.flags.length === 0);
  const parts: string[] = [];
  if (statusShared) parts.push(`feed status ${statusWordLabel(statuses[0] ?? 'unknown')}`);
  if (tripShared) parts.push(`trip status ${trips[0] ?? 'unknown'}`);
  const lead = parts.length > 0 ? `Every bus here has ${parts.join(' and ')}.` : '';
  const flags = noFlags ? 'None reports a device flag.' : '';
  const statement = [lead, flags].filter((part) => part !== '').join(' ');
  return {
    statement: statement === '' ? null : statement,
    showTripStatus: !tripShared,
    showFlags: !noFlags,
  };
}

const MS_PER_MIN = 60_000;

/**
 * When a bus was last heard, as a feed timestamp for the shared time formatters:
 * the feed's clock less the minutes of silence. Null when either is unknown.
 */
export function lastHeardIso(feedNow: string | null, gpsAgeMin: number | null): string | null {
  if (feedNow === null || gpsAgeMin === null || !Number.isFinite(gpsAgeMin)) return null;
  const at = Date.parse(feedNow);
  if (Number.isNaN(at)) return null;
  return new Date(at - gpsAgeMin * MS_PER_MIN).toISOString();
}

export interface WorkshopRow {
  readonly label: string;
  readonly value: string;
  readonly tag?: Provenance;
}

/** The workshop block's rows; the off-road row is the live count, the same as the band's. */
export function workshopRows(load: WorkshopLoad): readonly WorkshopRow[] {
  return [
    { label: 'Bays', value: formatCount(load.bays), tag: 'modelled' },
    { label: 'Off the road', value: formatCount(load.offRoad) },
    { label: 'Would wait for a bay', value: formatCount(load.queue), tag: 'modelled' },
  ];
}

export interface DisclosureItem {
  readonly heading: string;
  /** Sentences, word for word where they are a truthfulness statement. */
  readonly lines: readonly string[];
}

/**
 * The closing disclosure, "How these figures are produced": what the page's
 * explanation used to carry in front of the table now lives here, unchanged.
 */
export function disclosureItems(
  preventive: PreventiveCounts & { readonly intervals: readonly string[] },
  coverage: Coverage,
): readonly DisclosureItem[] {
  return [
    {
      heading: 'Off the road now',
      lines: [
        'The list is live: buses the feed reports under maintenance. Nothing here is written back to any system.',
      ],
    },
    {
      heading: 'Preventive status',
      lines: [
        groupSummary(preventive.counts),
        preventiveNote(preventive.dueSoonWithinKm),
        ...preventive.intervals,
      ],
    },
    { heading: 'Workshop bays', lines: [workshopBaysNote()] },
    { heading: "The feed's distance field", lines: [distanceNotice(coverage)] },
  ];
}
