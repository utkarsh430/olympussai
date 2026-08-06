import { describe, it, expect } from 'vitest';
import { isLiveObservation, LIVE_THRESHOLD_MS } from '@/lib/controlService/freshness';

describe('isLiveObservation', () => {
  const now = Date.parse('2026-08-06T06:00:00Z');

  it('is live when observed just now', () => {
    expect(isLiveObservation(new Date(now).toISOString(), now)).toBe(true);
  });

  it('is live at exactly the threshold', () => {
    const observedAt = new Date(now - LIVE_THRESHOLD_MS).toISOString();
    expect(isLiveObservation(observedAt, now)).toBe(true);
  });

  it('is stale just past the threshold', () => {
    const observedAt = new Date(now - LIVE_THRESHOLD_MS - 1).toISOString();
    expect(isLiveObservation(observedAt, now)).toBe(false);
  });

  it('treats an unparsable timestamp as stale, not live', () => {
    expect(isLiveObservation('not-a-date', now)).toBe(false);
  });
});
