import { describe, expect, it } from 'vitest';
import { entryParams, exceptionSearch } from '@/lib/depot/exceptions/pageParams';

/*
 * The cockpit links here with `?kind=` and `?depot=`. Both are read on
 * entry and validated: an unknown kind or a malformed id is ignored, never an error.
 */
describe('exceptions page entry parameters', () => {
  it('reads a known kind and a well-formed depot id', () => {
    expect(entryParams('?kind=emergency&depot=42')).toEqual({
      kind: 'emergency',
      depotId: '42',
    });
  });

  it('ignores an unknown kind and a malformed depot id', () => {
    expect(entryParams('?kind=fire&depot=..%2Fetc')).toEqual({ kind: null, depotId: null });
    expect(entryParams('?depot=%3Cscript%3E')).toEqual({ kind: null, depotId: null });
    expect(entryParams('')).toEqual({ kind: null, depotId: null });
  });

  it('writes both parameters, keeps others and drops a cleared one', () => {
    expect(exceptionSearch('?x=1', { kind: 'long_dark', depotId: '42' })).toBe(
      '?x=1&kind=long_dark&depot=42',
    );
    expect(
      exceptionSearch('?kind=long_dark&depot=42', { kind: 'long_dark', depotId: null }),
    ).toBe('?kind=long_dark');
    expect(exceptionSearch('?kind=long_dark', { kind: null, depotId: null })).toBe('');
  });
});
