import { describe, it, expect } from 'vitest';
import {
  DEPOT_GROUP_CAP,
  busRangeSentence,
  capGroups,
  exceptionTotalsLine,
  groupDepotExceptions,
  failedQuerySentence,
  pageMoves,
  parseKindParam,
  severitySections,
} from '@/lib/depot/exceptions/pageModel';
import type {
  DepotException,
  DepotExceptionKind,
  ExceptionSeverity,
} from '@/lib/depot/exceptions/types';

function ex(
  depotId: string,
  depotName: string,
  kind: DepotExceptionKind,
  severity: ExceptionSeverity,
): DepotException {
  return {
    id: `${kind}:${depotId}`,
    depotId,
    depotName,
    kind,
    severity,
    value: 0.1,
    peerMedian: 0,
    z: 3,
    affected: 1,
    fleet: 10,
  };
}

const LIST: readonly DepotException[] = [
  ex('1', 'ALIGARH', 'on_road_low', 'warning'),
  ex('1', 'ALIGARH', 'power_cut_cluster', 'warning'),
  ex('2', 'GARH', 'power_cut_cluster', 'warning'),
  ex('2', 'GARH', 'off_road_high', 'critical'),
  ex('3', 'AMROHA', 'power_cut_cluster', 'warning'),
];

describe('parseKindParam', () => {
  it('accepts every known kind and nothing else', () => {
    expect(parseKindParam('emergency')).toBe('emergency');
    expect(parseKindParam('off_road_high')).toBe('off_road_high');
    expect(parseKindParam('EMERGENCY')).toBeNull();
    expect(parseKindParam('<script>')).toBeNull();
    expect(parseKindParam(null)).toBeNull();
  });
});

describe('groupDepotExceptions', () => {
  it('makes one row per depot, worst severity first, its kinds worst first', () => {
    const groups = groupDepotExceptions(LIST, null);
    expect(groups.map((g) => [g.depotName, g.severity])).toEqual([
      ['GARH', 'critical'],
      ['ALIGARH', 'warning'],
      ['AMROHA', 'warning'],
    ]);
    expect(groups[0]?.exceptions.map((e) => e.kind)).toEqual([
      'off_road_high',
      'power_cut_cluster',
    ]);
  });

  it('keeps only the chosen kind when a kind filter is on', () => {
    const groups = groupDepotExceptions(LIST, 'power_cut_cluster');
    expect(groups.map((g) => g.depotName)).toEqual(['ALIGARH', 'AMROHA', 'GARH']);
    expect(groups.every((g) => g.severity === 'warning')).toBe(true);
  });
});

describe('severitySections', () => {
  it('heads each section with its depot count; warnings open only without criticals', () => {
    const sections = severitySections(groupDepotExceptions(LIST, null));
    expect(sections.map((s) => [s.heading, s.open])).toEqual([
      ['Critical (1 depot)', true],
      ['Warning (2 depots)', false],
    ]);
    const onlyWarnings = severitySections(groupDepotExceptions(LIST, 'on_road_low'));
    expect(onlyWarnings.map((s) => [s.heading, s.open])).toEqual([['Warning (1 depot)', true]]);
  });
});

describe('capGroups', () => {
  it('shows 25 rows then offers the rest', () => {
    const many = Array.from({ length: 69 }, (_, i) => i);
    expect(DEPOT_GROUP_CAP).toBe(25);
    expect(capGroups(many, false)).toEqual({ shown: many.slice(0, 25), hidden: 44 });
    expect(capGroups(many, true)).toEqual({ shown: many, hidden: 0 });
  });
});

describe('exceptionTotalsLine', () => {
  it('names the scope of every total', () => {
    const depot = [
      ...Array.from({ length: 4 }, (_, i) => ex(`c${i}`, 'C', 'off_road_high', 'critical')),
      ...Array.from({ length: 69 }, (_, i) => ex(`w${i}`, 'W', 'power_cut_cluster', 'warning')),
    ];
    expect(exceptionTotalsLine(depot, 1968, { critical: 43, warning: 698, info: 1227 })).toBe(
      '73 depot exceptions (4 critical, 69 warning) · ' +
        '1,968 bus exceptions (43 critical, 698 warning, 1,227 info)',
    );
  });

  it('says none rather than an empty bracket', () => {
    expect(exceptionTotalsLine([], 0, { critical: 0, warning: 0, info: 0 })).toBe(
      '0 depot exceptions · 0 bus exceptions',
    );
  });
});

describe('busRangeSentence', () => {
  const page = { kind: 'long_dark' as const, depotId: null, offset: 0, limit: 25, total: 698 };

  it('gives the true range and total for the filter', () => {
    expect(busRangeSentence({ ...page, shown: 25 }, null)).toBe(
      'Showing 1–25 of 698 long dark buses',
    );
    expect(busRangeSentence({ ...page, offset: 675, shown: 23 }, null)).toBe(
      'Showing 676–698 of 698 long dark buses',
    );
  });

  it('names every kind together and the depot when one is chosen', () => {
    expect(busRangeSentence({ ...page, kind: null, total: 1968, shown: 25 }, 'MEERUT')).toBe(
      'Showing 1–25 of 1,968 bus exceptions at MEERUT',
    );
  });

  it('says plainly when nothing matches', () => {
    expect(busRangeSentence({ ...page, kind: 'emergency', total: 0, shown: 0 }, null)).toBe(
      'No buses with the emergency flag on this snapshot',
    );
  });
});

describe('pageMoves', () => {
  it('offers Previous and Next only where a page exists', () => {
    expect(pageMoves({ offset: 0, limit: 25, total: 60 })).toEqual({ previous: null, next: 25 });
    expect(pageMoves({ offset: 50, limit: 25, total: 60 })).toEqual({ previous: 25, next: null });
    expect(pageMoves({ offset: 0, limit: 25, total: 0 })).toEqual({ previous: null, next: null });
  });

  it('offers no earlier page when the list is empty, whatever offset a poll left', () => {
    expect(pageMoves({ offset: 50, limit: 25, total: 0 })).toEqual({ previous: null, next: null });
  });

  it('steps back to the last page when a poll shrinks the list below the offset', () => {
    expect(pageMoves({ offset: 100, limit: 25, total: 60 }).previous).toBe(50);
  });
});

describe('failedQuerySentence', () => {
  it('says the page could not load and that the last answer stays', () => {
    expect(failedQuerySentence('Session expired')).toBe(
      'Could not load that page: Session expired. Showing the last answer that loaded.',
    );
  });
});
