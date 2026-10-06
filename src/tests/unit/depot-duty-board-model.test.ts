import { describe, expect, it } from 'vitest';
import type { BoardDuty, DutyBoardCounts } from '@/lib/depot/duties/api';
import {
  AXIS_END_MIN,
  AXIS_START_MIN,
  COST_SENTENCE,
  MODEL_NOTICE,
  axisTicks,
  barGeometry,
  buildBoardRows,
  emptyDutiesSentence,
  formatMinute,
  nowLinePct,
  nowSentence,
  reasonSentence,
  routesWithoutDutySentence,
  spareSentence,
  summarySentence,
} from '@/lib/depot/duties/dutyBoardModel';

function duty(over: Partial<BoardDuty> = {}): BoardDuty {
  return {
    id: 'D-000',
    routeName: 'ORD_1',
    startMin: 420,
    endMin: 900,
    serviceClass: 'ordinary',
    registrationNumber: 'UP32A0001',
    state: 'assigned',
    blockers: null,
    ...over,
  };
}

const counts = (over: Partial<DutyBoardCounts> = {}): DutyBoardCounts => ({
  duties: 5,
  assigned: 3,
  unassigned: 2,
  spare: 1,
  excluded: { notInYard: 0, offRoad: 0, dark: 0 },
  ...over,
});

describe('axis', () => {
  it('runs 04:00 to 24:00', () => {
    expect(AXIS_START_MIN).toBe(240);
    expect(AXIS_END_MIN).toBe(1440);
  });

  it('has a tick every two hours with labels', () => {
    const ticks = axisTicks();
    expect(ticks.map((t) => t.label)).toEqual([
      '04:00', '06:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00',
      '24:00',
    ]);
    expect(ticks[0]?.leftPct).toBe(0);
    expect(ticks[ticks.length - 1]?.leftPct).toBe(100);
  });
});

describe('barGeometry', () => {
  it('places a bar from its start and end', () => {
    expect(barGeometry(420, 900)).toEqual({
      leftPct: 15,
      widthPct: 40,
      startsBeforeAxis: false,
      endsAfterAxis: false,
    });
  });

  it('clips a duty that ends after midnight at the axis end and says so', () => {
    const g = barGeometry(1380, 1560);
    expect(g.leftPct).toBe(95);
    expect(g.widthPct).toBe(5);
    expect(g.leftPct + g.widthPct).toBeLessThanOrEqual(100);
    expect(g.endsAfterAxis).toBe(true);
    expect(g.startsBeforeAxis).toBe(false);
  });

  it('clips a duty that starts before 04:00 at the axis start and says so', () => {
    const g = barGeometry(180, 300);
    expect(g.leftPct).toBe(0);
    expect(g.widthPct).toBe(5);
    expect(g.startsBeforeAxis).toBe(true);
  });

  it('never draws a bar narrower than a visible sliver, nor outside the axis', () => {
    const tiny = barGeometry(600, 601);
    expect(tiny.widthPct).toBeGreaterThanOrEqual(0.8);
    const before = barGeometry(0, 100);
    expect(before.leftPct).toBe(0);
    expect(before.widthPct).toBeGreaterThan(0);
    const after = barGeometry(1500, 1600);
    expect(after.leftPct + after.widthPct).toBeLessThanOrEqual(100);
    expect(after.endsAfterAxis).toBe(true);
  });
});

describe('now line', () => {
  it('reads the wall-clock digits of the feed time, with no time zone shift', () => {
    expect(nowLinePct('2026-10-06T10:00:00Z')).toBe(((600 - 240) / 1200) * 100);
    expect(nowLinePct('2026-10-06 04:00:00')).toBe(0);
  });

  it('is absent when the feed has no clock or the time is off the axis', () => {
    expect(nowLinePct(null)).toBeNull();
    expect(nowLinePct('garbage')).toBeNull();
    expect(nowLinePct('2026-10-06T02:30:00Z')).toBeNull();
  });
});

describe('formatMinute', () => {
  it('writes HH:MM and marks the next day', () => {
    expect(formatMinute(420)).toBe('07:00');
    expect(formatMinute(1439)).toBe('23:59');
    expect(formatMinute(1500)).toBe('01:00 next day');
    expect(formatMinute(1440)).toBe('00:00 next day');
  });
});

describe('buildBoardRows', () => {
  it('orders rows by start then id, whatever order they arrive in', () => {
    const rows = buildBoardRows([
      duty({ id: 'B', startMin: 500 }),
      duty({ id: 'C', startMin: 300 }),
      duty({ id: 'A', startMin: 500 }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['C', 'A', 'B']);
  });

  it('gives every row a state word, a time span, geometry and a text equivalent', () => {
    const [assigned, nobus, away] = buildBoardRows([
      duty({ id: 'A', startMin: 400 }),
      duty({
        id: 'B',
        startMin: 410,
        registrationNumber: null,
        state: 'no_bus',
        blockers: { notInYard: 0, offRoad: 0, dark: 0 },
      }),
      duty({
        id: 'C',
        startMin: 420,
        registrationNumber: null,
        state: 'bus_not_in_yard',
        blockers: { notInYard: 2, offRoad: 0, dark: 0 },
      }),
    ]);
    expect(assigned?.stateWord).toBe('Assigned');
    expect(nobus?.stateWord).toBe('No bus');
    expect(away?.stateWord).toBe('Bus not in yard');
    expect(assigned?.timeText).toBe('06:40 to 15:00');
    expect(assigned?.ariaLabel).toBe(
      'Route ORD_1, ordinary, 06:40 to 15:00 (modelled). Assigned: UP32A0001.',
    );
    expect(nobus?.ariaLabel).toContain('No bus');
    expect(nobus?.registrationNumber).toBeNull();
    expect(assigned?.reason).toBeNull();
    expect(away?.reason).toContain('not in the yard');
  });

  it('shows a duty past midnight with its real end, not the clipped one', () => {
    const [row] = buildBoardRows([duty({ startMin: 1380, endMin: 1560 })]);
    expect(row?.timeText).toBe('23:00 to 02:00 next day');
    expect(row?.geometry.endsAfterAxis).toBe(true);
  });

  it('does not mutate its input', () => {
    const input = [duty({ id: 'B', startMin: 500 }), duty({ id: 'A', startMin: 300 })];
    buildBoardRows(input);
    expect(input.map((d) => d.id)).toEqual(['B', 'A']);
  });
});

describe('sentences', () => {
  it('says the duties are a model and the matching only a recommendation', () => {
    expect(MODEL_NOTICE).toBe(
      'Duties are a model until a timetable is supplied. The matching of buses to duties is a recommendation: nothing is assigned or dispatched.',
    );
  });

  it('states the cost in the assignment module\'s own terms', () => {
    expect(COST_SENTENCE).toBe(
      'The matching minimises total wear: a bus costs its age in years times the duty length in whole hours, so longer duties go to younger buses. A bus is never matched to a duty of another service class.',
    );
    expect(COST_SENTENCE).not.toMatch(/optimal/i);
  });

  it('summarises the counts with the modelled tag', () => {
    expect(summarySentence(counts())).toBe(
      'MODELLED: 5 duties. The matching proposes a bus for 3 and leaves 2 without one; 1 bus is spare.',
    );
    expect(summarySentence(counts({ duties: 1, assigned: 1, unassigned: 0, spare: 4 }))).toBe(
      'MODELLED: 1 duty. The matching proposes a bus for 1 and leaves 0 without one; 4 buses are spare.',
    );
  });

  it('explains an empty board by its cause', () => {
    expect(emptyDutiesSentence({ routeCount: 0, peakRequirement: 5 })).toBe(
      'No duties are modelled for this depot: none of its buses reports a route in the live feed, so there is nothing to run a duty on.',
    );
    expect(emptyDutiesSentence({ routeCount: 3, peakRequirement: 0 })).toBe(
      'No duties are modelled for this depot: the modelled peak requirement is zero buses.',
    );
  });

  it('lists routes left without a duty, or says nothing', () => {
    expect(routesWithoutDutySentence([])).toBeNull();
    expect(routesWithoutDutySentence(['B_2', 'C_3'])).toBe(
      'The modelled requirement is smaller than the number of routes, so 2 routes have no duty: B_2, C_3.',
    );
    expect(routesWithoutDutySentence(['Z'])).toBe(
      'The modelled requirement is smaller than the number of routes, so 1 route has no duty: Z.',
    );
  });

  it('says what the now line is, or why it is missing', () => {
    expect(nowSentence('2026-10-06T10:05:00Z')).toBe('Now 10:05, from the feed clock.');
    expect(nowSentence(null)).toBe('The feed has no clock, so there is no now line.');
    expect(nowSentence('2026-10-06T02:30:00Z')).toBe(
      'Now 02:30, from the feed clock; it is before the 04:00 start of the axis.',
    );
    expect(nowSentence('2026-10-06T23:59:00Z')).toBe('Now 23:59, from the feed clock.');
  });

  it('describes why an unassigned duty has no bus', () => {
    const base = duty({ registrationNumber: null, state: 'no_bus' });
    expect(reasonSentence(duty())).toBeNull();
    expect(
      reasonSentence({ ...base, blockers: { notInYard: 2, offRoad: 1, dark: 0 } }),
    ).toBe(
      'No free ordinary bus. Held out of the matching: 2 not in the yard, 1 off road. Every other ordinary bus is on another duty.',
    );
    expect(reasonSentence({ ...base, blockers: { notInYard: 0, offRoad: 0, dark: 0 } })).toBe(
      'No free ordinary bus. Every ordinary bus the depot has is on another duty, or it has none.',
    );
  });

  it('names the spare buses, or says there are none', () => {
    expect(spareSentence([])).toBe('No bus is spare: every eligible bus has a duty.');
    expect(spareSentence(['A', 'B'])).toBe('2 buses are in the yard with no duty.');
    expect(spareSentence(['A'])).toBe('1 bus is in the yard with no duty.');
  });
});
