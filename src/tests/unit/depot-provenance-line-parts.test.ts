import { describe, expect, it } from 'vitest';
import { provenanceLine, type ProvenanceFeed } from '@/lib/depot/provenanceLine';

const fresh: ProvenanceFeed = {
  data: { source: 'live', stale: false, feedNow: '2026-10-06T12:36:00Z' },
  error: null,
};
const stale: ProvenanceFeed = { ...fresh, data: { ...fresh.data!, stale: true } };

describe('provenanceLine: the mixed formula with a DERIVED part', () => {
  it('says what is live, derived and modelled, in that order', () => {
    const line = provenanceLine(
      { default: 'mixed', live: 'Routes and buses', derived: 'stops', modelled: 'trips' },
      fresh,
    );
    expect(line.sentence).toBe('Routes and buses are LIVE; stops are DERIVED; trips are MODELLED.');
    expect(line.tag).toBe('MIXED');
  });

  it('omits an empty part', () => {
    expect(provenanceLine({ default: 'mixed', live: 'Buses', derived: 'yards' }, fresh).sentence).toBe(
      'Buses are LIVE; yards are DERIVED.',
    );
    expect(provenanceLine({ default: 'mixed', derived: 'Yards', modelled: 'bays' }, fresh).sentence).toBe(
      'Yards are DERIVED; bays are MODELLED.',
    );
  });

  it('never calls the derived part LIVE when the feed is stale', () => {
    const line = provenanceLine({ default: 'mixed', live: 'Buses', derived: 'yards' }, stale);
    expect(line.sentence).toBe(
      'Buses are from the last good data, feed time 12:36; yards are DERIVED from the last good data.',
    );
  });
});

describe('provenanceLine: a second sentence', () => {
  it('follows the formula sentence', () => {
    const line = provenanceLine({ default: 'derived', second: 'Index over 20 minutes.' }, fresh);
    expect(line.sentence).toBe('Computed from the live feed at 12:36. Index over 20 minutes.');
  });

  it('is absent unless given', () => {
    expect(provenanceLine({ default: 'derived' }, fresh).sentence).toBe(
      'Computed from the live feed at 12:36.',
    );
  });
});

describe('provenanceLine: the Data sources link names the replacing feed', () => {
  it('points at the feed section when a feed id is given', () => {
    const line = provenanceLine({ default: 'modelled', replacedBy: 'x', feedId: 'fuel' }, fresh);
    expect(line.link?.href).toBe('/project/depots/sources#feed-fuel');
  });

  it('points at the page without a feed id', () => {
    const line = provenanceLine({ default: 'modelled', replacedBy: 'x' }, fresh);
    expect(line.link?.href).toBe('/project/depots/sources');
  });
});

describe('provenanceLine: the index window as the second sentence', () => {
  const windowed: ProvenanceFeed = {
    data: {
      ...fresh.data!,
      scoreWindow: { lengthMin: 20, since: '2026-10-06T12:16:00Z', samples: 30 },
    },
    error: null,
  };

  it('words the response window after the formula sentence', () => {
    expect(provenanceLine({ default: 'derived', indexWindow: true }, windowed).sentence).toBe(
      'Computed from the live feed at 12:36. Efficiency index over the last 20 minutes.',
    );
  });

  it('says one snapshot when the window holds one sample', () => {
    const one: ProvenanceFeed = {
      ...windowed,
      data: { ...windowed.data!, scoreWindow: { lengthMin: 20, since: '2026-10-06T12:36:00Z', samples: 1 } },
    };
    expect(provenanceLine({ default: 'derived', indexWindow: true }, one).sentence).toMatch(
      / Efficiency index from one snapshot at 12:36\.$/,
    );
  });

  it('says nothing about a window before the feed has answered', () => {
    const none: ProvenanceFeed = { data: null, error: null };
    expect(provenanceLine({ default: 'derived', indexWindow: true }, none).sentence).toBe(
      'Waiting for the feed.',
    );
  });
});
