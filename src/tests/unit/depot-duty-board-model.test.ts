import { describe, expect, it } from 'vitest';
import type { BoardDuty, DutyBoardCounts } from '@/lib/depot/duties/api';
import { formatMinute } from '@/lib/depot/format';
import {
  AXIS_END_MIN,
  AXIS_START_MIN,
  COST_SENTENCE,
  ELIGIBILITY_SENTENCE,
  MODEL_NOTICE,
  axisTicks,
  barGeometry,
  buildBoardRows,
  emptyDutiesSentence,
  formatSpanShort,
  barTextPlacement,
  barLabel,
  defaultBoardView,
  MIN_TRACK_PX,
  heldOutParts,
  nowLabel,
  nowLabelAnchor,
  nowLinePct,
  nowSentence,
  viewAnnouncement,
  routesWithoutDutySentence,
  spareSentence,
} from '@/lib/depot/duties/dutyBoardModel';
import { spareCaption } from '@/lib/depot/duties/dutyStanding';

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

describe('formatSpanShort', () => {
  // The timeline's label column leaves about 127 px for the times at 11 px mono (6.6 px a
  // character): 19 characters at most, so the label is never cut.
  const LABEL_CHARS = 19;

  it('writes a span in one day as start and end', () => {
    expect(formatSpanShort(420, 600)).toBe('07:00–10:00');
  });

  it('writes a span that ends after midnight with +1 day, short enough for the label', () => {
    expect(formatSpanShort(1035, 1525)).toBe('17:15–01:25 +1 day');
    expect(formatSpanShort(1035, 1525).length).toBeLessThanOrEqual(LABEL_CHARS);
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

  // "Matched", never "Assigned" (the page says nothing is
  // assigned); the class in title case; how the bus stands now on a matched row; and
  // no reason on any row (the reason is stated once above the chart).
  it('gives every row a state word, a time span, how its bus stands, and a text equivalent', () => {
    const [matched, nobus, away] = buildBoardRows([
      duty({ id: 'A', startMin: 400, busStanding: 'on_road', busClass: 'express' }),
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
    expect(matched?.stateWord).toBe('Matched');
    expect(nobus?.stateWord).toBe('Unmatched');
    expect(away?.stateWord).toBe('Unmatched');
    expect(matched?.classWord).toBe('Ordinary');
    expect(matched?.standingWord).toBe('On the road');
    expect(matched?.busClassWord).toBe('Express');
    expect(nobus?.standingWord).toBeNull();
    expect(matched?.timeText).toBe('06:40 to 15:00');
    expect(matched?.ariaLabel).toBe(
      'Route ORD_1, Ordinary, 06:40 to 15:00. Matched: UP32A0001, on the road now, an Express bus.',
    );
    expect(away?.ariaLabel).toBe('Route ORD_1, Ordinary, 07:00 to 15:00. Unmatched.');
    expect(JSON.stringify([nobus, away])).not.toMatch(/not in the yard|held out/i);
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

  // The exact sentences are pinned in
  // depot-duty-wording-branches.test.ts with the notes they sit beside.
  it("states the cost in the assignment module's own terms, in its tier order", () => {
    const order = ['out on the road', 'in service before', 'route’s duties', 'service class', 'feed time', 'wear'];
    const at = order.map((phrase) => COST_SENTENCE.indexOf(phrase));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(ELIGIBILITY_SENTENCE).not.toMatch(/heard in the last/);
    expect(COST_SENTENCE).not.toMatch(/optimal/i);
  });

  // Rewritten: the shared modelled-day sentence says there are no duties; this gives
  // only the cause, so an empty board has one "no duties" sentence, not two.
  it('explains an empty board by its cause alone', () => {
    expect(emptyDutiesSentence({ routeCount: 0, peakRequirement: 5 })).toBe(
      'None of its buses reports a route in the feed, so there is nothing to run a duty on.',
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

  // The per-row reason is gone (stated once above the chart; its
  // "whatever the class" pin moved to unmatchedLine in depot-duty-page-model), and the
  // summary sentence became the band, whose spare caption is checked here instead.
  it('never says every eligible bus has a duty beside a matching that proposed none', () => {
    const none = counts({ duties: 158, assigned: 0, unassigned: 158, spare: 0 });
    const footer = spareSentence([], { assigned: none.assigned, locationIgnored: false });
    expect(spareCaption(none)).toBe('none eligible');
    expect(footer).toBe('No bus is spare: no bus is eligible for a duty.');
    expect(footer).not.toMatch(/every eligible bus has a duty/);
  });

  it('names the spare buses, or says there are none', () => {
    expect(spareSentence([])).toBe('No bus is spare.');
    expect(spareSentence([], { assigned: 3, locationIgnored: false })).toBe(
      'No bus is spare: every eligible bus has a duty.',
    );
    expect(spareSentence(['A', 'B'])).toBe('2 buses have no duty.');
    expect(spareSentence(['A'])).toBe('1 bus has no duty.');
  });

  it('says where the spare buses stand, never calling them all in the yard', () => {
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

describe('the board view and the timeline width', () => {
  it('opens as a table below 640 px and as the chart from 640 px', () => {
    expect(defaultBoardView(true)).toBe('table');
    expect(defaultBoardView(false)).toBe('chart');
  });

  it('measures bar text against the narrowest track the fitted chart has (640 px wide)', () => {
    // 640 less two 16 px gutters, the 160 px duty column and the track's two 16 px insets.
    expect(MIN_TRACK_PX).toBe(640 - 32 - 160 - 32);
  });
});

describe('bar text placement', () => {
  // 'Assigned UP32A0001' is 18 characters: 18 * 7 + 12 = 138 px against the narrowest track.
  const LONG = 18;
  const NEEDED_PCT = ((LONG * 7 + 12) * 100) / MIN_TRACK_PX;

  it('keeps the text inside a bar that is wide enough, and puts it beside one that is not', () => {
    expect(barTextPlacement({ leftPct: 10, widthPct: NEEDED_PCT, textLength: LONG })).toBe(
      'inside',
    );
    expect(barTextPlacement({ leftPct: 10, widthPct: NEEDED_PCT - 0.1, textLength: LONG })).toBe(
      'right',
    );
  });

  it('decides from the label length: a short label fits a bar a long one does not', () => {
    // 7 characters need about 15% of the narrowest track, 18 about 33%.
    const width = 20;
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

// The automatic fallback to the table above 60 duties is
// removed (the chart scrolls in a fixed pane), so the board always opens on the chart.
describe('bar labels and the now label', () => {
  // An unmatched bar carries no word.
  it('labels a matched bar with its registration and an unmatched one with nothing', () => {
    expect(barLabel({ registrationNumber: 'UP78JN1770' })).toBe('UP78JN1770');
    expect(barLabel({ registrationNumber: null })).toBeNull();
  });

  it('keeps the now flag inside the axis near either end', () => {
    expect(nowLabelAnchor(50)).toBe('middle');
    expect(nowLabelAnchor(2)).toBe('start');
    expect(nowLabelAnchor(97)).toBe('end');
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
