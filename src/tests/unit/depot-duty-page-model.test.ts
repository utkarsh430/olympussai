import { describe, expect, it } from 'vitest';
import type { BoardDuty, DutyBoardCounts } from '@/lib/depot/duties/api';
import {
  duplicateRowsSentence,
  dutiesModelledDay,
  dutyFigures,
  emptyBoardSentence,
  locationIgnoredSentence,
  matchingNotes,
  unmatchedLine,
} from '@/lib/depot/duties/dutyPageModel';

const counts = (over: Partial<DutyBoardCounts> = {}): DutyBoardCounts => ({
  duties: 160,
  assigned: 44,
  unassigned: 116,
  spare: 16,
  excluded: { notInYard: 66, notHeard: 12, offRoad: 8, dark: 34 },
  ...over,
});

const matched = (busStanding: BoardDuty['busStanding']): BoardDuty => ({
  id: 'D',
  routeName: 'R',
  startMin: 300,
  endMin: 600,
  serviceClass: 'ordinary',
  registrationNumber: 'UP1',
  busStanding,
  busClass: 'ordinary',
  state: 'assigned',
  blockers: null,
});

describe('dutyFigures', () => {
  // The Matched caption splits by how the bus stands now and the
  // Spare caption comes from counts.spareByStanding.
  it('gives the four figures in order, with captions from how the buses stand', () => {
    const figures = dutyFigures({
      counts: counts({ spareByStanding: { inYard: 5, standing: 0, onRoad: 11 } }),
      duties: [matched('on_road'), matched('in_yard'), matched('in_yard')],
    });
    expect(figures.map((f) => [f.label, f.value, f.caption])).toEqual([
      ['Duties', '160', 'in the modelled day'],
      ['Matched', '44', '1 on the road, 2 from the yard'],
      ['Unmatched', '116', 'no bus'],
      ['Spare buses', '16', '5 in the yard, 11 on the road'],
    ]);
  });

  it('never calls an ineligible fleet "spare"', () => {
    const none = dutyFigures({ counts: counts({ assigned: 0, spare: 0 }), duties: [] });
    expect(none[3]?.caption).toBe('none eligible');
  });
});

describe('unmatchedLine', () => {
  // "Not heard recently" counted first; no class named.
  it('states the reason once, as counts of every class', () => {
    expect(unmatchedLine({ counts: counts() })).toBe(
      'No bus for 116 duties: every eligible bus has another duty. Held out of the matching: 12 not heard recently · 66 not in the yard · 8 off the road · 34 dark.',
    );
  });

  it('never says "not in the yard" when location was ignored', () => {
    const line = unmatchedLine({ counts: counts(), eligibilityIgnoredLocation: true }) ?? '';
    expect(line).toContain('66 not standing on a recent report');
    expect(line).not.toContain('not in the yard');
  });

  it('is absent when every duty has a bus, and names no class when nothing was held out', () => {
    expect(unmatchedLine({ counts: counts({ unassigned: 0 }) })).toBeNull();
    const plain = unmatchedLine({
      counts: counts({ unassigned: 1, excluded: { notInYard: 0, offRoad: 0, dark: 0 } }),
    });
    expect(plain).toBe('No bus for 1 duty: every eligible bus has another duty.');
    expect(plain).not.toMatch(/class|ordinary|express/i);
  });
});

describe('server context sentences', () => {
  it('says location is not used only when it is not, and drops recency without a clock', () => {
    // Rewritten for m2: a bus out on the road is eligible too, so it is named.
    expect(locationIgnoredSentence(true, false)).toBe(
      'No yard is established for this depot, so location is not used: every bus heard in the last 30 minutes that is not off the road or dark is eligible, standing or out on the road.',
    );
    expect(locationIgnoredSentence(true, true)).toBe(
      'No yard is established for this depot, so location is not used: every bus that is not off the road or dark is eligible, standing or out on the road.',
    );
    expect(locationIgnoredSentence(false, false)).toBeNull();
    expect(locationIgnoredSentence(undefined, undefined)).toBeNull();
  });

  // Every eligibility note is reached in
  // depot-duty-wording-branches.test.ts; here only the order of the notes.
  it('says why duties have no bus first, then how eligibility was judged', () => {
    const notes = matchingNotes({
      counts: counts(),
      eligibilityIgnoredLocation: true,
      recencyNotJudged: true,
    });
    expect(notes).toHaveLength(3);
    expect(notes[0]).toMatch(/^No bus for 116 duties/);
    expect(notes[1]).toContain('The feed has no clock');
    expect(matchingNotes({ counts: counts({ unassigned: 0 }) })).toHaveLength(1);
  });

  it('counts repeated registrations left out', () => {
    expect(duplicateRowsSentence(2)).toBe('2 feed rows repeated a registration and were left out.');
    expect(duplicateRowsSentence(1)).toBe('1 feed row repeated a registration and was left out.');
    expect(duplicateRowsSentence(0)).toBeNull();
  });
});

describe('the modelled day on the duty page: one formula, plain dates', () => {
  it('prints the shared modelledDayLine formula with the feed schedule coverage', () => {
    expect(
      dutiesModelledDay({
        operatingDate: '2026-10-06',
        duties: [{ routeName: 'A' }, { routeName: 'B' }, { routeName: 'A' }],
        scheduled: { n: 8, of: 200 },
      }),
    ).toBe(
      'Built on the modelled day for 6 Oct 2026: 3 duties on 2 routes; the feed schedules 8 of 200 buses.',
    );
  });

  it('names the plain date in the empty board sentence, never the raw one', () => {
    const sentence = emptyBoardSentence('2026-10-06');
    expect(sentence).toContain('No duties are modelled for this depot for 6 Oct 2026');
    expect(sentence).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
