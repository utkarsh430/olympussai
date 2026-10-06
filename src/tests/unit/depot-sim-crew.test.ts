import { describe, expect, it } from 'vitest';
import { CREW_PER_SHIFT, CREW_RESERVE_SLOTS, modelCrew } from '@/lib/depot/sim/crew';
import { crewShiftsFor, rosterCrew } from '@/lib/depot/crew/roster';
import { MAX_HOURS_PER_WEEK } from '@/lib/depot/crew/types';
import { modelDuties } from '@/lib/depot/sim/duties';
import { HOURS_THIS_WEEK_RANGE } from '@/lib/depot/sim/crew';
import type { CrewSlot } from '@/lib/depot/crew/types';
import type { DepotSummary } from '@/lib/depot/types';

const depot = { id: 'D-7', name: 'Test' } as unknown as DepotSummary;
const other = { id: 'D-8', name: 'Other' } as unknown as DepotSummary;
const DATE = '2026-10-06';
const count = (crew: readonly CrewSlot[], role: string): number =>
  crew.filter((slot) => slot.role === role).length;

describe('modelCrew', () => {
  it('is deterministic for a depot and date', () => {
    expect(modelCrew(depot, 40, DATE)).toEqual(modelCrew(depot, 40, DATE));
  });

  it('keeps slot ids and strength when the date changes but changes the absence mix', () => {
    const a = modelCrew(depot, 60, DATE);
    const b = modelCrew(depot, 60, '2026-10-07');
    expect(b.map((slot) => slot.id)).toEqual(a.map((slot) => slot.id));
    expect(b.map((slot) => slot.availability)).not.toEqual(a.map((slot) => slot.availability));
  });

  it('numbers slots per depot as a role letter and zero-padded number', () => {
    const crew = modelCrew(depot, 5, DATE);
    expect(crew[0]?.id).toMatch(/^[DC]-\d{3}$/);
    expect(crew.filter((s) => s.role === 'driver').every((s) => s.id.startsWith('D-'))).toBe(true);
    expect(crew.filter((s) => s.role === 'conductor').every((s) => s.id.startsWith('C-'))).toBe(
      true,
    );
    expect(new Set(crew.map((s) => s.id)).size).toBe(crew.length);
    expect(modelCrew(other, 5, DATE).map((s) => s.id)).toEqual(crew.map((s) => s.id));
  });

  it('is never smaller than the shift count per role', () => {
    for (const duties of [1, 2, 3, 10, 57]) {
      const crew = modelCrew(depot, duties, DATE);
      expect(count(crew, 'driver')).toBeGreaterThanOrEqual(duties);
      expect(count(crew, 'conductor')).toBeGreaterThanOrEqual(duties);
    }
  });

  it('gives each role the ratio plus a fixed reserve of two slots', () => {
    expect(CREW_RESERVE_SLOTS).toBe(2);
    for (const shifts of [1, 5, 20, 40, 100]) {
      const crew = modelCrew(depot, shifts, DATE);
      for (const role of ['driver', 'conductor'] as const) {
        const ratio = Math.max(shifts, Math.ceil(shifts * CREW_PER_SHIFT[role]));
        expect(count(crew, role)).toBe(ratio + CREW_RESERVE_SLOTS);
      }
    }
  });

  it('keeps the slot ids of a small depot the same on every date', () => {
    const ids = (date: string): string[] => modelCrew(depot, 20, date).map((s) => s.id);
    expect(ids('2026-10-06')).toEqual(ids('2026-11-17'));
  });

  it('seeds hours inside the weekly limit and a mix of availabilities', () => {
    const crew = modelCrew(depot, 200, DATE);
    expect(crew.every((s) => s.hoursThisWeek >= 0 && s.hoursThisWeek <= MAX_HOURS_PER_WEEK)).toBe(
      true,
    );
    const kinds = new Set(crew.map((s) => s.availability));
    expect(kinds).toEqual(new Set(['available', 'weekly_off', 'leave', 'training', 'absent']));
    expect(crew.filter((s) => s.availability === 'available').length).toBeGreaterThan(
      crew.length / 2,
    );
  });

  it('models no crew for zero shifts and rejects a bad count', () => {
    expect(modelCrew(depot, 0, DATE)).toEqual([]);
    expect(() => modelCrew(depot, -1, DATE)).toThrow(RangeError);
    expect(() => modelCrew(depot, 1.5, DATE)).toThrow(RangeError);
  });

  it('carries no name, score or performance field', () => {
    const text = JSON.stringify(modelCrew(depot, 30, DATE));
    for (const term of ['name', 'score', 'rank', 'rating', 'performance', 'speed', 'violation']) {
      expect(text.toLowerCase()).not.toContain(term);
    }
  });

  it('keeps most slots able to take a shift this week', () => {
    expect(HOURS_THIS_WEEK_RANGE.max).toBeLessThan(MAX_HOURS_PER_WEEK);
    const crew = modelCrew(depot, 200, DATE);
    expect(crew.every((s) => s.hoursThisWeek <= HOURS_THIS_WEEK_RANGE.max)).toBe(true);
  });

  it('shows a small but non-zero shortfall on some dates, bounded by depot size', () => {
    // Observed over these 28 seeded dates (worst day, mean): 20 shifts 15%, 2.5%;
    // 40 shifts 10%, 1.6%; 100 shifts 7%, 0.4%. Bounds leave a little headroom.
    const MAX_MEAN_SHORTFALL_SHARE = 0.05;
    for (const [id, count, minutes, maxShare] of [
      ['D-20', 20, 200, 0.2],
      ['D-40', 40, 200, 0.15],
      ['D-100', 100, 200, 0.1],
    ] as const) {
      const typical = { id, name: 'T' } as unknown as DepotSummary;
      const shares = Array.from({ length: 28 }, (_, day) => {
        const date = `2026-10-${String(day + 1).padStart(2, '0')}`;
        const routes = [{ routeName: 'A_ORD', scheduledDurationMin: minutes }];
        const duties = modelDuties(typical, routes, count, date).duties;
        const shifts = crewShiftsFor(duties).shifts.length;
        const summary = rosterCrew(duties, modelCrew(typical, shifts, date));
        return summary.shiftsUncovered / summary.shiftsRequired;
      });
      expect(shares.some((share) => share > 0)).toBe(true);
      expect(Math.max(...shares)).toBeLessThanOrEqual(maxShare);
      expect(shares.reduce((a, b) => a + b, 0) / shares.length).toBeLessThan(
        MAX_MEAN_SHORTFALL_SHARE,
      );
    }
  });
});
