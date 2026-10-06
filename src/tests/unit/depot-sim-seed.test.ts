import { describe, expect, it } from 'vitest';
import { SeededRandom } from '@/lib/simulation/seededRandom';
import { operatingDateOf, seedFor } from '@/lib/depot/sim/seed';

describe('operatingDateOf', () => {
  it('reads the date prefix of a valid feedNow without timezone conversion', () => {
    expect(operatingDateOf('2026-10-06T23:59:00Z', '2026-10-07T00:10:00Z')).toBe('2026-10-06');
    expect(operatingDateOf('2026-10-06T00:00:01+05:30', '2026-10-09T00:00:00Z')).toBe('2026-10-06');
  });

  it('falls back to fetchedAt when feedNow is null', () => {
    expect(operatingDateOf(null, '2026-10-07T08:00:00Z')).toBe('2026-10-07');
  });

  it('falls back to fetchedAt when feedNow is unparsable', () => {
    expect(operatingDateOf('not a time', '2026-10-07T08:00:00Z')).toBe('2026-10-07');
    expect(operatingDateOf('', '2026-10-07T08:00:00Z')).toBe('2026-10-07');
  });
});

describe('seedFor', () => {
  it('is stable for the same inputs', () => {
    expect(seedFor('depot:A', '2026-10-06', 'x')).toBe(seedFor('depot:A', '2026-10-06', 'x'));
  });

  it('changes with any part', () => {
    const base = seedFor('depot:A', '2026-10-06', 'x');
    expect(seedFor('depot:B', '2026-10-06', 'x')).not.toBe(base);
    expect(seedFor('depot:A', '2026-10-07', 'x')).not.toBe(base);
    expect(seedFor('depot:A', '2026-10-06', 'y')).not.toBe(base);
  });

  it('gives independent streams for different salts', () => {
    const a = new SeededRandom(seedFor('depot:A', '2026-10-06', 'one'));
    const b = new SeededRandom(seedFor('depot:A', '2026-10-06', 'two'));
    const drawsA = Array.from({ length: 5 }, () => a.float(0, 1));
    const drawsB = Array.from({ length: 5 }, () => b.float(0, 1));
    expect(drawsA).not.toEqual(drawsB);
  });

  it('does not let parts bleed into each other', () => {
    expect(seedFor('a|b', 'c', 'd')).not.toBe(seedFor('a', 'b|c', 'd'));
  });
});
