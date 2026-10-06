import { describe, expect, it } from 'vitest';
import {
  blockedSentence,
  capacitySentence,
  dutyText,
  droppedRowsSentence,
  emptyOrderSentence,
  fleetOnlyCapacitySentence,
  laneHeading,
  overflowReasonText,
  overflowSentence,
  PLAN_NOTICE,
  visitingSentence,
} from '@/lib/depot/yard/parkingModel';
import type { ParkingLane } from '@/lib/depot/yard/parkingApi';

const lane = (slots: number, depth = 8): ParkingLane => ({
  id: 'L02',
  depth,
  slots: Array.from({ length: slots }, (_, i) => ({
    position: i + 1,
    registrationNumber: `UP32A${i}`,
    firstDutyStartMin: null,
  })),
});

describe('capacitySentence', () => {
  it('says how many bays are used and how many are free, under capacity', () => {
    expect(capacitySentence({ bays: 60, inYard: 38, visiting: 0 })).toBe(
      '38 of 60 modelled bays in use; 22 free.',
    );
  });

  it('says none are free at capacity', () => {
    expect(capacitySentence({ bays: 60, inYard: 60, visiting: 0 })).toBe(
      '60 of 60 modelled bays in use; none free.',
    );
  });

  it('says how many are over when the yard holds more than the bays', () => {
    expect(capacitySentence({ bays: 60, inYard: 63, visiting: 1 })).toBe(
      '64 of 60 modelled bays in use; 4 over.',
    );
  });

  it('agrees with a plan that seats 50 of 55 own buses when 10 visitors stand in 60 bays', () => {
    expect(capacitySentence({ bays: 60, inYard: 55, visiting: 10 })).toBe(
      '65 of 60 modelled bays in use; 5 over.',
    );
  });

  it('counts visiting buses against the bays', () => {
    expect(capacitySentence({ bays: 10, inYard: 4, visiting: 3 })).toBe(
      '7 of 10 modelled bays in use; 3 free.',
    );
  });

  it('uses the singular for one bay and one free bay', () => {
    expect(capacitySentence({ bays: 1, inYard: 0, visiting: 0 })).toBe(
      '0 of 1 modelled bay in use; 1 free.',
    );
    expect(capacitySentence({ bays: 5, inYard: 4, visiting: 0 })).toBe(
      '4 of 5 modelled bays in use; 1 free.',
    );
    expect(capacitySentence({ bays: 5, inYard: 6, visiting: 0 })).toBe(
      '6 of 5 modelled bays in use; 1 over.',
    );
  });

  it('groups thousands', () => {
    expect(capacitySentence({ bays: 1200, inYard: 1000, visiting: 0 })).toContain('1,000 of 1,200');
  });
});

describe('visitingSentence', () => {
  it('states visiting buses separately, singular and plural', () => {
    expect(visitingSentence(0)).toBe('No buses from other depots are standing in the yard.');
    expect(visitingSentence(1)).toBe(
      '1 bus from another depot is standing in the yard; it takes a bay but is not ordered.',
    );
    expect(visitingSentence(3)).toBe(
      '3 buses from other depots are standing in the yard; they take bays but are not ordered.',
    );
  });
});

describe('fleetOnlyCapacitySentence', () => {
  it('sets the fleet against the bays and says why the yard is absent', () => {
    expect(fleetOnlyCapacitySentence(142, 150)).toBe(
      'No yard is established, so only the fleet can be set against capacity: 142 buses in the fleet, 150 modelled bays.',
    );
    expect(fleetOnlyCapacitySentence(1, 1)).toBe(
      'No yard is established, so only the fleet can be set against capacity: 1 bus in the fleet, 1 modelled bay.',
    );
  });
});

describe('lane text', () => {
  it('headings give the lane and its fill', () => {
    expect(laneHeading(lane(6, 8))).toBe('Lane L02: 6 of 8 places used');
    expect(laneHeading(lane(1, 1))).toBe('Lane L02: 1 of 1 place used');
  });

  it('writes a duty time past midnight on the next day', () => {
    expect(dutyText(1500)).toBe('first duty 01:00 next day');
    expect(dutyText(null)).toBe('no duty');
  });
});

describe('overflow wording', () => {
  it('counts buses that do not fit, singular and plural', () => {
    expect(overflowSentence(1)).toBe('1 bus does not fit in the modelled lanes and is not ordered.');
    expect(overflowSentence(2)).toBe(
      '2 buses do not fit in the modelled lanes and are not ordered.',
    );
  });

  it('gives the reason in words', () => {
    expect(overflowReasonText('no_lane_space')).toBe('No free place in any modelled lane');
    expect(overflowReasonText('places_taken_by_visitors')).toBe(
      'Places taken by visiting buses',
    );
  });
});

describe('blockedSentence', () => {
  it('confirms that no bus is blocked in', () => {
    expect(blockedSentence(0)).toEqual({
      warning: false,
      text: 'No bus is blocked in: each bus can leave without another being moved.',
    });
  });

  it('warns in words when any bus would be blocked in', () => {
    expect(blockedSentence(1)).toEqual({
      warning: true,
      text: 'Warning: 1 bus would be blocked in by a bus that leaves later.',
    });
    expect(blockedSentence(3).text).toBe(
      'Warning: 3 buses would be blocked in by a bus that leaves later.',
    );
  });
});

describe('notices', () => {
  it('states that the order is a modelled suggestion and dispatches nothing', () => {
    expect(PLAN_NOTICE).toMatch(/suggested order for tonight/);
    expect(PLAN_NOTICE).toMatch(/modelled duties/);
    expect(PLAN_NOTICE).toMatch(/modelled yard layout/);
    expect(PLAN_NOTICE).toMatch(/surveyed yard/);
    expect(PLAN_NOTICE.toLowerCase()).not.toContain('simulated');
  });

  it('gives one sentence per empty state', () => {
    expect(emptyOrderSentence('no_yard')).toMatch(/No yard is established/);
    expect(emptyOrderSentence('no_buses')).toBe('No bus of this depot is in its yard to order.');
    expect(emptyOrderSentence('not_plannable')).toMatch(/could not be worked out/);
    expect(emptyOrderSentence('planned')).toBe('');
  });
});

describe('droppedRowsSentence', () => {
  it('is empty when nothing was dropped and counts the rows otherwise', () => {
    expect(droppedRowsSentence(0)).toBe('');
    expect(droppedRowsSentence(1)).toMatch(/^1 in-yard row with a blank or repeated/);
    expect(droppedRowsSentence(3)).toMatch(/^3 in-yard rows with a blank or repeated/);
  });
});
