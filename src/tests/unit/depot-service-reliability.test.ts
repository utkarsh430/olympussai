// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DELAY_UNIT_NOTE, reliabilityByHour } from '@/lib/depot/service/reliability';
import type { LedgerJourney } from '@/lib/depot/service/types';

function journey(id: string, over: Partial<LedgerJourney>): LedgerJourney {
  return {
    operatingDate: '2026-10-06',
    journeyId: id,
    routeName: 'R1',
    registrationNumber: `UP32AB${id}`,
    scheduledStart: '07:10',
    scheduledEnd: '09:00',
    actualStart: '07:12',
    delayMinutes: 2,
    lastSeen: '07:40',
    ...over,
  };
}

describe('reliabilityByHour', () => {
  const ledger = [
    journey('1', { delayMinutes: 4 }),
    journey('2', { delayMinutes: 20 }),
    journey('3', { delayMinutes: 12 }),
    journey('4', { delayMinutes: null }),
    journey('5', { scheduledStart: '18:05', delayMinutes: 0 }),
    journey('6', { scheduledStart: null, actualStart: '18:30', delayMinutes: 30 }),
    journey('7', { scheduledStart: null, actualStart: null, delayMinutes: 9 }),
    journey('8', { routeName: 'OTHER', delayMinutes: 50 }),
  ];
  const hours = reliabilityByHour('R1', ledger);

  it('answers 24 hours', () => {
    expect(hours.map((h) => h.hour)).toEqual(Array.from({ length: 24 }, (_, i) => i));
  });

  it('takes the median delay and the late share over the journeys that carry a delay', () => {
    const seven = hours[7];
    expect(seven?.delayMedianMin).toBe(12);
    // 20 and 12 are beyond the 10-minute threshold: 2 of 3.
    expect(seven?.lateShare).toBeCloseTo(2 / 3, 4);
    expect(seven?.coverage).toEqual({ n: 3, of: 4 });
  });

  it('places a journey without a scheduled start by its actual start, and skips one with neither', () => {
    expect(hours[18]?.coverage).toEqual({ n: 2, of: 2 });
    expect(hours[18]?.delayMedianMin).toBe(15);
    const counted = hours.reduce((s, h) => s + h.coverage.of, 0);
    expect(counted).toBe(6);
  });

  it('leaves an hour without journeys empty', () => {
    expect(hours[3]).toEqual({
      hour: 3,
      delayMedianMin: null,
      lateShare: null,
      coverage: { n: 0, of: 0 },
    });
  });

  it('states that the delay unit is unconfirmed', () => {
    expect(DELAY_UNIT_NOTE).toMatch(/unit/i);
    expect(DELAY_UNIT_NOTE).toMatch(/not confirmed|unconfirmed/i);
  });
});
