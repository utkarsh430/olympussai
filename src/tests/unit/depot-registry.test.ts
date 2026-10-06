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

  it('uses only valid statuses: two live feeds, three modelled, the rest awaiting', () => {
    const live = FEED_REGISTRY.filter((f) => f.status === 'live').map((f) => f.id);
    expect(live).toEqual(['gps-device', 'route-details']);
    for (const feed of FEED_REGISTRY) {
      expect(['live', 'modelled', 'awaiting']).toContain(feed.status);
    }
    const modelled = FEED_REGISTRY.filter((f) => f.status === 'modelled').map((f) => f.id);
    expect(modelled).toEqual(['crew-duties', 'fuel', 'ticketing-ridership']);
    expect(FEED_REGISTRY.filter((f) => f.status === 'awaiting')).toHaveLength(5);
  });

  it('states for each modelled feed the schema the real feed must provide and the pages it unlocks', () => {
    const field = (id: string, name: string) =>
      FEED_REGISTRY.find((f) => f.id === id)?.fields.find((f) => f.name === name);
    expect(field('crew-duties', 'availability')?.type).toBe(
      'available | weekly_off | leave | training | absent',
    );
    expect(field('crew-duties', 'role')?.type).toBe('driver | conductor');
    expect(field('fuel', 'distanceKm')?.type).toBe('number');
    expect(field('fuel', 'fuelLitres')?.note).toMatch(/litres/i);
    expect(field('ticketing-ridership', 'boardings')?.type).toBe('integer');
    expect(field('ticketing-ridership', 'revenue')?.note).toMatch(/rupees/i);
    // A trip is a run out and back from the depot: two legs. A one-way run is half a trip.
    expect(field('ticketing-ridership', 'trips')?.note).toMatch(/out and back/i);
    expect(field('ticketing-ridership', 'trips')?.note).toMatch(/two legs/i);
    expect(field('ticketing-ridership', 'trips')?.note).toMatch(/half a trip/i);
    expect(field('ticketing-ridership', 'trips')?.note).not.toMatch(/one end of the route/i);
    expect(field('ticketing-ridership', 'seatCapacity')?.note).toMatch(/per leg/i);
    expect(field('ticketing-ridership', 'seatCapacity')?.note).toMatch(/offered/i);
    for (const id of ['crew-duties', 'fuel', 'ticketing-ridership']) {
      const feed = FEED_REGISTRY.find((f) => f.id === id);
      expect(feed?.summary).toMatch(/modelled/i);
      expect(feed?.unlocks).toMatch(/page/i);
      for (const entry of feed?.fields ?? []) expect(entry.note ?? '').not.toBe('');
    }
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
