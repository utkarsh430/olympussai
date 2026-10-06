import type { UpstreamSource } from '@/models/canonical';
import { formatFeedTime } from './format';

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
    return { text: `STALE · ${time}`, tone: 'stale', title, srText: `Feed status: stale. ${title}` };
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
 * The words after a page header's provenance tag ("DERIVED from the live feed
 * at 12:37"), so the tag says what it applies to and when. Same freshness rule
 * as the chip: a cached answer is the live feed; stale is the last good data.
 */
export function headerProvenanceNote(
  data: Omit<FeedChipData, 'fetchedAt'> | null,
  error: string | null,
): string {
  if (!data) return 'waiting for the feed';
  const time = formatFeedTime(data.feedNow);
  if (data.source === 'fixture') return `from sample data, feed time ${time}`;
  if (data.stale || error !== null) return `from the last good data, feed time ${time}`;
  return `from the live feed at ${time}`;
}
