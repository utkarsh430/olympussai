import { formatCount } from '../format';
import type { FieldCoverage } from '../types';
import type { FeedEntry } from './registry';

/**
 * The Data Sources page's sentences and coverage ordering.
 *
 * Why records received and buses counted differ: `recordCount` is the length
 * of the feed's record array, and the depot rows come from the same fetch
 * through `normalizeDepotRows`, which (1) rejects an entry that is not an
 * object or carries no registration number and (2) collapses repeat records of
 * one registration to the one with the newest GPS time. The response does not
 * yet say how many records fell under each rule, so the sentence names both.
 */

const SEP = ' · ';
/** What the depot normaliser drops: an entry that is not an object, a blank registration, a repeat. */
const EXCLUSION_REASON =
  'an entry that is not a record at all, a record with no registration number, ' +
  'or a repeat of a registration already received, where the newest GPS time is kept';

/** "9,993 records received · 4 excluded (why) · 9,989 buses counted". */
export function recordsSentence(recordsReceived: number, busesCounted: number): string {
  const counted = `${formatCount(busesCounted)} ${busesCounted === 1 ? 'bus' : 'buses'} counted`;
  // Fewer records than buses cannot come from one fetch: show one snapshot's number only.
  if (recordsReceived < busesCounted) return `${counted} on this snapshot`;
  const received = `${formatCount(recordsReceived)} ${
    recordsReceived === 1 ? 'record' : 'records'
  } received`;
  const excluded = recordsReceived - busesCounted;
  if (excluded === 0) return `${received}${SEP}${counted}: every record is a distinct bus`;
  return `${received}${SEP}${formatCount(excluded)} excluded (${EXCLUSION_REASON})${SEP}${counted}`;
}

export type CoverageWord = 'Complete' | 'Partial' | 'Sparse';

/** At or above this share a field is partial; below it, sparse. */
export const PARTIAL_FROM_SHARE = 0.5;
const PERCENT = 100;

export interface CoverageRow {
  readonly field: string;
  readonly label: string;
  readonly share: number;
  /** Rounded, for display; 99.99% shows as 100 but is never called complete. */
  readonly percent: number;
  readonly word: CoverageWord;
  /** "2,204 of 9,989 buses (22%)". */
  readonly text: string;
}

function wordFor(populated: number, of: number, share: number): CoverageWord {
  if (of > 0 && populated === of) return 'Complete';
  return share >= PARTIAL_FROM_SHARE ? 'Partial' : 'Sparse';
}

/** Coverage rows, most complete first, each with a word so poor fields stand out. */
export function coverageRows(coverage: readonly FieldCoverage[]): CoverageRow[] {
  return coverage
    .map((item): CoverageRow => {
      const share = item.of === 0 ? 0 : item.populated / item.of;
      const percent = Math.round(share * PERCENT);
      return {
        field: item.field,
        label: item.label,
        share,
        percent,
        word: wordFor(item.populated, item.of, share),
        text: `${formatCount(item.populated)} of ${formatCount(item.of)} buses (${percent}%)`,
      };
    })
    .sort((a, b) => b.share - a.share);
}

/** "25 fields read from this feed", or "expected from" for a feed not connected yet. */
export function schemaSummary(feed: Pick<FeedEntry, 'status' | 'fields'>): string {
  const verb = feed.status === 'awaiting' ? 'expected from' : 'read from';
  return `${feed.fields.length} ${feed.fields.length === 1 ? 'field' : 'fields'} ${verb} this feed`;
}

/** The feeds-table row's expander label: the field count lives here, not in a column. */
export function fieldsExpandLabel(feed: Pick<FeedEntry, 'name' | 'status' | 'fields'>): string {
  return `${feed.name}: show ${schemaSummary(feed)}`;
}

/** The registry id of the GPS and device feed, whose row carries the feed-clock note. */
export const GPS_FEED_ID = 'gps-device';

/**
 * One line on the GPS feed's row when the response's `feedClockAheadRows` is present:
 * those rows were ignored when the feed clock was read, so the clock may lag.
 */
export function clockAheadSentence(rows: number | undefined): string | null {
  if (rows === undefined || !Number.isFinite(rows) || rows <= 0) return null;
  const one = rows === 1;
  return `${formatCount(rows)} ${one ? 'row' : 'rows'} carried a receive time ahead of the server's clock and ${
    one ? 'was' : 'were'
  } ignored for the feed clock.`;
}

/** The in-page anchor of a feed: other pages link to `/project/depots/sources#feed-<id>`. */
export function feedAnchor(feedId: string): string {
  return `feed-${feedId}`;
}

/** Which feed an in-page hash names, or null when it names none of the given feeds. */
export function feedIdFromHash(hash: string, feedIds: readonly string[]): string | null {
  const wanted = hash.startsWith('#') ? hash.slice(1) : hash;
  return feedIds.find((id) => feedAnchor(id) === wanted) ?? null;
}
