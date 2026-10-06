import { describe, expect, it } from 'vitest';
import { crewShiftsFor, rosterCrew } from '@/lib/depot/crew/roster';
import { MAX_DUTY_HOURS_PER_DAY, MAX_HOURS_PER_WEEK } from '@/lib/depot/crew/types';
import type { CrewRole, CrewShift, CrewSlot } from '@/lib/depot/crew/types';
import type { Duty } from '@/lib/depot/duties/types';
import { modelCrew } from '@/lib/depot/sim/crew';
import { modelDuties } from '@/lib/depot/sim/duties';
import { SeededRandom } from '@/lib/simulation/seededRandom';
import type { DepotSummary } from '@/lib/depot/types';

const depot = { id: 'D-7', name: 'Test' } as unknown as DepotSummary;
const DATE = '2026-10-06';
const LIMIT_MIN = MAX_DUTY_HOURS_PER_DAY * 60;

function duty(id: string, startMin: number, endMin: number): Duty {
  return {
    id,
    depotId: 'D-7',
    routeName: 'R_ORD',
    startMin,
    endMin,
    serviceClass: 'ordinary',
    provenance: 'MODELLED',
  } as unknown as Duty;
}

function slot(
  id: string,
  role: CrewRole,
  hoursThisWeek = 0,
  availability: CrewSlot['availability'] = 'available',
): CrewSlot {
  return { id, role, availability, hoursThisWeek };
}

const pair = (n: number, hours = 0): CrewSlot[] => [
  slot(`D-${String(n).padStart(3, '0')}`, 'driver', hours),
  slot(`C-${String(n).padStart(3, '0')}`, 'conductor', hours),
];

describe('crewShiftsFor', () => {
  it('keeps a duty within the daily limit as one shift, including exactly at the limit', () => {
    const { shifts, dutiesNeedingRelief } = crewShiftsFor([
      duty('001', 300, 600),
      duty('002', 300, 300 + LIMIT_MIN),
    ]);
    expect(shifts).toHaveLength(2);
    expect(shifts.every((s) => s.shiftIndex === 0 && s.shiftCount === 1)).toBe(true);
    expect(dutiesNeedingRelief).toBe(0);
  });

  it('splits 10.5 h into two of 5.25 h and 16 h into two of 8 h', () => {
    const a = crewShiftsFor([duty('001', 300, 930)]);
    expect(a.shifts.map((s) => [s.startMin, s.endMin])).toEqual([
      [300, 615],
      [615, 930],
    ]);
    const b = crewShiftsFor([duty('002', 240, 1200)]);
    expect(b.shifts.map((s) => s.endMin - s.startMin)).toEqual([480, 480]);
    expect(a.dutiesNeedingRelief + b.dutiesNeedingRelief).toBe(2);
  });

  it('uses the fewest shifts, each within the limit, covering the duty exactly', () => {
    for (const length of [601, 1199, 1200, 1201, 1799, 1800, 1801, 960]) {
      const { shifts } = crewShiftsFor([duty('001', 100, 100 + length)]);
      expect(shifts).toHaveLength(Math.ceil(length / LIMIT_MIN));
      expect(shifts.every((s) => s.endMin - s.startMin <= LIMIT_MIN)).toBe(true);
      expect(shifts.reduce((sum, s) => sum + (s.endMin - s.startMin), 0)).toBe(length);
      expect(shifts[0]?.startMin).toBe(100);
      expect(shifts[shifts.length - 1]?.endMin).toBe(100 + length);
    }
  });

  it('rejects zero or negative length duties with a typed outcome', () => {
    const out = crewShiftsFor([
      duty('001', 400, 400),
      duty('002', 400, 400),
      duty('003', 500, 450),
    ]);
    expect(out.shifts).toEqual([]);
    expect(out.invalidDutyIds).toEqual(['001', '002', '003']);
  });
});

describe('rosterCrew review focus', () => {
  it('shows a shortfall as uncovered duties instead of double-booking a slot', () => {
    const duties = [duty('001', 360, 600), duty('002', 400, 640), duty('003', 420, 660)];
    const summary = rosterCrew(duties, pair(1));
    expect(summary.dutiesFullyCovered).toBe(1);
    expect(summary.dutiesUncovered).toBe(2);
    const uncovered = summary.assignments.filter((a) => a.uncoveredReason !== null);
    expect(uncovered.map((a) => a.uncoveredReason)).toEqual([
      'no_available_crew',
      'no_available_crew',
    ]);
    expect(uncovered.every((a) => a.driverSlot === null && a.conductorSlot === null)).toBe(true);
    expect(uncovered.every((a) => a.shortRoles.length === 2)).toBe(true);
  });

  it('refuses a slot that would exceed the weekly limit and says why', () => {
    const summary = rosterCrew([duty('001', 360, 670)], pair(1, MAX_HOURS_PER_WEEK - 5));
    expect(summary.assignments[0]).toMatchObject({
      driverSlot: null,
      conductorSlot: null,
      uncoveredReason: 'hours_limit',
      shortRoles: ['driver', 'conductor'],
    });
  });

  it('reports no_available_crew when a short role had no slot, even if the other hit hours', () => {
    const crew = [slot('D-001', 'driver', MAX_HOURS_PER_WEEK - 1)];
    const summary = rosterCrew([duty('001', 360, 600)], crew);
    expect(summary.assignments[0]).toMatchObject({
      uncoveredReason: 'no_available_crew',
      shortRoles: ['driver', 'conductor'],
    });
    expect(summary.uncoveredByRole).toEqual({ driver: 1, conductor: 1 });
  });

  it('says only the conductor was short when drivers were fine', () => {
    const summary = rosterCrew([duty('001', 360, 600)], [slot('D-001', 'driver')]);
    expect(summary.assignments[0]?.shortRoles).toEqual(['conductor']);
    expect(summary.uncoveredByRole).toEqual({ driver: 0, conductor: 1 });
  });

  it('uses the next slot when the first is refused by hours', () => {
    const crew = [...pair(1, MAX_HOURS_PER_WEEK - 1), ...pair(2, 0)];
    const summary = rosterCrew([duty('001', 360, 600)], crew);
    expect(summary.assignments[0]).toMatchObject({ driverSlot: 'D-002', conductorSlot: 'C-002' });
  });

  it('refuses a second shift that would push a slot past the daily limit', () => {
    const fits = rosterCrew([duty('001', 300, 600), duty('002', 620, 900)], pair(1));
    expect(fits.dutiesFullyCovered).toBe(2);
    const long = [duty('001', 300, 600), duty('002', 600, 900), duty('003', 900, 1000)];
    const summary = rosterCrew(long, pair(1));
    expect(summary.dutiesFullyCovered).toBe(2);
    expect(summary.assignments[2]?.uncoveredReason).toBe('hours_limit');
  });
});

describe('rosterCrew shifts and relief', () => {
  it('covers a long duty with two shifts and reports it fully covered', () => {
    const crew = [...pair(1), ...pair(2)];
    const summary = rosterCrew([duty('001', 300, 930)], crew);
    expect(summary.shiftsRequired).toBe(2);
    expect(summary.shiftsCovered).toBe(2);
    expect(summary.dutiesFullyCovered).toBe(1);
    expect(summary.dutiesNeedingRelief).toBe(1);
    expect(summary.assignments.map((a) => [a.shiftIndex, a.shiftCount])).toEqual([
      [0, 2],
      [1, 2],
    ]);
    expect(summary.required).toEqual({ driver: 2, conductor: 2 });
  });

  it('lets one slot take the second shift of a duty it did not start', () => {
    const crew = [...pair(1), ...pair(2)];
    const duties = [duty('001', 300, 540), duty('002', 300, 930)];
    const summary = rosterCrew(duties, crew);
    const second = summary.assignments.find((a) => a.dutyId === '002' && a.shiftIndex === 1);
    expect(second?.driverSlot).toBe('D-001');
  });

  it('reports a duty partly covered when only one shift can be crewed', () => {
    const crew = [slot('D-001', 'driver'), slot('C-001', 'conductor')];
    const summary = rosterCrew([duty('001', 300, 930)], crew);
    expect(summary.shiftsCovered).toBe(1);
    expect(summary.dutiesPartlyCovered).toBe(1);
    expect(summary.dutiesFullyCovered + summary.dutiesUncovered).toBe(0);
    expect(summary.assignments[1]?.uncoveredReason).toBe('hours_limit');
  });

  it('counts invalid duties apart and keeps them out of the reconciliation', () => {
    const summary = rosterCrew([duty('001', 400, 400), duty('002', 400, 400)], pair(1));
    expect(summary.invalidDutyIds).toEqual(['001', '002']);
    expect(summary.assignments).toEqual([]);
    expect(summary.shiftsRequired).toBe(0);
  });
});

describe('rosterCrew boundaries and rules', () => {
  it('handles zero duties and zero crew', () => {
    const empty = rosterCrew([], pair(1));
    expect(empty.assignments).toEqual([]);
    expect(empty.required).toEqual({ driver: 0, conductor: 0 });
    expect(empty.available).toEqual({ driver: 1, conductor: 1 });
    const none = rosterCrew([duty('001', 360, 600)], []);
    expect(none.dutiesUncovered).toBe(1);
    expect(none.assignments[0]?.uncoveredReason).toBe('no_available_crew');
  });

  it('allows shifts that touch end to start on one slot', () => {
    const summary = rosterCrew([duty('001', 360, 480), duty('002', 480, 600)], pair(1));
    expect(summary.dutiesFullyCovered).toBe(2);
    expect(summary.assignments.map((a) => a.driverSlot)).toEqual(['D-001', 'D-001']);
  });

  it('ignores slots that are not available', () => {
    const crew = [
      slot('D-001', 'driver', 0, 'leave'),
      slot('C-001', 'conductor'),
      slot('D-002', 'driver'),
    ];
    const summary = rosterCrew([duty('001', 360, 600)], crew);
    expect(summary.assignments[0]?.driverSlot).toBe('D-002');
    expect(summary.byAvailability.leave).toBe(1);
    expect(summary.available).toEqual({ driver: 1, conductor: 1 });
  });

  it('does not book a driver when the conductor is missing', () => {
    const summary = rosterCrew([duty('001', 360, 600)], [slot('D-001', 'driver')]);
    expect(summary.assignments[0]).toMatchObject({ driverSlot: null, conductorSlot: null });
  });

  it('does not mutate its inputs and ignores their order', () => {
    const duties = modelDuties(
      depot,
      [
        { routeName: 'A_ORD', scheduledDurationMin: 300 },
        { routeName: 'B_EXP', scheduledDurationMin: null },
      ],
      30,
      DATE,
    ).duties;
    const crew = modelCrew(depot, crewShiftsFor(duties).shifts.length, DATE);
    const dutiesCopy = JSON.stringify(duties);
    const crewCopy = JSON.stringify(crew);
    const base = rosterCrew(duties, crew);
    expect(JSON.stringify(duties)).toBe(dutiesCopy);
    expect(JSON.stringify(crew)).toBe(crewCopy);
    const rng = new SeededRandom('shuffle');
    const shuffle = <T>(items: readonly T[]): T[] =>
      items
        .map((item) => ({ item, key: rng.float(0, 1) }))
        .sort((a, b) => a.key - b.key)
        .map((entry) => entry.item);
    expect(rosterCrew(shuffle(duties), shuffle(crew))).toEqual(base);
  });

  it('covers long-route duties once they are split into shifts', () => {
    const duties = modelDuties(
      depot,
      [{ routeName: 'A_ORD', scheduledDurationMin: 300 }],
      20,
      DATE,
    ).duties;
    const shifts = crewShiftsFor(duties).shifts;
    const summary = rosterCrew(duties, modelCrew(depot, shifts.length, DATE));
    expect(summary.shiftsRequired).toBe(shifts.length);
    expect(summary.shiftsCovered).toBeGreaterThan(0);
  });
});

function checkReconciles(
  duties: readonly Duty[],
  crew: readonly CrewSlot[],
  summary: ReturnType<typeof rosterCrew>,
): void {
  const valid = duties.length - summary.invalidDutyIds.length;
  expect(summary.shiftsCovered + summary.shiftsUncovered).toBe(summary.shiftsRequired);
  expect(summary.required.driver).toBe(summary.shiftsRequired);
  expect(summary.required.conductor).toBe(summary.shiftsRequired);
  expect(summary.dutiesFullyCovered + summary.dutiesPartlyCovered + summary.dutiesUncovered).toBe(
    valid,
  );
  const booked = new Map<string, CrewShift[]>();
  for (const a of summary.assignments) {
    const shift: CrewShift = a;
    for (const id of [a.driverSlot, a.conductorSlot]) {
      if (id !== null) booked.set(id, [...(booked.get(id) ?? []), shift]);
    }
    expect((a.driverSlot === null) === (a.uncoveredReason !== null)).toBe(true);
  }
  for (const [id, list] of booked) {
    const hours = list.reduce((sum, s) => sum + (s.endMin - s.startMin) / 60, 0);
    const base = (crew.find((s) => s.id === id) as CrewSlot).hoursThisWeek;
    expect(hours).toBeLessThanOrEqual(MAX_DUTY_HOURS_PER_DAY + 1e-9);
    expect(base + hours).toBeLessThanOrEqual(MAX_HOURS_PER_WEEK + 1e-9);
    for (const x of list) {
      for (const y of list) {
        if (x !== y) expect(x.startMin < y.endMin && y.startMin < x.endMin).toBe(false);
      }
    }
  }
}

describe('rosterCrew over many seeded duty sets', () => {
  it('never double-books, never exceeds either limit, and reconciles', () => {
    for (let seed = 0; seed < 60; seed += 1) {
      const rng = new SeededRandom(`roster-${seed}`);
      const duties = Array.from({ length: rng.int(0, 40) }, (_, i) => {
        const start = rng.int(240, 1300);
        return duty(String(i).padStart(3, '0'), start, start + rng.int(0, 960));
      });
      const date = `2026-10-${String(1 + (seed % 28)).padStart(2, '0')}`;
      const crew = modelCrew(depot, rng.int(0, 40), date);
      checkReconciles(duties, crew, rosterCrew(duties, crew));
    }
  });
});

const FORBIDDEN_TERMS = ['name', 'score', 'rank', 'rating', 'performance', 'speed', 'violation'];
/** Word stems that describe an individual, matched as a prefix of each camelCase word of a key. */
const FORBIDDEN_STEMS = ['name', 'scor', 'rank', 'rate', 'rating', 'perform', 'speed', 'violat'];
/** Legitimate keys that name a place, not a person. */
const ALLOWED_KEYS: readonly string[] = ['depotName', 'routeName'];

/** True when a key reads as a fact about an individual: a word of it starts with a forbidden stem. */
function isForbiddenKey(key: string): boolean {
  if (ALLOWED_KEYS.includes(key)) return false;
  const words = key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z]+/);
  return words.some((word) => FORBIDDEN_STEMS.some((stem) => word.startsWith(stem)));
}

/** Every key at every depth. */
function keysOf(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, out));
  else if (value !== null && typeof value === 'object') {
    for (const [key, v] of Object.entries(value)) {
      out.push(key);
      keysOf(v, out);
    }
  }
  return out;
}

/** Every string value as a lowercase word list, so only whole words can match. */
function valueWordsOf(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => valueWordsOf(v, out));
  else if (value !== null && typeof value === 'object') {
    Object.values(value).forEach((v) => valueWordsOf(v, out));
  } else if (typeof value === 'string') out.push(...value.toLowerCase().split(/[^a-z]+/));
  return out;
}

describe('people constraint', () => {
  it('has no forbidden key or value in the serialised crew or roster', () => {
    const duties = modelDuties(
      depot,
      [{ routeName: 'A_ORD', scheduledDurationMin: 200 }],
      25,
      DATE,
    ).duties;
    const crew = modelCrew(depot, crewShiftsFor(duties).shifts.length, DATE);
    const output = JSON.parse(JSON.stringify([crew, rosterCrew(duties, crew)]));
    expect(keysOf(output).filter(isForbiddenKey)).toEqual([]);
    const words = valueWordsOf(output);
    for (const term of FORBIDDEN_TERMS) expect(words).not.toContain(term);
  });

  it.each([
    'driverName',
    'safetyScore',
    'speedRating',
    'driverRank',
    'performanceIndex',
    'violations',
    'ranking',
    'name',
    'score',
  ])('the detector trips on %s', (key) => {
    expect(isForbiddenKey(key)).toBe(true);
  });

  it.each([
    'depotName',
    'routeName',
    'operatingDate',
    'driverSlot',
    'conductorSlot',
    'shortRoles',
    'shiftsCovered',
  ])('the detector lets %s through', (key) => {
    expect(isForbiddenKey(key)).toBe(false);
  });
});
