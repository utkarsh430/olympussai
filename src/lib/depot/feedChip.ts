import type { UpstreamSource } from '@/models/canonical';
import { formatCount, formatDurationMinutes, formatFeedTime } from './format';
import type { PageRefreshState } from './pageRefresh';
import type { Provenance } from './types';

/**
 * Wording of the top bar's feed chip. It says how fresh the data is, never
 * which server cache layer answered: a cached answer inside the cache window is
 * as fresh as the feed, so it reads LIVE. STALE means the last good data is
 * being shown during an outage. FEED QUIET means the upstream answers but its newest
 * report trails the fetch by more than `FEED_QUIET_AFTER_MIN`. CHECK CLOCK means the feed is live but enough
 * reports are stamped ahead of the server's clock that the feed clock may lag
 * (P4). The age goes in `title` and screen-reader text.
 */

export type FeedChipTone = 'live' | 'stale' | 'fixture' | 'neutral';

export interface FeedChipData {
  readonly source: UpstreamSource;
  readonly stale: boolean;
  readonly feedNow: string | null;
  /** When the server built the answer: a real ISO instant, unlike `feedNow`. */
  readonly fetchedAt: string;
  /** Rows stamped later than the server's own clock allows (sent only above zero). */
  readonly feedClockAheadRows?: number;
  /** The response's rows: what the ahead count is a share of. */
  readonly recordCount?: number;
}

/** From this share of a response's rows stamped ahead, the feed clock may lag (P4). */
export const FEED_CLOCK_AHEAD_WARN_SHARE = 0.01;
/** Never fewer ahead rows than this before the chip warns, however small the response. */
export const FEED_CLOCK_AHEAD_WARN_MIN_ROWS = 20;

export interface FeedChipInput {
  readonly data: FeedChipData | null;
  readonly error: string | null;
  readonly loading: boolean;
  /** The browser clock in ms, passed in so the wording stays pure. */
  readonly nowMs: number;
  /**
   * Whether the open page's own data request is failing: its figures are then the last
   * ones received, so the chip must not read LIVE at the current feed time.
   */
  readonly page?: PageRefreshState;
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

/** From this many minutes between the feed's newest report and the fetch, the feed is quiet. */
export const FEED_QUIET_AFTER_MIN = 10;
/** The feed clock's digits are Indian time (UTC+05:30) behind a misleading `Z`. */
const FEED_IST_OFFSET_MIN = 330;
const FEED_DIGITS = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;

/**
 * Whole minutes by which the feed's newest report trails the fetch, both on the Indian
 * clock: the feed time is read from its digits (the `Z` ignored), and the fetch time, a
 * true instant, is moved to Indian time. Null when either does not parse.
 */
export function feedLagMinutes(feedNow: string | null, fetchedAt: string): number | null {
  const match = feedNow ? FEED_DIGITS.exec(feedNow) : null;
  const fetchedMs = Date.parse(fetchedAt);
  if (!match || !Number.isFinite(fetchedMs)) return null;
  const parts = match.slice(1).map((part) => (part === undefined ? 0 : Number(part)));
  const [year = 0, month = 1, day = 1, hour = 0, minute = 0, second = 0] = parts;
  const feedMs = Date.UTC(year, month - 1, day, hour, minute, second);
  return Math.floor((fetchedMs + FEED_IST_OFFSET_MIN * MINUTE_MS - feedMs) / MINUTE_MS);
}

/** True when the upstream answers but its newest report is older than the quiet limit. */
export function isFeedQuiet(data: Pick<FeedChipData, 'feedNow' | 'fetchedAt'>): boolean {
  const lag = feedLagMinutes(data.feedNow, data.fetchedAt);
  return lag !== null && lag > FEED_QUIET_AFTER_MIN;
}

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

/**
 * When enough rows are stamped later than the server's clock allows, the feed clock was
 * read from the newest row that is not, so it may lag a slow server clock (P4). The
 * sentence that says so, or null below the share. Never for the saved sample.
 */
function clockWarning(data: FeedChipData): string | null {
  const ahead = data.feedClockAheadRows ?? 0;
  const share = Math.ceil((data.recordCount ?? 0) * FEED_CLOCK_AHEAD_WARN_SHARE);
  if (data.source === 'fixture' || ahead < Math.max(FEED_CLOCK_AHEAD_WARN_MIN_ROWS, share)) {
    return null;
  }
  return (
    `${formatCount(ahead)} ${ahead === 1 ? 'report carries' : 'reports carry'} a time later ` +
    "than the server's own clock allows, so the feed clock may lag and the server's clock " +
    'should be checked'
  );
}

function plain(text: string, title: string): FeedChip {
  return { text, tone: 'neutral', title, srText: `Feed status: ${title}` };
}

/** The page's own request failed while the feed answers: stale, at the page figures' time. */
function pageStaleChip(data: FeedChipData, since: string | null, nowMs: number): FeedChip {
  const time = formatFeedTime(since);
  const title =
    "This page's figures could not be refreshed; they are the last ones received, feed " +
    `time ${time}. The feed itself answers: data ${received(data, nowMs)}`;
  return { text: `STALE · ${time}`, tone: 'stale', title, srText: `Feed status: stale. ${title}` };
}

export function feedChip({ data, error, loading, nowMs, page }: FeedChipInput): FeedChip {
  if (!data) {
    return loading || !error
      ? plain('Feed connecting', 'Waiting for the first answer from the depot feed')
      : plain('Feed unavailable', 'The depot feed has not answered yet');
  }
  const time = formatFeedTime(data.feedNow);
  const stale = data.stale || error !== null;
  const pageFailed = page?.failed === true;

  if (data.source === 'fixture') {
    const title = 'Sample data, not the live feed';
    const text = ['FIXTURE', stale || pageFailed ? 'stale' : null, time]
      .filter((part): part is string => part !== null)
      .join(' · ');
    return { text, tone: 'fixture', title, srText: `Feed status: ${title}` };
  }

  const clock = clockWarning(data);
  if (stale) {
    const lastGood = `Showing the last good data, ${received(data, nowMs)}`;
    const title = clock === null ? lastGood : `${lastGood}. ${clock}.`;
    return {
      text: `STALE · ${time}`,
      tone: 'stale',
      title,
      srText: `Feed status: stale. ${title}`,
    };
  }

  if (pageFailed) return pageStaleChip(data, page.since, nowMs);

  const lag = feedLagMinutes(data.feedNow, data.fetchedAt);
  if (lag !== null && lag > FEED_QUIET_AFTER_MIN) {
    const quiet =
      `The newest report in the feed is ${formatDurationMinutes(lag)} older than the last ` +
      `fetch. Data ${received(data, nowMs)}`;
    const title = clock === null ? quiet : `${quiet}. ${clock}.`;
    return {
      text: `FEED QUIET · ${time}`,
      tone: 'stale',
      title,
      srText: `Feed status: feed quiet. ${title}`,
    };
  }

  if (clock !== null) {
    const title = `${clock}. Data ${received(data, nowMs)}`;
    return {
      text: `CHECK CLOCK · ${time}`,
      tone: 'stale',
      title,
      srText: `Feed status: check clock. ${title}`,
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
