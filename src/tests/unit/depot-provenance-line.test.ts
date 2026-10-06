import { describe, expect, it } from 'vitest';
import { provenanceLine, type ProvenanceFeed } from '@/lib/depot/provenanceLine';

const fresh: ProvenanceFeed = {
  data: { source: 'live', stale: false, feedNow: '2026-10-06T12:36:00Z' },
  error: null,
};
const stale: ProvenanceFeed = { ...fresh, data: { ...fresh.data!, stale: true } };
const sample: ProvenanceFeed = { ...fresh, data: { ...fresh.data!, source: 'fixture' } };
const failed: ProvenanceFeed = { data: null, error: 'Depot data unavailable' };
const waiting: ProvenanceFeed = { data: null, error: null };

describe('provenanceLine: all modelled', () => {
  const desc = { default: 'modelled', replacedBy: 'a crew roster and leave feed' } as const;

  it('uses the fixed formula and links to Data sources', () => {
    expect(provenanceLine(desc, fresh)).toEqual({
      tag: 'MODELLED',
      tone: 'modelled',
      sentence:
        'Generated from planning assumptions, not measured. ' +
        'Replaced when a crew roster and leave feed is connected.',
      link: { href: '/project/depots/sources', label: 'Data sources' },
    });
  });

  it('adds what the model is anchored on when the feed is not fresh', () => {
    expect(provenanceLine(desc, stale).sentence).toMatch(
      /connected\. Anchored on the last good data, feed time 12:36\.$/,
    );
    expect(provenanceLine(desc, sample).sentence).toMatch(
      /Anchored on sample data, feed time 12:36\.$/,
    );
    expect(provenanceLine(desc, failed).sentence).toMatch(/The feed is unavailable\.$/);
  });

  it('omits the replacement sentence when no feed is named', () => {
    expect(provenanceLine({ default: 'modelled' }, fresh).sentence).toBe(
      'Generated from planning assumptions, not measured.',
    );
  });
});

describe('provenanceLine: mixed', () => {
  const desc = { default: 'mixed', live: 'Bus states', modelled: 'duties and bays' } as const;

  it('names the live and the generated parts', () => {
    const line = provenanceLine(desc, fresh);
    expect(line.tag).toBe('MIXED');
    expect(line.sentence).toBe('Bus states are LIVE; duties and bays are MODELLED.');
    expect(line.link).toBeNull();
  });

  it('never calls the live part LIVE when it is not', () => {
    expect(provenanceLine(desc, stale).sentence).toBe(
      'Bus states are from the last good data, feed time 12:36; duties and bays are MODELLED.',
    );
    expect(provenanceLine(desc, sample).sentence).toBe(
      'Bus states are sample data, feed time 12:36; duties and bays are MODELLED.',
    );
    expect(provenanceLine(desc, failed).sentence).toBe(
      'Bus states are unavailable: the feed is unavailable; duties and bays are MODELLED.',
    );
    expect(provenanceLine(desc, waiting).sentence).toBe(
      'Bus states are waiting for the feed; duties and bays are MODELLED.',
    );
  });
});

describe('provenanceLine: derived and live', () => {
  it('says the feed time', () => {
    expect(provenanceLine({ default: 'derived' }, fresh)).toEqual({
      tag: 'DERIVED',
      tone: 'derived',
      sentence: 'Computed from the live feed at 12:36.',
      link: null,
    });
    expect(provenanceLine({ default: 'live' }, fresh).sentence).toBe('Live from the feed at 12:36.');
  });

  it('has the stale, sample-data, unavailable and waiting variants', () => {
    expect(provenanceLine({ default: 'derived' }, stale).sentence).toBe(
      'Computed from the last good data, feed time 12:36.',
    );
    expect(provenanceLine({ default: 'derived' }, sample).sentence).toBe(
      'Computed from sample data, feed time 12:36.',
    );
    expect(provenanceLine({ default: 'live' }, stale).sentence).toBe(
      'From the last good data, feed time 12:36.',
    );
    expect(provenanceLine({ default: 'derived' }, failed).sentence).toBe('The feed is unavailable.');
    expect(provenanceLine({ default: 'live' }, waiting).sentence).toBe('Waiting for the feed.');
  });

  it('treats an error over good data as the last good data', () => {
    const line = provenanceLine({ default: 'derived' }, { ...fresh, error: 'x' });
    expect(line.sentence).toBe('Computed from the last good data, feed time 12:36.');
  });
});

describe('provenanceLine: reference', () => {
  it('has no feed clock', () => {
    expect(provenanceLine({ default: 'reference' }, failed)).toEqual({
      tag: 'REFERENCE',
      tone: 'reference',
      sentence: 'Reference data, curated; not from the feed.',
      link: null,
    });
  });
});

describe('provenanceLine wording', () => {
  it('never says simulated', () => {
    const all = [fresh, stale, sample, failed, waiting].flatMap((feed) => [
      provenanceLine({ default: 'modelled', replacedBy: 'x' }, feed).sentence,
      provenanceLine({ default: 'mixed', live: 'a', modelled: 'b' }, feed).sentence,
      provenanceLine({ default: 'derived' }, feed).sentence,
    ]);
    expect(all.join(' ')).not.toMatch(/simulated/i);
  });
});
