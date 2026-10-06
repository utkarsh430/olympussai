import { describe, it, expect } from 'vitest';
import {
  AVAILABILITY_ORDER,
  PEOPLE_SENTENCE,
  ROSTER_NOTE,
  availabilitySegments,
  availabilityText,
  dutiesSentence,
  emptyCrewSentence,
  modelledStatement,
  pageOf,
  shortfallText,
  uncoveredCountSentence,
  reliefSentence,
  shiftLabel,
  shiftsSentence,
  strengthSentence,
} from '@/lib/depot/crew/crewPageModel';

const COUNTS = { available: 70, weekly_off: 14, leave: 6, training: 3, absent: 7 };
const ONE = { available: 1, weekly_off: 0, leave: 0, training: 0, absent: 0 };

describe('crew page wording', () => {
  it('says the people sentence exactly', () => {
    expect(PEOPLE_SENTENCE).toBe('Availability and rostering only. No individual is assessed.');
  });

  it('says the roster is a first-fit suggestion and nothing is assigned', () => {
    expect(ROSTER_NOTE).toMatch(/first-fit/);
    expect(ROSTER_NOTE).toMatch(/not an optimised/);
    expect(ROSTER_NOTE).toMatch(/Nothing is assigned or instructed/);
  });

  it('orders the segments and gives each a word, a count and a share', () => {
    const segments = availabilitySegments(COUNTS);
    expect(segments.map((s) => s.key)).toEqual([...AVAILABILITY_ORDER]);
    expect(segments.map((s) => s.label)).toEqual([
      'Available',
      'Weekly off',
      'On leave',
      'In training',
      'Absent',
    ]);
    expect(segments[0]).toMatchObject({ count: 70, widthPct: 70 });
    expect(segments.reduce((a, s) => a + s.widthPct, 0)).toBeCloseTo(100);
  });

  it('gives zero widths for an empty role, not NaN', () => {
    const empty = { available: 0, weekly_off: 0, leave: 0, training: 0, absent: 0 };
    expect(availabilitySegments(empty).every((s) => s.widthPct === 0)).toBe(true);
  });

  it('writes the text equivalent of the bar', () => {
    expect(availabilityText('driver', COUNTS)).toBe(
      'Drivers, 100 slots: 70 available, 14 weekly off, 6 on leave, 3 in training, 7 absent.',
    );
    expect(availabilityText('conductor', ONE)).toMatch(/^Conductors, 1 slot: 1 available/);
  });

  it('words each short role separately with its own cause', () => {
    expect(shortfallText([{ role: 'driver', cause: 'no_slot_available' }])).toBe(
      'Driver: no driver is available today.',
    );
    expect(
      shortfallText([
        { role: 'driver', cause: 'all_rostered' },
        { role: 'conductor', cause: 'hours_limit' },
      ]),
    ).toBe(
      'Driver: all available drivers are already rostered at this time. Conductor: would exceed the hours limit.',
    );
    expect(shortfallText([{ role: 'conductor', cause: 'all_rostered' }])).toBe(
      'Conductor: all available conductors are already rostered at this time.',
    );
    expect(shortfallText([])).not.toMatch(/ or /);
  });

  it('labels a shift with its place in the duty', () => {
    expect(shiftLabel({ dutyId: 'D-12', shiftIndex: 0, shiftCount: 1 })).toBe('D-12');
    expect(shiftLabel({ dutyId: 'D-12', shiftIndex: 1, shiftCount: 2 })).toBe('D-12, shift 2 of 2');
  });

  it('words shifts, singular and plural, and says MODELLED', () => {
    expect(shiftsSentence(1, 1, 0)).toMatch(
      /^1 shift is required today; 1 is covered and 0 are uncovered/,
    );
    expect(shiftsSentence(40, 38, 2)).toMatch(
      /^40 shifts are required today; 38 are covered and 2 are uncovered/,
    );
    expect(shiftsSentence(40, 39, 1)).toMatch(/39 are covered and 1 is uncovered/);
    expect(shiftsSentence(40, 39, 1)).toMatch(/MODELLED/);
  });

  it('words crew strength against need', () => {
    expect(strengthSentence('driver', { required: 40, available: 58 })).toBe(
      '58 drivers are available across the day for 40 shifts, some of which overlap.',
    );
    expect(strengthSentence('conductor', { required: 1, available: 1 })).toBe(
      '1 conductor is available across the day for 1 shift, some of which overlap.',
    );
  });

  it('words duty coverage and relief', () => {
    expect(dutiesSentence(10, 2, 1)).toBe('10 duties fully covered, 2 partly covered, 1 uncovered.');
    expect(reliefSentence(1)).toBe('1 duty needs a relief crew.');
    expect(reliefSentence(3)).toBe('3 duties need a relief crew.');
    expect(reliefSentence(0)).toBe('No duty needs a relief crew.');
  });

  it('states the empty case with its reason', () => {
    expect(emptyCrewSentence()).toMatch(/No duties are modelled for this depot/);
  });

  it('states what is modelled, the limits and the replacing feed', () => {
    const text = modelledStatement({ dailyHours: 10, weeklyHours: 48 });
    expect(text).toMatch(/crew strength/);
    expect(text).toMatch(/10 hours a day and 48 hours a week/);
    expect(text).toMatch(/crew roster and leave feed/);
    expect(text).toContain(
      'A shortfall here is an outcome of the model: a drawn mix of weekly off, leave, training and absence, and shifts that start together. It is not a finding about this depot.',
    );
    expect(text).not.toMatch(/simulated/i);
  });

  it('states the true uncovered count, capped or not', () => {
    expect(uncoveredCountSentence(3, 3)).toBe('3 uncovered shifts.');
    expect(uncoveredCountSentence(1, 1)).toBe('1 uncovered shift.');
    expect(uncoveredCountSentence(200, 1234)).toBe(
      'Showing the first 200 of 1,234 uncovered shifts, most pressing first.',
    );
  });

  it('pages rows without mutating them', () => {
    const rows = Array.from({ length: 45 }, (_, i) => i);
    expect(pageOf(rows, 0, 20)).toMatchObject({ page: 0, pageCount: 3, rows: rows.slice(0, 20) });
    expect(pageOf(rows, 2, 20).rows).toHaveLength(5);
    expect(pageOf(rows, 9, 20).page).toBe(2);
    expect(pageOf([], 0, 20)).toMatchObject({ page: 0, pageCount: 1, rows: [] });
  });
});
