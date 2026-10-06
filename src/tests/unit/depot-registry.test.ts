import { describe, expect, it } from 'vitest';
import { FEED_REGISTRY, FEED_STATUS_LABEL } from '@/lib/depot/sources/registry';
import { depotBusRowSchema } from '@/models/depotLive';

describe('FEED_REGISTRY', () => {
  it('has unique ids', () => {
    const ids = FEED_REGISTRY.map((feed) => feed.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every feed a summary, an unlock and at least one field', () => {
    for (const feed of FEED_REGISTRY) {
      expect(feed.name.length).toBeGreaterThan(0);
      expect(feed.summary.length).toBeGreaterThan(0);
      expect(feed.unlocks.length).toBeGreaterThan(0);
      expect(feed.fields.length).toBeGreaterThan(0);
      const names = feed.fields.map((field) => field.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('uses only valid statuses, with the two live feeds live and the rest awaiting', () => {
    const live = FEED_REGISTRY.filter((f) => f.status === 'live').map((f) => f.id);
    expect(live).toEqual(['gps-device', 'route-details']);
    for (const feed of FEED_REGISTRY) {
      expect(['live', 'modelled', 'awaiting']).toContain(feed.status);
    }
    expect(FEED_REGISTRY.filter((f) => f.status === 'awaiting')).toHaveLength(8);
  });

  it('labels statuses LIVE, MODELLED and AWAITING FEED', () => {
    expect(FEED_STATUS_LABEL).toEqual({
      live: 'LIVE',
      modelled: 'MODELLED',
      awaiting: 'AWAITING FEED',
    });
  });

  it('lists every field of the real bus row for the GPS feed', () => {
    const gps = FEED_REGISTRY.find((f) => f.id === 'gps-device');
    const listed = new Set(gps?.fields.map((field) => field.name));
    for (const key of Object.keys(depotBusRowSchema.shape)) {
      expect(listed.has(key)).toBe(true);
    }
  });

  it('carries the documented caveats on the live fields', () => {
    const gps = FEED_REGISTRY.find((f) => f.id === 'gps-device');
    const note = (name: string): string => gps?.fields.find((f) => f.name === name)?.note ?? '';
    expect(note('odometerRaw')).toMatch(/unit.*not.*confirmed/i);
    expect(note('tamperCode')).toMatch(/meaning is not/i);
    expect(note('delayMinutes')).toMatch(/minutes/i);
    expect(note('gpsTimestamp')).toMatch(/Z/);
  });

  it('never uses the word simulated', () => {
    expect(JSON.stringify(FEED_REGISTRY).toLowerCase()).not.toContain('simulated');
  });
});
