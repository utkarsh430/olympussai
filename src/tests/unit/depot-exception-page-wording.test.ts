import { describe, expect, it } from 'vitest';
import {
  busColumnPlan,
  depotScopeLine,
  depotWindowNote,
  kindSearch,
  windowPhrase,
} from '@/lib/depot/exceptions/pageModel';
import type { DepotException } from '@/lib/depot/exceptions/types';

const NOW = '2026-10-06T14:20:00.000Z';

describe('windowPhrase', () => {
  it('names the full window', () => {
    expect(windowPhrase({ lengthMin: 20, since: '2026-10-06T14:00:00.000Z', samples: 30 }, NOW)).toBe(
      'over the last 20 minutes',
    );
  });
  it('names a shorter window by its start and snapshots', () => {
    expect(windowPhrase({ lengthMin: 20, since: '2026-10-06T14:14:00.000Z', samples: 3 }, NOW)).toBe(
      'since 14:14, 3 snapshots',
    );
  });
  it('says latest snapshot for one sample or none', () => {
    expect(windowPhrase({ lengthMin: 20, since: NOW, samples: 1 }, NOW)).toBe('in the latest snapshot only');
    expect(windowPhrase(undefined, NOW)).toBe('in the latest snapshot only');
  });
});

describe('depotWindowNote', () => {
  it('says which figure is windowed and which is as of the feed time', () => {
    const note = depotWindowNote({ lengthMin: 20, since: '2026-10-06T14:00:00.000Z', samples: 30 }, NOW);
    expect(note).toBe('Rates are compared with peers over the last 20 minutes; bus counts are as of 14:20.');
  });
});

describe('depotScopeLine', () => {
  const e = (depotId: string, kind: string) => ({ depotId, kind }) as unknown as DepotException;
  it('explains a depot holding two exceptions', () => {
    expect(depotScopeLine([e('a', 'x'), e('a', 'y'), e('b', 'x')])).toContain('3 exceptions in 2 depots');
  });
  it('is empty when each depot has one', () => {
    expect(depotScopeLine([e('a', 'x'), e('b', 'x')])).toBe('');
  });
});

describe('kindSearch', () => {
  it('sets, replaces and clears the kind, keeping other parameters', () => {
    expect(kindSearch('', 'long_dark')).toBe('?kind=long_dark');
    expect(kindSearch('?kind=long_dark&x=1', 'emergency')).toBe('?kind=emergency&x=1');
    expect(kindSearch('?kind=long_dark', null)).toBe('');
  });
});

describe('busColumnPlan', () => {
  it('drops the constant kind column and the empty code column', () => {
    expect(busColumnPlan('long_dark', [{ detail: null }])).toEqual({ showKind: false, showCode: false });
    expect(busColumnPlan(null, [{ detail: 'Q' }])).toEqual({ showKind: true, showCode: true });
  });
});
