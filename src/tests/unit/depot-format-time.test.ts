import { describe, expect, it } from 'vitest';
import { formatFeedDateTime, formatFeedTime, formatRelative } from '@/lib/depot/format';

describe('formatFeedDateTime', () => {
  it('writes weekday, day, month and time from the feed digits', () => {
    expect(formatFeedDateTime('2026-10-05T08:51:00')).toBe('Mon 05 Oct, 08:51');
    expect(formatFeedDateTime('2026-10-06 23:05:12')).toBe('Tue 06 Oct, 23:05');
  });

  it('reads a misleading Z as Indian wall-clock time, never shifting it', () => {
    expect(formatFeedDateTime('2026-10-05T08:51:00Z')).toBe('Mon 05 Oct, 08:51');
    expect(formatFeedDateTime('2026-10-04T23:59:00.000Z')).toBe('Sun 04 Oct, 23:59');
  });

  it('gives a dash for anything that does not parse', () => {
    expect(formatFeedDateTime(null)).toBe('—');
    expect(formatFeedDateTime('')).toBe('—');
    expect(formatFeedDateTime('yesterday')).toBe('—');
    expect(formatFeedDateTime('2026-13-05T08:51:00')).toBe('—');
    expect(formatFeedDateTime('2026-02-30T08:51:00')).toBe('—');
    expect(formatFeedDateTime('2026-10-05T24:10:00')).toBe('—');
  });
});

describe('formatFeedTime (existing)', () => {
  it('still reads the digits as-is', () => {
    expect(formatFeedTime('2026-10-05T08:51:00Z')).toBe('08:51');
  });
});

describe('formatRelative', () => {
  const now = '2026-10-06T14:00:00Z';

  it('says minutes, hours and days ago against the feed clock', () => {
    expect(formatRelative('2026-10-06T13:48:00Z', now)).toBe('12 min ago');
    expect(formatRelative('2026-10-06T11:00:00Z', now)).toBe('3 h ago');
    expect(formatRelative('2026-10-04T13:00:00Z', now)).toBe('2 days ago');
    expect(formatRelative('2026-10-05T13:00:00Z', now)).toBe('1 day ago');
  });

  it('says just now under a minute and for a time a little ahead of the feed', () => {
    expect(formatRelative('2026-10-06T13:59:30Z', now)).toBe('just now');
    expect(formatRelative('2026-10-06T14:00:20Z', now)).toBe('just now');
  });

  it('says "in" for a time ahead of the feed clock', () => {
    expect(formatRelative('2026-10-06T14:25:00Z', now)).toBe('in 25 min');
  });

  it('treats both stamps as wall-clock, so a Z on one side only does not shift it', () => {
    expect(formatRelative('2026-10-06T13:48:00', now)).toBe('12 min ago');
  });

  it('gives a dash when either side does not parse', () => {
    expect(formatRelative('nope', now)).toBe('—');
    expect(formatRelative('2026-10-06T13:48:00Z', null)).toBe('—');
    expect(formatRelative(null, now)).toBe('—');
  });
});
