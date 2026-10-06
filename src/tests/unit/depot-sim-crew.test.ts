import { describe, expect, it } from 'vitest';
import { modelCrew } from '@/lib/depot/sim/crew';
import { MAX_HOURS_PER_WEEK } from '@/lib/depot/crew/types';
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

  it('is never smaller than the duty count per role', () => {
    for (const duties of [1, 2, 3, 10, 57]) {
      const crew = modelCrew(depot, duties, DATE);
      expect(count(crew, 'driver')).toBeGreaterThanOrEqual(duties);
      expect(count(crew, 'conductor')).toBeGreaterThanOrEqual(duties);
    }
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

  it('models no crew for zero duties and rejects a bad count', () => {
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
});
