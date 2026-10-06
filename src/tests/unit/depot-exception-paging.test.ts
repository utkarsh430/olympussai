import { describe, it, expect } from 'vitest';
import {
  BUS_PAGE_MAX_LIMIT,
  DEFAULT_BUS_PAGE_QUERY,
  busPageSearch,
  countBusSeverities,
  pageBusExceptions,
  parseBusPageQuery,
} from '@/lib/depot/exceptions/busPage';
import type { BusException, BusExceptionKind, ExceptionSeverity } from '@/lib/depot/exceptions/types';

function bus(
  n: number,
  kind: BusExceptionKind,
  severity: ExceptionSeverity,
  depotId: string | null,
): BusException {
  const registrationNumber = `UP${n}`;
  return {
    id: `${kind}:${registrationNumber}`,
    registrationNumber,
    depotId,
    depotName: depotId,
    kind,
    severity,
    lastSeen: null,
    detail: null,
  };
}

const ALL: readonly BusException[] = [
  ...Array.from({ length: 3 }, (_, i) => bus(i, 'emergency', 'critical', '12')),
  ...Array.from({ length: 60 }, (_, i) => bus(100 + i, 'long_dark', 'warning', i < 10 ? '12' : '7')),
  ...Array.from({ length: 5 }, (_, i) => bus(200 + i, 'power_cut', 'info', null)),
];

const params = (q: string): URLSearchParams => new URLSearchParams(q);

describe('parseBusPageQuery', () => {
  it('defaults to the first 25 of every kind and depot', () => {
    expect(parseBusPageQuery(params(''))).toEqual({ ok: true, query: DEFAULT_BUS_PAGE_QUERY });
    expect(DEFAULT_BUS_PAGE_QUERY).toEqual({ kind: null, depotId: null, offset: 0, limit: 25 });
  });

  it('reads a valid kind, depot, offset and limit', () => {
    expect(parseBusPageQuery(params('kind=long_dark&depotId=12&offset=50&limit=100'))).toEqual({
      ok: true,
      query: { kind: 'long_dark', depotId: '12', offset: 50, limit: 100 },
    });
    expect(parseBusPageQuery(params('depotId=unassigned'))).toMatchObject({
      ok: true,
      query: { depotId: 'unassigned' },
    });
  });

  it.each([
    'kind=dark_share_high',
    'kind=nope',
    'depotId=../etc',
    'depotId=1234567',
    'offset=-1',
    'offset=1.5',
    'offset=abc',
    'offset=100000001',
    'limit=0',
    `limit=${BUS_PAGE_MAX_LIMIT + 1}`,
    'limit=25&limit=25',
    'other=1',
  ])('refuses %s', (q) => {
    expect(parseBusPageQuery(params(q))).toEqual({ ok: false });
  });
});

describe('pageBusExceptions', () => {
  it('returns the true total for the filter and one page of it, in the given order', () => {
    const page = pageBusExceptions(ALL, { kind: 'long_dark', depotId: null, offset: 25, limit: 25 });
    expect(page.total).toBe(60);
    expect(page.items).toHaveLength(25);
    expect(page.items[0].registrationNumber).toBe('UP125');
    expect(page).toMatchObject({ kind: 'long_dark', depotId: null, offset: 25, limit: 25 });
  });

  it('filters by depot, counting a bus with no home depot as unassigned', () => {
    expect(pageBusExceptions(ALL, { ...DEFAULT_BUS_PAGE_QUERY, depotId: '12' }).total).toBe(13);
    expect(pageBusExceptions(ALL, { ...DEFAULT_BUS_PAGE_QUERY, depotId: 'unassigned' }).total).toBe(5);
  });

  it('gives an empty page past the end, still with the total', () => {
    const page = pageBusExceptions(ALL, { ...DEFAULT_BUS_PAGE_QUERY, offset: 500 });
    expect(page.items).toEqual([]);
    expect(page.total).toBe(ALL.length);
  });
});

describe('countBusSeverities', () => {
  it('counts every bus exception by severity', () => {
    expect(countBusSeverities(ALL)).toEqual({ critical: 3, warning: 60, info: 5 });
  });
});

describe('busPageSearch', () => {
  it('writes only what differs from the defaults', () => {
    expect(busPageSearch(DEFAULT_BUS_PAGE_QUERY)).toBe('');
    expect(busPageSearch({ kind: 'emergency', depotId: '12', offset: 25, limit: 25 })).toBe(
      '?kind=emergency&depotId=12&offset=25',
    );
  });
});
