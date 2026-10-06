import { describe, expect, it } from 'vitest';
import type { BoardDuty, DutyBoardCounts, DutyBoardResponse } from '@/lib/depot/duties/api';
import { buildBoardRows, COST_SENTENCE, ELIGIBILITY_SENTENCE } from '@/lib/depot/duties/dutyBoardModel';
import { matchingNotes, unmatchedLine } from '@/lib/depot/duties/dutyPageModel';
import type { PlanMode } from '@/lib/depot/duties/types';
import type { ServiceClass } from '@/lib/depot/sim/types';

/*
 * Review m-d, m-e, m-f and ruling S62: every sentence the duty page states about
 * how buses were matched, reached through each combination of the response's
 * mode, clock, yard and counts. Each is true for the response it is printed for.
 */

type Notes = Pick<
  DutyBoardResponse,
  'counts' | 'eligibilityIgnoredLocation' | 'recencyNotJudged' | 'planMode'
>;

const HELD = { notInYard: 2, notHeard: 1, offRoad: 1, dark: 0 };
const NONE = { notInYard: 0, notHeard: 0, offRoad: 0, dark: 0 };

const counts = (assigned: number, excluded: DutyBoardCounts['excluded']): DutyBoardCounts => ({
  duties: assigned + 3,
  assigned,
  unassigned: 3,
  spare: 0,
  excluded,
});

const YARD_FEED =
  'A bus not heard in the last 30 minutes is held out of the matching, moving or standing; a standing bus must also be in the yard.';
const NO_YARD_FEED =
  'No yard is established for this depot, so location is not used: every bus heard in the last 30 minutes that is not off the road or dark is eligible, standing or out on the road.';
const NO_CLOCK = 'The feed has no clock, so no bus could be judged by how recently it was heard.';
const YARD_NO_CLOCK = 'A standing bus must be in the yard to be eligible.';
const NO_YARD_NO_CLOCK =
  'No yard is established for this depot, so location is not used: every bus that is not off the road or dark is eligible, standing or out on the road.';
const BEFORE_YARD =
  'Before the first departure: buses are matched as they stand in the yard. No duty has started, so only a bus standing in the yard is eligible, and being out on the road or the feed time does not count.';
const BEFORE_NO_YARD =
  'Before the first departure: no duty has started, so how buses stand now does not count. No yard is established for this depot, so every bus that is not off the road or dark is eligible.';

describe('how eligibility was judged, for each mode, clock and yard (S62, m-d)', () => {
  const cases: readonly (readonly [PlanMode | undefined, boolean, boolean, readonly string[]])[] = [
    ['as_of_feed_time', false, false, [YARD_FEED]],
    [undefined, false, false, [YARD_FEED]],
    ['as_of_feed_time', false, true, [NO_YARD_FEED]],
    ['as_of_feed_time', true, false, [NO_CLOCK, YARD_NO_CLOCK]],
    ['as_of_feed_time', true, true, [NO_CLOCK, NO_YARD_NO_CLOCK]],
    ['before_first_duty', false, false, [BEFORE_YARD]],
    ['before_first_duty', false, true, [BEFORE_NO_YARD]],
  ];
  for (const [planMode, noClock, noYard, expected] of cases) {
    it(`${planMode ?? 'no mode sent'}, ${noClock ? 'no clock' : 'clock'}, ${noYard ? 'no yard' : 'yard'}`, () => {
      const response: Notes = {
        counts: { ...counts(1, NONE), unassigned: 0 },
        planMode,
        recencyNotJudged: noClock,
        eligibilityIgnoredLocation: noYard,
      };
      const notes = matchingNotes(response);
      expect(notes).toEqual(expected);
      // With no clock, nothing claims a recency window.
      if (noClock) expect(notes.join(' ')).not.toMatch(/heard in the last/);
    });
  }

  it('states only what holds in every mode in the fixed sentences', () => {
    expect(ELIGIBILITY_SENTENCE).toBe('A bus off the road or dark is never matched to a duty.');
    expect(COST_SENTENCE).toBe(
      'Once the day’s first duty has started, the matching gives duties first to buses already out on the road, buses in service before buses merely moving, then to standing buses. It gives a route’s duties to buses running that route and prefers a bus of the duty’s service class; once the day has begun it also fits buses to the feed time. Among what is left it minimises total wear: a bus costs its age in years times the duty length in whole hours, so longer duties go to younger buses.',
    );
  });
});

describe('why duties have no bus (m-e)', () => {
  it('says every eligible bus has another duty only when a bus was eligible', () => {
    expect(unmatchedLine({ counts: counts(2, HELD) })).toBe(
      'No bus for 3 duties: every eligible bus has another duty. Held out of the matching: 1 not heard recently · 2 not in the yard · 1 off the road.',
    );
    expect(unmatchedLine({ counts: counts(2, NONE) })).toBe(
      'No bus for 3 duties: every eligible bus has another duty.',
    );
  });

  it('says no bus is eligible, with the counts by reason, when none was', () => {
    expect(unmatchedLine({ counts: counts(0, HELD) })).toBe(
      'No bus for 3 duties: no bus is eligible. Held out of the matching: 1 not heard recently · 2 not in the yard · 1 off the road.',
    );
    expect(unmatchedLine({ counts: counts(0, NONE) })).toBe(
      'No bus for 3 duties: the feed shows no bus for this depot.',
    );
  });
});

const duty = (serviceClass: ServiceClass, busClass: ServiceClass): BoardDuty => ({
  id: 'D',
  routeName: 'R',
  startMin: 300,
  endMin: 600,
  serviceClass,
  registrationNumber: 'UP1',
  busStanding: 'in_yard',
  busClass,
  state: 'assigned',
  blockers: null,
});

describe('the article before a class name (m-f)', () => {
  const cases: readonly (readonly [ServiceClass, string])[] = [
    ['premium', 'a Premium bus'],
    ['express', 'an Express bus'],
    ['ordinary', 'an Ordinary bus'],
    ['ac', 'an AC bus'],
  ];
  for (const [busClass, phrase] of cases) {
    it(`reads "${phrase}"`, () => {
      const dutyClass: ServiceClass = busClass === 'ordinary' ? 'express' : 'ordinary';
      const [row] = buildBoardRows([duty(dutyClass, busClass)]);
      expect(row?.ariaLabel).toContain(`, ${phrase}.`);
    });
  }
});
