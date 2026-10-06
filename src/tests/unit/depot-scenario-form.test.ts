import { describe, expect, it } from 'vitest';
import {
  parseBusDelta,
  parseDistanceKm,
  parseSparePercent,
  parseSurgePercent,
} from '@/lib/depot/rebalance/scenarioParsers';
import {
  describeDelta,
  effectiveMaxTransferKm,
  summariseScenario,
} from '@/lib/depot/rebalance/scenarioSummary';
import {
  BASELINE_FORM,
  isBaseline,
  scenarioKey,
  toScenario,
  withExcluded,
  withFleetAdjustment,
  withLocked,
  withMaxTransferKm,
  withSparePercent,
  withSurge,
  withoutFleetAdjustment,
  withoutSurge,
} from '@/lib/depot/rebalance/scenarioForm';
import { DEFAULT_REBALANCE_PARAMS } from '@/lib/depot/optimise/config';
import { planTransfers } from '@/lib/depot/optimise/rebalance';
import { runScenario } from '@/lib/depot/optimise/scenario';
import type { DepotBalance } from '@/lib/depot/optimise/types';
import { DEFAULT_REQUIREMENT_PARAMS } from '@/lib/depot/sim/config';
import { spareTargetFor } from '@/lib/depot/sim/requirement';

const NAMES: Readonly<Record<string, string>> = { agra: 'AGRA', kanpur: 'KANPUR' };
const nameOf = (id: string): string => NAMES[id] ?? id;

describe('scenario form state', () => {
  it('starts at the baseline and converts to an empty scenario', () => {
    expect(isBaseline(BASELINE_FORM)).toBe(true);
    expect(toScenario(BASELINE_FORM)).toEqual({});
    expect(summariseScenario(BASELINE_FORM, nameOf)).toBe('Baseline: no changes.');
  });

  it('round-trips every change to a Scenario', () => {
    let s = withSparePercent(BASELINE_FORM, 10);
    s = withMaxTransferKm(s, 150);
    s = withLocked(s, 'agra', true);
    s = withLocked(s, 'kanpur', true);
    s = withExcluded(s, 'banda', true);
    s = withFleetAdjustment(s, 'agra', 12);
    s = withSurge(s, 'kanpur', 15);
    expect(isBaseline(s)).toBe(false);
    expect(toScenario(s)).toEqual({
      spareRatio: 0.1,
      maxTransferKm: 150,
      lockedDepotIds: ['agra', 'kanpur'],
      excludedDepotIds: ['banda'],
      fleetAdjustments: [{ depotId: 'agra', deltaBuses: 12 }],
      demandSurges: [{ depotId: 'kanpur', percent: 15 }],
    });
  });

  it('keeps lock and exclude exclusive and replaces a depot adjustment rather than adding one', () => {
    let s = withLocked(BASELINE_FORM, 'agra', true);
    s = withExcluded(s, 'agra', true);
    expect(s.lockedDepotIds).toEqual([]);
    expect(s.excludedDepotIds).toEqual(['agra']);
    s = withFleetAdjustment(withFleetAdjustment(s, 'agra', 5), 'agra', -3);
    expect(s.fleetAdjustments).toEqual([{ depotId: 'agra', deltaBuses: -3 }]);
    s = withoutFleetAdjustment(withoutSurge(withSurge(s, 'agra', 9), 'agra'), 'agra');
    expect(s.fleetAdjustments).toEqual([]);
    expect(s.demandSurges).toEqual([]);
  });

  it('treats values equal to the defaults, and cleared values, as the baseline', () => {
    const atDefaults = withMaxTransferKm(
      withSparePercent(BASELINE_FORM, DEFAULT_REQUIREMENT_PARAMS.spareRatio * 100),
      DEFAULT_REBALANCE_PARAMS.maxTransferKm,
    );
    expect(isBaseline(atDefaults)).toBe(true);
    expect(isBaseline(withSparePercent(withSparePercent(BASELINE_FORM, 12), null))).toBe(true);
  });

  it('does not mutate the previous state', () => {
    const before = structuredClone(BASELINE_FORM);
    withLocked(BASELINE_FORM, 'agra', true);
    withFleetAdjustment(BASELINE_FORM, 'agra', 4);
    expect(BASELINE_FORM).toEqual(before);
  });

  it('summarises the active changes in plain words', () => {
    let s = withSparePercent(BASELINE_FORM, 10);
    s = withMaxTransferKm(s, 150);
    s = withLocked(withLocked(s, 'agra', true), 'kanpur', true);
    s = withFleetAdjustment(s, 'agra', 12);
    expect(summariseScenario(s, nameOf)).toBe(
      'Spare ratio 10%, maximum distance 150 km, AGRA and KANPUR locked, AGRA +12 buses.',
    );
    s = withExcluded(s, 'banda', true);
    s = withSurge(withFleetAdjustment(s, 'kanpur', -1), 'kanpur', -20);
    expect(summariseScenario(s, nameOf)).toBe(
      'Spare ratio 10%, maximum distance 150 km, AGRA and KANPUR locked, banda excluded, ' +
        'AGRA +12 buses, KANPUR −1 bus, KANPUR demand −20%.',
    );
  });

  it('names the depots a lock or an exclusion applies to, falling back to the id', () => {
    expect(summariseScenario(withLocked(BASELINE_FORM, 'agra', true), nameOf)).toBe('AGRA locked.');
    let s = withExcluded(withExcluded(BASELINE_FORM, 'agra', true), 'kanpur', true);
    expect(summariseScenario(s, nameOf)).toBe('AGRA and KANPUR excluded.');
    s = withExcluded(s, 'banda', true);
    expect(summariseScenario(s, nameOf)).toBe('AGRA, KANPUR and banda excluded.');
  });

  it('gives different labels to scenarios that lock different depots, with the key unchanged', () => {
    const agra = withLocked(BASELINE_FORM, 'agra', true);
    const kanpur = withLocked(BASELINE_FORM, 'kanpur', true);
    expect(summariseScenario(agra, nameOf)).not.toBe(summariseScenario(kanpur, nameOf));
    expect(scenarioKey(agra)).not.toBe(scenarioKey(kanpur));
    // The key is pinned: ids and values only, none of the label's words or names.
    expect(scenarioKey(agra)).toBe(
      '{"sparePercent":null,"maxTransferKm":null,"locked":["agra"],"excluded":[],"fleet":[],"surge":[]}',
    );
  });
});

describe('parsing what a user types', () => {
  it('accepts numbers as typed and leaves range checks to the engine', () => {
    expect(parseSparePercent('10')).toEqual({ ok: true, value: 10 });
    expect(parseSparePercent(' 7.5 % ')).toEqual({ ok: true, value: 7.5 });
    expect(parseSparePercent('-5')).toEqual({ ok: true, value: -5 });
    expect(parseDistanceKm('150 km')).toEqual({ ok: true, value: 150 });
    expect(parseBusDelta('+12')).toEqual({ ok: true, value: 12 });
    expect(parseBusDelta('-3')).toEqual({ ok: true, value: -3 });
    expect(parseSurgePercent('+15%')).toEqual({ ok: true, value: 15 });
  });

  it('rejects empty, non-numeric and fractional-bus input with a sentence', () => {
    for (const result of [
      parseSparePercent(''),
      parseSparePercent('ten'),
      parseDistanceKm('1e999'),
      parseBusDelta('2.5'),
      parseBusDelta('0'),
      parseSurgePercent('abc'),
    ]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/\.$/);
    }
  });
});

function modelledBalance(
  depotId: string,
  available: number,
  peak: number,
  position: { lat: number; lng: number } | null,
  kind: DepotBalance['kind'] = 'depot',
): DepotBalance {
  const modelled = kind === 'depot' && available > 0;
  const peakRequirement = modelled ? peak : available;
  const spareTarget = modelled
    ? spareTargetFor(peakRequirement, DEFAULT_REQUIREMENT_PARAMS.spareRatio)
    : 0;
  const required = peakRequirement + spareTarget;
  return {
    depotId,
    depotName: depotId.toUpperCase(),
    kind,
    fleet: available + 3,
    offRoad: 3,
    available,
    peakRequirement,
    spareTarget,
    required,
    balance: available - required,
    position,
  };
}

describe('baseline equivalence', () => {
  it('runScenario with an empty scenario reproduces the server plan for the same balances', () => {
    const balances: DepotBalance[] = [
      modelledBalance('agra', 120, 90, { lat: 27.18, lng: 78.01 }),
      modelledBalance('mathura', 80, 60, { lat: 27.49, lng: 77.67 }),
      modelledBalance('kanpur', 70, 85, { lat: 26.45, lng: 80.33 }),
      modelledBalance('lucknow', 130, 101, { lat: 26.85, lng: 80.95 }),
      modelledBalance('gorakhpur', 40, 52, { lat: 26.76, lng: 83.37 }),
      modelledBalance('empty', 0, 0, { lat: 26.0, lng: 81.0 }),
      modelledBalance('nowhere', 10, 14, null),
      modelledBalance('hired', 30, 30, { lat: 26.5, lng: 80.5 }, 'hired'),
    ];
    const server = planTransfers(balances, DEFAULT_REBALANCE_PARAMS);
    expect(server.transfers.length).toBeGreaterThan(0);
    expect(server.before.totalDeficit).toBeGreaterThan(0);
    expect(server.before.totalSurplus).toBeGreaterThan(0);

    const outcome = runScenario(balances, toScenario(BASELINE_FORM));
    expect(outcome.clamped).toEqual([]);
    expect(outcome.balances).toEqual(balances);
    expect(outcome.plan).toEqual(server);
  });
});

describe('effectiveMaxTransferKm', () => {
  it('reports the distance the engine will use, without changing the form', () => {
    expect(effectiveMaxTransferKm({}, 250)).toBe(250);
    expect(effectiveMaxTransferKm({ maxTransferKm: 150 }, 250)).toBe(150);
    expect(effectiveMaxTransferKm({ maxTransferKm: 5000 }, 250)).toBe(600);
    expect(effectiveMaxTransferKm({ maxTransferKm: 1 }, 250)).toBe(25);
    expect(effectiveMaxTransferKm({ maxTransferKm: Number.NaN }, 250)).toBe(250);
  });
});

describe('describeDelta', () => {
  it('says a signed difference in words', () => {
    expect(describeDelta(-12, 'bus', 'buses', 'moved')).toBe('12 fewer buses moved');
    expect(describeDelta(1, 'transfer', 'transfers', '')).toBe('1 more transfer');
    expect(describeDelta(0, 'bus', 'buses', 'moved')).toBe('No change in buses moved');
    expect(describeDelta(120.5, 'bus-km', 'bus-km', '')).toBe('120.5 more bus-km');
  });
});
