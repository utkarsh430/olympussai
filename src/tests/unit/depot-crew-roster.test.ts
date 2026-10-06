import { describe, expect, it } from 'vitest';
import { rosterCrew } from '@/lib/depot/crew/roster';
import { MAX_DUTY_HOURS_PER_DAY, MAX_HOURS_PER_WEEK } from '@/lib/depot/crew/types';
import type { CrewRole, CrewSlot } from '@/lib/depot/crew/types';
import type { Duty } from '@/lib/depot/duties/types';
import { modelCrew } from '@/lib/depot/sim/crew';
import { modelDuties } from '@/lib/depot/sim/duties';
import { SeededRandom } from '@/lib/simulation/seededRandom';
import type { DepotSummary } from '@/lib/depot/types';

const depot = { id: 'D-7', name: 'Test' } as unknown as DepotSummary;
const DATE = '2026-10-06';

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

describe('rosterCrew review focus', () => {
  it('shows a shortfall as uncovered duties instead of double-booking a slot', () => {
    const duties = [duty('001', 360, 600), duty('002', 400, 640), duty('003', 420, 660)];
    const summary = rosterCrew(duties, pair(1));
    expect(summary.assignedDuties).toBe(1);
    expect(summary.uncoveredDuties).toBe(2);
    const covered = summary.assignments.filter((a) => a.uncoveredReason === null);
    expect(covered).toHaveLength(1);
    const uncovered = summary.assignments.filter((a) => a.uncoveredReason !== null);
    expect(uncovered.map((a) => a.uncoveredReason)).toEqual(['no_available_crew', 'no_available_crew']);
    expect(uncovered.every((a) => a.driverSlot === null && a.conductorSlot === null)).toBe(true);
  });

  it('refuses a slot that would exceed the weekly limit and says why', () => {
    const crew = [...pair(1, MAX_HOURS_PER_WEEK - 5)];
    const summary = rosterCrew([duty('001', 360, 660)], crew); // 5h20 shift, 5h left
    expect(summary.assignments[0]).toMatchObject({
      driverSlot: null,
      conductorSlot: null,
      uncoveredReason: 'hours_limit',
    });
  });

  it('uses the next slot when the first is refused by hours', () => {
    const crew = [...pair(1, MAX_HOURS_PER_WEEK - 1), ...pair(2, 0)];
    const summary = rosterCrew([duty('001', 360, 600)], crew);
    expect(summary.assignments[0]).toMatchObject({ driverSlot: 'D-002', conductorSlot: 'C-002' });
  });

  it('refuses a second duty that would push a slot past the daily limit', () => {
    const duties = [duty('001', 300, 600), duty('002', 620, 900)]; // 5h + 4h40 = 9h40 fits
    expect(rosterCrew(duties, pair(1)).assignedDuties).toBe(2);
    const long = [duty('001', 300, 600), duty('002', 600, 900), duty('003', 900, 1000)];
    // 5h + 5h = 10h exactly is allowed; a third 1h40 takes it over.
    const summary = rosterCrew(long, pair(1));
    expect(summary.assignedDuties).toBe(2);
    expect(summary.assignments[2]?.uncoveredReason).toBe('hours_limit');
  });
});

describe('rosterCrew boundaries and rules', () => {
  it('handles zero duties and zero crew', () => {
    const empty = rosterCrew([], pair(1));
    expect(empty.assignments).toEqual([]);
    expect(empty.required).toEqual({ driver: 0, conductor: 0 });
    expect(empty.available).toEqual({ driver: 1, conductor: 1 });
    const none = rosterCrew([duty('001', 360, 600)], []);
    expect(none.uncoveredDuties).toBe(1);
    expect(none.assignments[0]?.uncoveredReason).toBe('no_available_crew');
  });

  it('allows duties that touch end to start on one slot', () => {
    const summary = rosterCrew([duty('001', 360, 480), duty('002', 480, 600)], pair(1));
    expect(summary.assignedDuties).toBe(2);
    expect(summary.assignments.map((a) => a.driverSlot)).toEqual(['D-001', 'D-001']);
  });

  it('covers a duty exactly at the daily limit and refuses one a minute over', () => {
    const limit = MAX_DUTY_HOURS_PER_DAY * 60;
    const at = rosterCrew([duty('001', 300, 300 + limit)], pair(1));
    expect(at.assignedDuties).toBe(1);
    expect(at.dutiesOverDailyLimit).toBe(0);
    const over = rosterCrew([duty('001', 300, 301 + limit)], pair(1));
    expect(over.assignments[0]?.uncoveredReason).toBe('hours_limit');
    expect(over.dutiesOverDailyLimit).toBe(1);
    // Even with no crew at all, the reason for a too-long duty is the limit.
    expect(rosterCrew([duty('001', 300, 301 + limit)], []).assignments[0]?.uncoveredReason).toBe(
      'hours_limit',
    );
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
    const crew = modelCrew(depot, 30, DATE);
    const dutiesCopy = JSON.stringify(duties);
    const crewCopy = JSON.stringify(crew);
    const base = rosterCrew(duties, crew);
    expect(JSON.stringify(duties)).toBe(dutiesCopy);
    expect(JSON.stringify(crew)).toBe(crewCopy);
    const rng = new SeededRandom('shuffle');
    const shuffle = <T,>(items: readonly T[]): T[] =>
      items
        .map((item) => ({ item, key: rng.float(0, 1) }))
        .sort((a, b) => a.key - b.key)
        .map((entry) => entry.item);
    expect(rosterCrew(shuffle(duties), shuffle(crew))).toEqual(base);
  });

  it('is deterministic and reconciles on the modelled depot', () => {
    const duties = modelDuties(depot, [{ routeName: 'A_ORD', scheduledDurationMin: 200 }], 40, DATE)
      .duties;
    const crew = modelCrew(depot, duties.length, DATE);
    const a = rosterCrew(duties, crew);
    expect(rosterCrew(duties, crew)).toEqual(a);
    expect(a.required).toEqual({ driver: 40, conductor: 40 });
    expect(a.assignedDuties + a.uncoveredDuties).toBe(40);
  });
});

describe('rosterCrew over many seeded duty sets', () => {
  it('never double-books, never exceeds either limit, and reconciles', () => {
    for (let seed = 0; seed < 60; seed += 1) {
      const rng = new SeededRandom(`roster-${seed}`);
      const duties = Array.from({ length: rng.int(0, 40) }, (_, i) => {
        const start = rng.int(240, 1300);
        return duty(String(i).padStart(3, '0'), start, start + rng.int(60, 720));
      });
      const crew = modelCrew(depot, rng.int(0, 30), `2026-10-${String(1 + (seed % 28)).padStart(2, '0')}`);
      const summary = rosterCrew(duties, crew);
      expect(summary.assignedDuties + summary.uncoveredDuties).toBe(duties.length);
      expect(summary.required.driver).toBe(duties.length);
      const byId = new Map(duties.map((d) => [d.id, d]));
      const booked = new Map<string, Duty[]>();
      for (const a of summary.assignments) {
        const d = byId.get(a.dutyId) as Duty;
        for (const id of [a.driverSlot, a.conductorSlot]) {
          if (id !== null) booked.set(id, [...(booked.get(id) ?? []), d]);
        }
        expect((a.driverSlot === null) === (a.uncoveredReason !== null)).toBe(true);
      }
      for (const [id, list] of booked) {
        const hours = list.reduce((sum, d) => sum + (d.endMin - d.startMin) / 60, 0);
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
  });

  it('serialises without a name, score, rank, rating, performance, speed or violation', () => {
    const duties = modelDuties(depot, [{ routeName: 'A_ORD', scheduledDurationMin: 200 }], 25, DATE)
      .duties;
    const text = JSON.stringify([
      modelCrew(depot, 25, DATE),
      rosterCrew(duties, modelCrew(depot, 25, DATE)),
    ]).toLowerCase();
    for (const term of ['name', 'score', 'rank', 'rating', 'performance', 'speed', 'violation']) {
      expect(text).not.toContain(term);
    }
  });
});
