// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  filesUnder,
  isTsSource,
  parseFile,
  parseSource,
  wallClockReads,
  type Finding,
} from './depot-guard-source';

/*
 * The depot's engine is pure: the feed's clock is the only clock for data,
 * and every random draw is seeded. So no module under src/lib/depot reads the
 * wall clock or an unseeded random source, except the few whose job is to be
 * the injected clock. Those are named here with the reason; every other module
 * takes a clock as a parameter.
 */

const DEPOT_LIB = 'src/lib/depot';

const INJECTED_CLOCKS: Readonly<Record<string, string>> = {
  'src/lib/depot/repositories/liveFleetRepository.ts':
    'the default for its injected `now`, used only to judge freshness of the last good snapshot',
  'src/lib/depot/routes/routeCatalogue.ts':
    'the default for the injected `now` that ages cached route lookups and charges the limiter',
  'src/lib/depot/copilot/limiter.ts':
    'the monotonic clock the copilot rate limiter is built with and tests replace',
};

/** Real violations not yet fixed: file, and what is wrong. Each must be fixed and removed. */
const KNOWN_VIOLATIONS: Readonly<Record<string, string>> = {};

const describeReads = (reads: readonly Finding[]): string[] =>
  reads.map((r) => `${r.what} at line ${r.line}`);

describe('the depot engine reads no wall clock and no unseeded random source', () => {
  const files = filesUnder(DEPOT_LIB, isTsSource);

  it('scans a real folder', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('has no such read outside the named injected clocks', () => {
    const offenders = files
      .filter((f) => !(f in INJECTED_CLOCKS) && !(f in KNOWN_VIOLATIONS))
      .map((f) => ({ file: f, reads: describeReads(wallClockReads(parseFile(f))) }))
      .filter((o) => o.reads.length > 0);
    expect(offenders).toEqual([]);
  });

  it('allows an injected clock only Date.now() or performance.now(), never random or new Date()', () => {
    const misuse = Object.keys(INJECTED_CLOCKS).flatMap((f) =>
      wallClockReads(parseFile(f))
        .filter((r) => r.what !== 'Date.now()' && r.what !== 'performance.now()')
        .map((r) => `${f}: ${r.what} at line ${r.line}`),
    );
    expect(misuse).toEqual([]);
  });

  it('keeps every exception live: a named clock or a known violation that no longer reads the clock is removed', () => {
    const stale = [...Object.keys(INJECTED_CLOCKS), ...Object.keys(KNOWN_VIOLATIONS)].filter(
      (f) => !files.includes(f) || wallClockReads(parseFile(f)).length === 0,
    );
    expect(stale).toEqual([]);
  });

  it('catches every form of the read, and ignores comments, strings and seeded or dated forms', () => {
    const planted = parseSource(
      'planted.ts',
      [
        'const a = Date.now();',
        'const b = new Date();',
        'const c = new Date;',
        'const d = Math.random();',
        'const e = performance.now();',
        'const f = Date();',
        '// Date.now() in a comment',
        "const g = 'Math.random() in a string';",
        "const h = new Date('2026-10-06T08:00:00Z');",
        'const i = rng.random();',
      ].join('\n'),
    );
    expect(wallClockReads(planted).map((r) => r.line)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
