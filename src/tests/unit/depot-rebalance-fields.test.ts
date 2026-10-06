import { describe, expect, it } from 'vitest';
import { TRAIL_NOTE, trailHeading } from '@/lib/depot/rebalance/decisionWording';
import { changeFrom, inForceText, serverInForce } from '@/lib/depot/rebalance/fieldsInForce';

describe('what-if fields in force', () => {
  it('takes the server plan’s own parameters, the spare ratio as a percentage', () => {
    const params = { requirementParams: { spareRatio: 0.08 }, rebalanceParams: { maxTransferKm: 250 } };
    expect(serverInForce(params)).toEqual({ sparePercent: 8, maxTransferKm: 250 });
    const odd = { requirementParams: { spareRatio: 0.0751 }, rebalanceParams: { maxTransferKm: 90 } };
    expect(serverInForce(odd).sparePercent).toBe(7.51);
  });

  it('starts a field with the value in force, never empty', () => {
    expect(inForceText(8)).toBe('8');
    expect(inForceText(0.5)).toBe('0.5');
    expect(inForceText(0)).toBe('0');
    expect(inForceText(Number.NaN)).toBe('');
  });

  it('treats the value in force, or a blank, as no change', () => {
    expect(changeFrom(8, 8)).toBeNull();
    expect(changeFrom(null, 8)).toBeNull();
    expect(changeFrom(15, 8)).toBe(15);
    expect(changeFrom(0, 3)).toBe(0);
  });
});

describe('decision trail heading', () => {
  it('says in one line that nothing is recorded, and only the date once there are entries', () => {
    expect(trailHeading('2026-10-06', 0)).toBe(
      'Decision trail · 2026-10-06: none recorded in this browser',
    );
    expect(trailHeading('2026-10-06', 3)).toBe('Decision trail · 2026-10-06');
    expect(TRAIL_NOTE).toMatch(/append-only/);
    expect(TRAIL_NOTE).toMatch(/no transfer order is issued/);
  });
});
