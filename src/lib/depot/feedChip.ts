import type { UpstreamSource } from '@/models/canonical';
import { formatFeedTime } from './format';
import type { Provenance } from './types';

/**
 * Wording of the top bar's feed chip. It says how fresh the data is, never
 * which server cache layer answered: a cached answer inside the cache window is
 * as fresh as the feed, so it reads LIVE. STALE means the last good data is
 * being shown during an outage. The age goes in `title` and screen-reader text.
 */

export type FeedChipTone = 'live' | 'stale' | 'fixture' | 'neutral';

export interface FeedChipData {
  readonly source: UpstreamSource;
  readonly stale: boolean;
  readonly feedNow: string | null;
  /** When the server built the answer: a real ISO instant, unlike `feedNow`. */
  readonly fetchedAt: string;
}

export interface FeedChipInput {
  readonly data: FeedChipData | null;
  readonly error: string | null;
  readonly loading: boolean;
  /** The browser clock in ms, passed in so the wording stays pure. */
  readonly nowMs: number;
}

export interface FeedChip {
  readonly text: string;
  readonly tone: FeedChipTone;
  readonly title: string;
  readonly srText: string;
}

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;

/** "38 s", "4 min", "2 h 5 min"; null when the age cannot be known. */
export function ageWords(ms: number): string | null {
  if (!Number.isFinite(ms)) return null;
  const age = Math.max(0, ms);
  if (age < MINUTE_MS) return `${Math.floor(age / SECOND_MS)} s`;
  if (age < HOUR_MS) return `${Math.floor(age / MINUTE_MS)} min`;
  const hours = Math.floor(age / HOUR_MS);
  const minutes = Math.floor((age % HOUR_MS) / MINUTE_MS);
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

function received(data: FeedChipData, nowMs: number): string {
  const age = ageWords(nowMs - Date.parse(data.fetchedAt));
  const when = age === null ? 'at an unknown time' : `${age} ago`;
  return `received ${when} (feed time ${formatFeedTime(data.feedNow)})`;
}

function plain(text: string, title: string): FeedChip {
  return { text, tone: 'neutral', title, srText: `Feed status: ${title}` };
}

export function feedChip({ data, error, loading, nowMs }: FeedChipInput): FeedChip {
  if (!data) {
    return loading || !error
      ? plain('Feed connecting', 'Waiting for the first answer from the depot feed')
      : plain('Feed unavailable', 'The depot feed has not answered yet');
  }
  const time = formatFeedTime(data.feedNow);
  const stale = data.stale || error !== null;

  if (data.source === 'fixture') {
    const title = 'Sample data, not the live feed';
    const text = ['FIXTURE', stale ? 'stale' : null, time]
      .filter((part): part is string => part !== null)
      .join(' · ');
    return { text, tone: 'fixture', title, srText: `Feed status: ${title}` };
  }

  if (stale) {
    const title = `Showing the last good data, ${received(data, nowMs)}`;
    return {
      text: `STALE · ${time}`,
      tone: 'stale',
      title,
      srText: `Feed status: stale. ${title}`,
    };
  }

  const detail = `data ${received(data, nowMs)}`;
  return {
    text: `LIVE · ${time}`,
    tone: 'live',
    title: `Live feed, ${detail}`,
    srText: `Feed status: live feed, ${detail}`,
  };
}

/**
 * How long a stale feed is carried by the chip and the provenance line alone. A feed
 * that blips stale for a poll or two must not put a notice on every page; data older
 * than this is worth one.
 */
export const STALE_NOTICE_AFTER_MS = 5 * MINUTE_MS;

export interface StaleNoticeTiming {
  /** Whether the page's stale notice shows now. */
  readonly show: boolean;
  /** While held back, how long until it is due; null once it shows. */
  readonly showInMs: number | null;
}

const SHOW_NOTICE: StaleNoticeTiming = { show: true, showInMs: null };

/**
 * Whether the stale notice shows, from the response's fetch time (a real instant) and
 * the browser clock. When the age cannot be known it shows: an outage of unknown length
 * is said out loud. A fetch time slightly ahead of the browser clock is ordinary clock
 * drift and reads as new data; one ahead by more than the limit is not trusted.
 */
export function staleNoticeTiming(fetchedAt: string | null, nowMs: number): StaleNoticeTiming {
  const fetchedMs = fetchedAt === null ? Number.NaN : Date.parse(fetchedAt);
  const age = nowMs - fetchedMs;
  if (!Number.isFinite(age) || age < -STALE_NOTICE_AFTER_MS) return SHOW_NOTICE;
  const showInMs = STALE_NOTICE_AFTER_MS - Math.max(0, age);
  return showInMs > 0 ? { show: false, showInMs } : SHOW_NOTICE;
}

interface NoteLead {
  /** Start of the fresh sentence; the feed time follows it. */
  readonly fresh: string;
  /** Start of the stale and sample-data sentences; the source follows it. */
  readonly other: string;
}

/** What each feed-backed tag says about where a page's figures come from. */
const NOTE_LEADS: Readonly<Record<Exclude<Provenance, 'reference'>, NoteLead>> = {
  live: { fresh: 'Live from the feed at', other: 'From' },
  derived: { fresh: 'Derived from the live feed at', other: 'Derived from' },
  modelled: {
    fresh: 'Modelled: generated figures, anchored on the live feed at',
    other: 'Modelled: generated figures, anchored on',
  },
};

/** The note when the network poll has failed and there is no feed time to name. */
export const FEED_UNAVAILABLE_NOTE = 'The feed is unavailable';

/**
 * The words after a page header's provenance tag, so the tag says what it
 * applies to and when: live ("Live from the feed at 12:37"), derived, modelled
 * (generated figures, anchored on the feed) or reference (curated, no feed
 * clock). Same freshness rule as the chip: a cached answer is the live feed;
 * stale is the last good data. An omitted tag reads as derived.
 */
export function headerProvenanceNote(
  data: Omit<FeedChipData, 'fetchedAt'> | null,
  error: string | null,
  provenance: Provenance = 'derived',
): string {
  if (provenance === 'reference') return 'Reference data, curated';
  if (!data) return error !== null ? FEED_UNAVAILABLE_NOTE : 'Waiting for the feed';
  const lead = NOTE_LEADS[provenance];
  const time = formatFeedTime(data.feedNow);
  if (data.source === 'fixture') return `${lead.other} sample data, feed time ${time}`;
  if (data.stale || error !== null) return `${lead.other} the last good data, feed time ${time}`;
  return `${lead.fresh} ${time}`;
}
