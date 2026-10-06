import { describe, expect, it } from 'vitest';
import { LOAD_ERROR_TITLE, loadErrorBody } from '@/lib/depot/loadError';
import { formatClockTime } from '@/lib/depot/format';

describe('load error wording', () => {
  it('titles the panel without repeating it in the body', () => {
    expect(LOAD_ERROR_TITLE).toBe('Could not load depot data');
    const body = loadErrorBody('12:38', null);
    expect(body).toBe(
      'The depot network service did not answer at 12:38. Nothing is shown until it answers. Last good data: none.',
    );
    expect(body.toLowerCase()).not.toContain('could not load depot data');
    expect(body).not.toMatch(/unavailable/i);
  });

  it('names the time of the last good data when there is some', () => {
    expect(loadErrorBody('12:38', '12:31')).toBe(
      'The depot network service did not answer at 12:38. Nothing is shown until it answers. Last good data: 12:31.',
    );
  });
});

describe('formatClockTime', () => {
  it('writes a local time as HH:MM on a 24-hour clock', () => {
    expect(formatClockTime(new Date(2026, 9, 6, 9, 5))).toBe('09:05');
    expect(formatClockTime(new Date(2026, 9, 6, 23, 59))).toBe('23:59');
  });
});
