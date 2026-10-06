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
  barTextPlacement,
  barLabel,
  heldOutParts,
  nowLabel,
  nowLinePct,
  nowSentence,
  viewAnnouncement,
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
      '04:00',
      '06:00',
      '08:00',
      '10:00',
      '12:00',
      '14:00',
      '16:00',
      '18:00',
      '20:00',
      '22:00',
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
    expect(nowLinePct('2026-10-06T10:00:00Z')).toBe(30);
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
    // Rewritten for the design wave: an unmatched row says "Unmatched"; why is in its reason.
    expect(nobus?.stateWord).toBe('Unmatched');
    expect(away?.stateWord).toBe('Unmatched');
    expect(away?.reason).toContain('2 not in the yard');
    expect(assigned?.timeText).toBe('06:40 to 15:00');
    expect(assigned?.ariaLabel).toBe(
      'Route ORD_1, ordinary, 06:40 to 15:00 (modelled). Assigned: UP32A0001.',
    );
    expect(nobus?.ariaLabel).toContain('Unmatched');
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
      'Duties are a model until a timetable is supplied, and their lengths are generated, not timetabled. The matching of buses to duties is a recommendation: nothing is assigned or dispatched.',
    );
  });

  it("states the cost in the assignment module's own terms", () => {
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

  // Rewritten: the shared modelled-day sentence says there are no duties; this gives
  // only the cause, so an empty board has one "no duties" sentence, not two.
  it('explains an empty board by its cause alone', () => {
    expect(emptyDutiesSentence({ routeCount: 0, peakRequirement: 5 })).toBe(
      'None of its buses reports a route in the live feed, so there is nothing to run a duty on.',
    );
    expect(emptyDutiesSentence({ routeCount: 3, peakRequirement: 0 })).toBe(
      'The modelled peak requirement is zero buses.',
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
    expect(nowSentence('2026-10-06T10:05:00Z')).toBe('Now 10:05, the feed clock in Indian time.');
    expect(nowSentence(null)).toBe('The feed has no clock, so there is no now line.');
    expect(nowSentence('2026-10-06T02:30:00Z')).toBe(
      'Now 02:30, the feed clock in Indian time; it is before the 04:00 start of the axis.',
    );
    expect(nowSentence('2026-10-06T23:59:00Z')).toBe('Now 23:59, the feed clock in Indian time.');
  });

  it('describes why an unassigned duty has no bus, whatever its class (S55, N6)', () => {
    const base = duty({ registrationNumber: null, state: 'no_bus', serviceClass: 'express' });
    expect(reasonSentence(duty())).toBeNull();
    const held = { notInYard: 2, notHeard: 1, offRoad: 1, dark: 0 };
    expect(reasonSentence({ ...base, blockers: held })).toBe(
      'No eligible bus is left: every eligible bus has another duty. Held out of the matching: 1 not heard recently, 2 not in the yard, 1 off the road.',
    );
    expect(reasonSentence({ ...base, blockers: { notInYard: 0, offRoad: 0, dark: 0 } })).toBe(
      'No eligible bus is left: every eligible bus has another duty, or the depot has none.',
    );
    expect(reasonSentence({ ...base, blockers: held })).not.toMatch(/express/);
  });

  it('never says every eligible bus has a duty beside a matching that proposed none', () => {
    const none = counts({ duties: 158, assigned: 0, unassigned: 158, spare: 0 });
    const summary = summarySentence(none);
    const footer = spareSentence([], { assigned: none.assigned, locationIgnored: false });
    expect(summary).toBe(
      'MODELLED: 158 duties. The matching proposes a bus for 0 and leaves 158 without one; ' +
        'no bus is eligible, so none is spare.',
    );
    expect(footer).toBe('No bus is spare: no bus is eligible for a duty.');
    expect(`${summary} ${footer}`).not.toMatch(/every eligible bus has a duty|0 buses are spare/);
    expect(summarySentence(counts({ spare: 0 }))).toMatch(/; no bus is spare\.$/);
  });

  it('names the spare buses, or says there are none', () => {
    expect(spareSentence([])).toBe('No bus is spare.');
    expect(spareSentence([], { assigned: 3, locationIgnored: false })).toBe(
      'No bus is spare: every eligible bus has a duty.',
    );
    expect(spareSentence(['A', 'B'])).toBe('2 buses have no duty.');
    expect(spareSentence(['A'])).toBe('1 bus has no duty.');
  });

  it('says where the spare buses stand, never calling them all in the yard (S55, N2)', () => {
    const fifteen = Array.from({ length: 15 }, (_, i) => `B${i}`);
    const ctx = { assigned: 40, locationIgnored: false };
    expect(
      spareSentence(fifteen, { ...ctx, byStanding: { inYard: 5, standing: 0, onRoad: 10 } }),
    ).toBe('15 buses have no duty: 5 in the yard, 10 on the road.');
    expect(
      spareSentence(['A', 'B'], { ...ctx, byStanding: { inYard: 2, standing: 0, onRoad: 0 } }),
    ).toBe('2 buses are in the yard with no duty.');
    expect(
      spareSentence(['A', 'B'], { ...ctx, byStanding: { inYard: 0, standing: 2, onRoad: 0 } }),
    ).toBe('2 buses are standing with no duty.');
    expect(
      spareSentence(['A'], { ...ctx, byStanding: { inYard: 0, standing: 0, onRoad: 1 } }),
    ).toBe('1 bus is on the road with no duty.');
  });
});

describe('bar text placement', () => {
  // 'Assigned UP32A0001' is 18 characters: 18 * 7 + 12 = 138 px; the axis is 700 px wide.
  const LONG = 18;
  const NEEDED_PCT = (LONG * 7 + 12) / 7;

  it('keeps the text inside a bar that is wide enough, and puts it beside one that is not', () => {
    expect(barTextPlacement({ leftPct: 10, widthPct: NEEDED_PCT, textLength: LONG })).toBe(
      'inside',
    );
    expect(barTextPlacement({ leftPct: 10, widthPct: NEEDED_PCT - 0.1, textLength: LONG })).toBe(
      'right',
    );
  });

  it('decides from the label length: a short label fits a bar a long one does not', () => {
    const width = 9;
    expect(barTextPlacement({ leftPct: 10, widthPct: width, textLength: 7 })).toBe('inside');
    expect(barTextPlacement({ leftPct: 10, widthPct: width, textLength: LONG })).toBe('right');
  });

  it('goes to the left of a bar with no room on its right, and right at the exact boundary', () => {
    const w = 5;
    expect(barTextPlacement({ leftPct: 100 - w, widthPct: w, textLength: LONG })).toBe('left');
    const room = NEEDED_PCT;
    expect(barTextPlacement({ leftPct: 100 - w - room, widthPct: w, textLength: LONG })).toBe(
      'right',
    );
    expect(barTextPlacement({ leftPct: 100 - w - room + 0.1, widthPct: w, textLength: LONG })).toBe(
      'left',
    );
  });
});

// Rewritten for the design wave: the automatic fallback to the table above 60 duties is
// removed (the chart scrolls in a fixed pane), so the board always opens on the chart.
describe('bar labels and the now label', () => {
  it('labels a bar with its registration, or the state word when unmatched', () => {
    expect(barLabel({ registrationNumber: 'UP78JN1770', stateWord: 'Assigned' })).toBe(
      'UP78JN1770',
    );
    expect(barLabel({ registrationNumber: null, stateWord: 'Unmatched' })).toBe('Unmatched');
  });

  it('labels the now line with its time, and gives none off the axis', () => {
    expect(nowLabel('2026-10-05T14:04:00Z')).toBe('Now 14:04');
    expect(nowLabel('2026-10-05T02:00:00Z')).toBeNull();
    expect(nowLabel(null)).toBeNull();
  });

  it('words held-out buses by location only when location was used', () => {
    const blockers = { notInYard: 66, offRoad: 8, dark: 34 };
    expect(heldOutParts(blockers)).toEqual(['66 not in the yard', '8 off the road', '34 dark']);
    expect(heldOutParts(blockers, true)[0]).toBe('66 not standing on a recent report');
  });

  it('announces which view is showing and how many duties', () => {
    expect(viewAnnouncement('table', 120)).toBe('Showing the table, 120 duties');
    expect(viewAnnouncement('chart', 1)).toBe('Showing the chart, 1 duty');
  });
});
