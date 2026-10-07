import type { ProvenanceDescription } from '../provenanceLine';
import { countPhrase, formatCount, formatFeedTimeOn, formatPlainDate, pluralWord } from '../format';
import type { Coverage } from '../types';
import type { RouteHourlyBody } from './types';

/*
 * What the route's day rests on, each fact said once where it belongs: one short MIXED
 * sentence under the header; what this server observed in the chart section's note; the
 * scheduled coverage on the Scheduled legend entry; the route-name share and the standing
 * buses in the closing disclosure. Nothing above the chart is a paragraph.
 */

type Observed = Pick<RouteHourlyBody, 'observed' | 'operatingDate'> & {
  readonly feedNow: string | null;
};

/** The page's MIXED line. With nothing observed it names no observed hours, so it never contradicts the chart. */
export function routeHourlyProvenance(body: Pick<RouteHourlyBody, 'observed'> | null): ProvenanceDescription {
  if (body !== null && body.observed === null) {
    return {
      default: 'mixed',
      live: 'Buses now',
      derived: 'scheduled trips',
      modelled: 'deployment by hour, demand, need and proposals',
    };
  }
  return {
    default: 'mixed',
    live: 'Buses now',
    derived: 'observed hours and scheduled trips',
    modelled: 'other hours, demand, need and proposals',
  };
}

/** What this server has observed of the day, in words. */
function observationWords(body: Observed): string {
  if (body.observed === null) return 'Not yet observed by this server today';
  const since = formatFeedTimeOn(body.observed.since, body.feedNow);
  return `Observed by this server since ${since} (${formatCount(body.observed.samples)} samples)`;
}

/** The chart section's note: the operating day and what this server observed of it. */
export function chartNote(body: Observed): string {
  return `Operating day ${formatPlainDate(body.operatingDate)} · ${observationWords(body)}`;
}

/** The Scheduled legend entry, carrying the buses whose whole day is loaded. */
export function scheduledLegendText(coverage: Coverage): string {
  return `Scheduled (full day loaded for ${formatCount(coverage.n)} of ${countPhrase(coverage.of, 'bus', 'buses')})`;
}

/** Said when the schedule server had no timetable for the date and an earlier one stands in. */
export function borrowedTimetableSentence(
  body: Pick<RouteHourlyBody, 'timetableBorrowedFrom' | 'operatingDate'>,
): string | null {
  const from = body.timetableBorrowedFrom;
  if (from.length === 0) return null;
  const dates = from.map(formatPlainDate).join(' and ');
  const word = from.length === 1 ? 'Timetable' : 'Timetables';
  return `${word} of ${dates} used for ${formatPlainDate(body.operatingDate)}.`;
}

/** The route's standing buses, said once: they carry its name but are not deployed. */
function standingSentence(standing: number): readonly string[] {
  if (standing <= 0) return [];
  return standing === 1
    ? ['1 standing now carries this route’s name; it is not counted as deployed.']
    : [`${formatCount(standing)} standing now carry this route’s name; they are not counted as deployed.`];
}

/** The closing disclosure's coverage sentences: who can be counted on a route at all. */
export function coverageSentences(
  body: Pick<RouteHourlyBody, 'routeCoverage' | 'standingNow'>,
): readonly string[] {
  const { n, of } = body.routeCoverage;
  return [
    `Only buses that report a route name are counted: ${formatCount(n)} of the ${countPhrase(of, 'bus', 'buses')} in the feed ${pluralWord(n, 'reports', 'report')} one.`,
    ...standingSentence(body.standingNow),
  ];
}
