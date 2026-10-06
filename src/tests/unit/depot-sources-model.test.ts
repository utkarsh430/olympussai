import { describe, it, expect } from 'vitest';
import liveFixture from '@/fixtures/upsrtc-live-sample.json';
import { normalizeDepotRows } from '@/lib/upsrtc/depotNormalizer';
import { coverageRows, recordsSentence, schemaSummary } from '@/lib/depot/sources/sourcesModel';

describe('recordsSentence', () => {
  it('reconciles records received with buses counted, giving the reason from the normaliser', () => {
    expect(recordsSentence(9993, 9989)).toBe(
      '9,993 records received · 4 excluded (a record with no registration number, or a ' +
        'repeat of a registration already received, where the newest GPS time is kept) · ' +
        '9,989 buses counted',
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
      /^5 records received · 3 excluded/,
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
