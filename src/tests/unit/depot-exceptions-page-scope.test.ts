import { describe, expect, it } from 'vitest';
import { busGroupLabel, exceptionPageScope } from '@/lib/depot/exceptions/pageScope';
import type { DepotException } from '@/lib/depot/exceptions/types';

/*
 * Round 3 (R2-m22, R2-m23, capture item 4): with `?depot=` the whole exceptions page is
 * about that depot, and with `?kind=` as well every count reflects both.
 */
function depotException(depotId: string, kind: DepotException['kind']): DepotException {
  return {
    kind,
    severity: 'warning',
    depotId,
    depotName: depotId === '49' ? 'KAUSHAMBI' : 'GARH',
  } as DepotException;
}

const NETWORK_COUNTS = {
  dark_share_high: 2,
  off_road_high: 1,
  on_road_low: 0,
  power_cut_cluster: 0,
  long_dark: 600,
  power_cut: 37,
  tamper_code: 5,
  emergency: 46,
};

const RESPONSE = {
  report: {
    counts: NETWORK_COUNTS,
    depot: [
      depotException('49', 'dark_share_high'),
      depotException('8', 'dark_share_high'),
      depotException('8', 'off_road_high'),
    ],
    busTotal: 688,
  },
  busSeverityCounts: { critical: 46, warning: 600, info: 42 },
};

const SCOPE = {
  depotId: '49',
  depotName: 'KAUSHAMBI',
  busCounts: { long_dark: 3, power_cut: 0, tamper_code: 0, emergency: 1 },
  busTotal: 4,
  depot: [depotException('49', 'dark_share_high')],
};

describe('exceptionPageScope', () => {
  it('is the network, unchanged, with no depot', () => {
    const scope = exceptionPageScope(RESPONSE, null, null);
    expect(scope.depotName).toBeNull();
    expect(scope.counts).toEqual(NETWORK_COUNTS);
    expect(scope.depotList).toHaveLength(3);
    expect(scope.depotCount).toBe(3);
  });

  it('counts the depot in every band and lists only its exceptions', () => {
    const scope = exceptionPageScope({ ...RESPONSE, depotScope: SCOPE }, '49', null);
    expect(scope.depotName).toBe('KAUSHAMBI');
    expect(scope.counts).toEqual({
      dark_share_high: 1,
      off_road_high: 0,
      on_road_low: 0,
      power_cut_cluster: 0,
      long_dark: 3,
      power_cut: 0,
      tamper_code: 0,
      emergency: 1,
    });
    expect(scope.depotList.map((e) => e.depotId)).toEqual(['49']);
    expect(scope.busTotal).toBe(4);
    expect(scope.busSeverity).toBeNull();
  });

  it('counts the depot section under a kind filter, not the unfiltered list', () => {
    expect(exceptionPageScope(RESPONSE, null, 'off_road_high').depotCount).toBe(1);
    expect(exceptionPageScope({ ...RESPONSE, depotScope: SCOPE }, '49', 'off_road_high').depotCount).toBe(0);
  });

  it('never shows network bus counts under a depot whose scope has not arrived', () => {
    const scope = exceptionPageScope(RESPONSE, '49', null);
    expect(scope.counts.long_dark).toBeNull();
    expect(scope.depotList.map((e) => e.depotId)).toEqual(['49']);
    expect(scope.busTotal).toBeNull();
  });

  it('names an id the snapshot does not hold', () => {
    const scope = exceptionPageScope(
      { ...RESPONSE, depotScope: { ...SCOPE, depotId: '77', depotName: null, depot: [] } },
      '77',
      null,
    );
    expect(scope.depotName).toBe('Depot 77');
  });
});

describe('busGroupLabel', () => {
  it('reads as a mono group row with the kind total and its severity once', () => {
    expect(busGroupLabel('emergency', 46, 'critical')).toBe('EMERGENCY FLAG · 46 · CRITICAL');
    expect(busGroupLabel('long_dark', 1234, 'warning')).toBe('LONG DARK · 1,234 · WARNING');
  });
});
