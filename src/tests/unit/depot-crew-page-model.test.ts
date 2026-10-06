import { describe, expect, it } from 'vitest';
import {
  AVAILABILITY_ORDER,
  AVAILABILITY_PATTERN,
  HATCHED_AVAILABILITY,
  SHORTFALL_EXPLANATION,
  coverageLine,
  crewDisclosure,
  modelledStatement,
  shortfallCounts,
} from '@/lib/depot/crew/crewPageModel';
import type { RoleShortfall } from '@/lib/depot/crew/types';

const none = (): readonly { readonly shortfalls: readonly RoleShortfall[] }[] => [];
const row = (...shortfalls: RoleShortfall[]): { readonly shortfalls: readonly RoleShortfall[] } => ({
  shortfalls,
});

describe('coverageLine', () => {
  it('says no relief is needed when every shift is covered', () => {
    expect(
      coverageLine(
        { shiftsRequired: 160, shiftsCovered: 160, shiftsUncovered: 0, dutiesNeedingRelief: 0 },
        none(),
      ),
    ).toBe('160 of 160 shifts covered; no relief needed.');
  });

  it('counts the per-role reasons of a shortfall', () => {
    const rows = [
      row({ role: 'driver', cause: 'no_slot_available' }, { role: 'conductor', cause: 'all_rostered' }),
      row({ role: 'conductor', cause: 'all_rostered' }),
      row({ role: 'driver', cause: 'hours_limit' }),
    ];
    expect(
      coverageLine(
        { shiftsRequired: 40, shiftsCovered: 37, shiftsUncovered: 3, dutiesNeedingRelief: 0 },
        rows,
      ),
    ).toBe(
      '37 of 40 shifts covered; 3 uncovered; drivers: 1 none available today, 1 hours limit; ' +
        'conductors: 2 all already rostered at the time.',
    );
  });

  it('says when the reasons are counted over a capped list', () => {
    const line = coverageLine(
      { shiftsRequired: 900, shiftsCovered: 600, shiftsUncovered: 300, dutiesNeedingRelief: 0 },
      [row({ role: 'driver', cause: 'no_slot_available' })],
    );
    expect(line).toContain('(counted over the shifts listed)');
  });
});

describe('shortfallCounts', () => {
  it('counts each role and cause on its own', () => {
    const counts = shortfallCounts([
      row({ role: 'driver', cause: 'all_rostered' }),
      row({ role: 'driver', cause: 'all_rostered' }),
    ]);
    expect(counts.driver.all_rostered).toBe(2);
    expect(counts.conductor.all_rostered).toBe(0);
  });
});

describe('availability patterns', () => {
  it('gives every availability word its own texture, so no two segments rely on colour', () => {
    const patterns = AVAILABILITY_ORDER.map((key) => AVAILABILITY_PATTERN[key]);
    expect(new Set(patterns).size).toBe(AVAILABILITY_ORDER.length);
  });

  it('keeps leave hatched and weekly off solid', () => {
    expect(HATCHED_AVAILABILITY).toContain('leave');
    expect(AVAILABILITY_PATTERN.weekly_off).toBe('grey');
  });
});

describe('crewDisclosure', () => {
  const summary = {
    shiftsRequired: 160,
    shiftsCovered: 160,
    shiftsUncovered: 0,
    driver: { required: 160, available: 169 },
    conductor: { required: 160, available: 150 },
    dutiesFullyCovered: 80,
    dutiesPartlyCovered: 0,
    dutiesUncovered: 0,
    dutiesNeedingRelief: 0,
  };
  const limits = { dailyHours: 10, weeklyHours: 48 };

  it('keeps the definitions, the modelled statement with its limits and the shortfall explanation', () => {
    const all = crewDisclosure(summary, limits)
      .flatMap((section) => section.lines)
      .join(' ');
    expect(all).toContain(modelledStatement(limits));
    expect(all).toContain(SHORTFALL_EXPLANATION);
    expect(all).toContain('some of which overlap.');
    expect(all).toContain('160 shifts are required today');
    expect(all).toContain('Nothing here is written back to any system.');
  });
});
