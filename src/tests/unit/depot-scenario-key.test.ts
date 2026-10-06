import { describe, expect, it } from 'vitest';
import {
  BASELINE_FORM,
  scenarioKey,
  withFleetAdjustment,
  withLocked,
  withSparePercent,
  withSurge,
} from '@/lib/depot/rebalance/scenarioForm';

describe('scenarioKey', () => {
  it('is null at the baseline and when every change equals its default', () => {
    expect(scenarioKey(BASELINE_FORM)).toBeNull();
    expect(scenarioKey(withSparePercent(BASELINE_FORM, 8))).toBeNull();
  });

  it('does not depend on the order the changes were made in', () => {
    const one = withSurge(withFleetAdjustment(BASELINE_FORM, 'agra', 5), 'kanpur', 10);
    const two = withFleetAdjustment(withSurge(BASELINE_FORM, 'kanpur', 10), 'agra', 5);
    const lockedAB = withLocked(withLocked(BASELINE_FORM, 'a', true), 'b', true);
    const lockedBA = withLocked(withLocked(BASELINE_FORM, 'b', true), 'a', true);
    expect(scenarioKey(one)).toBe(scenarioKey(two));
    expect(scenarioKey(lockedAB)).toBe(scenarioKey(lockedBA));
  });

  it('gives the same key when a value is applied again', () => {
    const base = withFleetAdjustment(withFleetAdjustment(BASELINE_FORM, 'agra', 5), 'lucknow', 2);
    const reapplied = withFleetAdjustment(base, 'agra', 5);
    expect(reapplied.fleetAdjustments.map((a) => a.depotId)).toEqual(['lucknow', 'agra']);
    expect(scenarioKey(reapplied)).toBe(scenarioKey(base));
  });

  it('tells apart locking one depot from locking another', () => {
    const agra = scenarioKey(withLocked(BASELINE_FORM, 'agra', true));
    const lucknow = scenarioKey(withLocked(BASELINE_FORM, 'lucknow', true));
    expect(agra).not.toBeNull();
    expect(agra).not.toBe(lucknow);
  });

  it('is built from ids and values, never from names or the display sentence', () => {
    const key = scenarioKey(withFleetAdjustment(BASELINE_FORM, 'agra-depot', -3)) ?? '';
    expect(key).toContain('agra-depot');
    expect(key).toContain('-3');
    expect(key).not.toMatch(/buses|Agra/);
  });

  it('differs when a value differs', () => {
    const five = scenarioKey(withFleetAdjustment(BASELINE_FORM, 'agra', 5));
    const nine = scenarioKey(withFleetAdjustment(BASELINE_FORM, 'agra', 9));
    expect(five).not.toBe(nine);
  });
});
