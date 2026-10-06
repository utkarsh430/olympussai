import { describe, expect, it } from 'vitest';
import {
  busScopeLine,
  depotScopeLine,
  exceptionGroups,
  exceptionKindHref,
  exceptionScope,
} from '@/lib/depot/network/exceptionScope';
import type { ExceptionKind, ExceptionSeverity } from '@/lib/depot/exceptions/types';

/** The captured snapshot: 73 depot and 1,968 bus exceptions. */
const COUNTS: Record<ExceptionKind, number> = {
  dark_share_high: 7,
  off_road_high: 4,
  on_road_low: 4,
  power_cut_cluster: 58,
  emergency: 43,
  long_dark: 698,
  power_cut: 1054,
  tamper_code: 173,
};
const SEVERITIES: Record<ExceptionSeverity, number> = { critical: 47, warning: 767, info: 1227 };

describe('exceptionScope', () => {
  it('splits the counts into depot and bus exceptions by severity', () => {
    expect(exceptionScope(COUNTS, SEVERITIES)).toEqual({
      depot: { total: 73, critical: 4, warning: 69 },
      bus: { total: 1968, critical: 43, warning: 698, info: 1227 },
    });
  });

  it('never reports a negative depot count when the server totals disagree', () => {
    const scope = exceptionScope(COUNTS, { critical: 10, warning: 0, info: 0 });
    expect(scope.depot.critical).toBe(0);
    expect(scope.depot.warning).toBe(73);
  });
});

describe('scope lines', () => {
  const scope = exceptionScope(COUNTS, SEVERITIES);

  it('names the depot scope and its severities', () => {
    expect(depotScopeLine(scope)).toBe('73 depot exceptions (4 critical, 69 warning)');
  });

  it('names the bus scope and its severities', () => {
    expect(busScopeLine(scope)).toBe('1,968 bus exceptions (43 critical, 698 warning, 1,227 info)');
  });

  it('says so when a scope has none, and uses the singular for one', () => {
    const none = exceptionScope({ ...COUNTS, dark_share_high: 0, off_road_high: 0, on_road_low: 0, power_cut_cluster: 1 }, { critical: 43, warning: 699, info: 1227 });
    expect(depotScopeLine(none)).toBe('1 depot exception (0 critical, 1 warning)');
    const empty = exceptionScope(
      { ...COUNTS, dark_share_high: 0, off_road_high: 0, on_road_low: 0, power_cut_cluster: 0 },
      { critical: 43, warning: 698, info: 1227 },
    );
    expect(depotScopeLine(empty)).toBe('No depot exceptions');
  });
});

describe('exceptionGroups', () => {
  it('lists the depot kinds and the bus kinds separately, each with its count', () => {
    const groups = exceptionGroups(COUNTS);
    expect(groups.depot.map((row) => row.kind)).toEqual([
      'dark_share_high',
      'off_road_high',
      'on_road_low',
      'power_cut_cluster',
    ]);
    expect(groups.bus.map((row) => [row.label, row.count])).toEqual([
      ['Emergency flag', 43],
      ['Long dark', 698],
      ['Power off', 1054],
      ['Tamper code', 173],
    ]);
  });
});

describe('exceptionKindHref', () => {
  it('opens the exceptions page filtered to the kind', () => {
    expect(exceptionKindHref('emergency')).toBe('/project/depots/exceptions?kind=emergency');
    expect(exceptionKindHref('dark_share_high')).toBe(
      '/project/depots/exceptions?kind=dark_share_high',
    );
  });
});
