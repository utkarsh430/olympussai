import { describe, it, expect } from 'vitest';
import liveFixture from '@/fixtures/upsrtc-live-sample.json';
import { normalizeDepotRows } from '@/lib/upsrtc/depotNormalizer';
import {
  GPS_FEED_ID,
  clockAheadSentence,
  coverageRows,
  fieldsExpandLabel,
  recordsSentence,
  schemaSummary,
} from '@/lib/depot/sources/sourcesModel';
import { FEED_REGISTRY } from '@/lib/depot/sources/registry';

describe('feed row words (round 2)', () => {
  const fields = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ name: `f${i}`, type: 'string' }));
  it('puts the field count in the row expander label', () => {
    expect(fieldsExpandLabel({ name: 'Fuel', status: 'awaiting', fields: fields(12) })).toBe(
      'Fuel: show 12 fields expected from this feed',
    );
    expect(fieldsExpandLabel({ name: 'GPS', status: 'live', fields: fields(1) })).toBe(
      'GPS: show 1 field read from this feed',
    );
  });
  it('says in one line when rows ran ahead of the server clock, and nothing otherwise', () => {
    expect(clockAheadSentence(undefined)).toBeNull();
    expect(clockAheadSentence(0)).toBeNull();
    expect(clockAheadSentence(1)).toBe(
      "1 row carried a receive time ahead of the server's clock and was ignored for the feed clock.",
    );
    expect(clockAheadSentence(1234)).toBe(
      "1,234 rows carried a receive time ahead of the server's clock and were ignored for the feed clock.",
    );
  });
  it('names the GPS feed by its registry id', () => {
    expect(FEED_REGISTRY.some((feed) => feed.id === GPS_FEED_ID)).toBe(true);
  });
});

describe('recordsSentence', () => {
  it('reconciles records received with buses counted, giving the reason from the normaliser', () => {
    expect(recordsSentence(9993, 9989)).toBe(
      '9,993 records received · 4 excluded (an entry that is not a record at all, a record ' +
        'with no registration number, or a repeat of a registration already received, where ' +
        'the newest GPS time is kept) · 9,989 buses counted',
    );
  });

  it('says one record in the singular', () => {
    expect(recordsSentence(11, 10)).toMatch(/^11 records received · 1 excluded \(/);
  });

  it('says every record is a bus when nothing is excluded', () => {
    expect(recordsSentence(9989, 9989)).toBe(
      '9,989 records received · 9,989 buses counted: every record is a distinct bus',
    );
  });

  it('shows one number when the two cannot be from one fetch', () => {
    expect(recordsSentence(10, 12)).toBe('12 buses counted on this snapshot');
  });

  it('matches what the depot normaliser really does with duplicates and blanks', () => {
    const payload = [
      { regNum: 'UP1', timestamp: '2026-10-06T08:00:00Z' },
      { regNum: 'UP1', timestamp: '2026-10-06T08:05:00Z' },
      { regNum: '' },
      'not a record',
      { regNum: 'UP2' },
    ];
    const result = normalizeDepotRows(payload);
    expect(result.recordCount - result.rows.length).toBe(3);
    expect(recordsSentence(result.recordCount, result.rows.length)).toMatch(
      /^5 records received · 3 excluded \(an entry that is not a record at all/,
    );
  });

  it('is consistent on the bundled fixture', () => {
    const result = normalizeDepotRows(liveFixture);
    expect(result.rows.length).toBeLessThanOrEqual(result.recordCount);
  });
});

describe('coverageRows', () => {
  const field = (label: string, populated: number, of = 100) => ({
    field: label.toLowerCase(),
    label,
    populated,
    of,
  });

  it('sorts by completeness and words each row', () => {
    const rows = coverageRows([
      field('Route', 22),
      field('Depot', 100),
      field('Odometer', 50),
      field('Delay', 19),
      field('Position', 100),
    ]);
    expect(rows.map((r) => [r.label, r.word, r.percent])).toEqual([
      ['Depot', 'Complete', 100],
      ['Position', 'Complete', 100],
      ['Odometer', 'Partial', 50],
      ['Route', 'Sparse', 22],
      ['Delay', 'Sparse', 19],
    ]);
    expect(rows[2]?.text).toBe('50 of 100 buses (50%)');
  });

  it('never calls a nearly complete field complete', () => {
    expect(coverageRows([field('GPS time', 9988, 9989)])[0]).toMatchObject({
      word: 'Partial',
      percent: 100,
    });
  });

  it('treats an empty snapshot as sparse, not complete', () => {
    expect(coverageRows([field('Depot', 0, 0)])[0]?.word).toBe('Sparse');
  });
});

describe('schemaSummary', () => {
  const fields = (n: number): { name: string; type: string }[] =>
    Array.from({ length: n }, (_, i) => ({ name: `f${i}`, type: 'string' }));

  it('is a sentence-case count of the fields', () => {
    expect(schemaSummary({ status: 'live', fields: fields(25) })).toBe(
      '25 fields read from this feed',
    );
    expect(schemaSummary({ status: 'awaiting', fields: fields(1) })).toBe(
      '1 field expected from this feed',
    );
  });
});
