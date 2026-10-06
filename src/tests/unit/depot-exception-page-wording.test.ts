import { describe, expect, it } from 'vitest';
import {
  busColumnPlan,
  depotScopeLine,
  groupDepotExceptions,
  severitySections,
} from '@/lib/depot/exceptions/pageModel';
import { depotWindowNote, scoreWindowPhrase as windowPhrase } from '@/lib/depot/score/windowWords';
import type { DepotException, DepotExceptionKind } from '@/lib/depot/exceptions/types';

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
  it('says one snapshot, with its time, for one sample or none', () => {
    expect(windowPhrase({ lengthMin: 20, since: NOW, samples: 1 }, NOW)).toBe('from one snapshot at 14:20');
    expect(windowPhrase(undefined, NOW)).toBe('from one snapshot at 14:20');
  });
});

describe('depotWindowNote', () => {
  it('says which figure is windowed and which is as of the feed time', () => {
    const note = depotWindowNote({ lengthMin: 20, since: '2026-10-06T14:00:00.000Z', samples: 30 }, NOW);
    expect(note).toBe('Rates are compared with peers over the last 20 minutes; bus counts are as of 14:20.');
  });
});

describe('depotScopeLine', () => {
  const e = (depotId: string, kind: string, severity = 'warning') =>
    ({ id: `${kind}:${depotId}`, depotId, depotName: depotId, kind, severity }) as unknown as DepotException;
  const lineFor = (list: DepotException[], kind: DepotExceptionKind | null = null): string =>
    depotScopeLine(groupDepotExceptions(list, kind));
  it('explains a depot holding two exceptions', () => {
    expect(lineFor([e('a', 'off_road_high'), e('a', 'power_cut_cluster'), e('b', 'off_road_high')])).toContain(
      '3 exceptions in 2 depots',
    );
  });
  it('is empty when each depot has one', () => {
    expect(lineFor([e('a', 'off_road_high'), e('b', 'off_road_high')])).toBe('');
  });
  // It once read "65 exceptions in 61 depots" beside groups totalling 63. The line is
  // counted from the groups the page draws, so it adds up with them at every moment.
  it('adds up with the severity groups when a depot holds both levels', () => {
    const list = [
      e('a', 'off_road_high', 'critical'),
      e('a', 'power_cut_cluster', 'warning'),
      e('b', 'power_cut_cluster', 'warning'),
      e('c', 'dark_share_high', 'critical'),
    ];
    const sections = severitySections(groupDepotExceptions(list, null));
    const depots = sections.reduce((n, s) => n + s.groups.length, 0);
    expect(depots).toBe(3);
    expect(lineFor(list)).toBe('4 exceptions in 3 depots: a depot is listed once, under its worst level.');
  });
  it('counts only what a kind filter leaves on screen', () => {
    const list = [
      e('a', 'off_road_high', 'critical'),
      e('a', 'power_cut_cluster', 'warning'),
      e('b', 'power_cut_cluster', 'warning'),
    ];
    expect(lineFor(list, 'power_cut_cluster')).toBe('');
    expect(lineFor(list, 'off_road_high')).toBe('');
  });
});


describe('busColumnPlan', () => {
  it('drops the constant kind column and the empty code column', () => {
    expect(busColumnPlan('long_dark', [{ detail: null }])).toEqual({ showKind: false, showCode: false });
    expect(busColumnPlan(null, [{ detail: 'Q' }])).toEqual({ showKind: true, showCode: true });
  });
});
