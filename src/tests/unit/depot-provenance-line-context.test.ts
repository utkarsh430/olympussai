import { describe, expect, it } from 'vitest';
import {
  modelledDaySentence,
  provenanceLine,
  sentenceSegments,
  type ProvenanceFeed,
} from '@/lib/depot/provenanceLine';

const feed = (stale: boolean): ProvenanceFeed => ({
  data: { source: 'live', stale, feedNow: '2026-10-06T12:36:10Z' },
  error: null,
});

/** The provenance line's modelled-day extension and stale wording (critique round 4, B). */
describe('provenance line: modelled day', () => {
  it('words the modelled day with one fixed formula', () => {
    expect(
      modelledDaySentence({ date: 'Mon 05 Oct', duties: 163, routes: 4, scheduled: 5, fleet: 200 }),
    ).toBe(
      'Built on the modelled day for Mon 05 Oct: 163 duties on 4 routes; the feed schedules 5 of 200 buses.',
    );
  });

  it('keeps singulars and thousands readable', () => {
    expect(
      modelledDaySentence({ date: 'Mon 05 Oct', duties: 1, routes: 1, scheduled: 0, fleet: 1250 }),
    ).toBe(
      'Built on the modelled day for Mon 05 Oct: 1 duty on 1 route; the feed schedules 0 of 1,250 buses.',
    );
  });

  it('carries the page-worded sentence as the line context, after the formula', () => {
    const line = provenanceLine(
      { default: 'modelled', modelledDay: 'Built on the modelled day for Mon 05 Oct: 3 duties.' },
      feed(false),
    );
    expect(line.context).toBe('Built on the modelled day for Mon 05 Oct: 3 duties.');
    expect(line.sentence).toBe('Generated from planning assumptions, not measured.');
  });

  it('has no context when the page passes none', () => {
    expect(provenanceLine({ default: 'derived' }, feed(false)).context).toBeUndefined();
  });
});

describe('provenance line: stale wording', () => {
  it('names the stale words only when the feed is stale', () => {
    expect(provenanceLine({ default: 'derived' }, feed(true)).staleWords).toBe('last good data');
    expect(provenanceLine({ default: 'derived' }, feed(false)).staleWords).toBeUndefined();
  });

  it('splits a sentence so the stale words can be drawn in the stale tone', () => {
    const line = provenanceLine({ default: 'derived' }, feed(true));
    const segments = sentenceSegments(line.sentence, line.staleWords);
    expect(segments.filter((part) => part.stale).map((part) => part.text)).toEqual([
      'last good data',
    ]);
    expect(segments.map((part) => part.text).join('')).toBe(line.sentence);
  });

  it('marks every occurrence on a mixed page that says it twice', () => {
    const line = provenanceLine(
      { default: 'mixed', live: 'Bus states', derived: 'stops', modelled: 'trips' },
      feed(true),
    );
    const segments = sentenceSegments(line.sentence, line.staleWords);
    expect(segments.filter((part) => part.stale)).toHaveLength(2);
    expect(segments.map((part) => part.text).join('')).toBe(line.sentence);
  });

  it('returns the sentence whole when nothing is stale', () => {
    expect(sentenceSegments('Computed from the live feed at 12:36.', undefined)).toEqual([
      { text: 'Computed from the live feed at 12:36.', stale: false },
    ]);
  });
});
