// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import type { DepotBusView } from '@/lib/depot/api';
import { heldOutParts } from '@/lib/depot/duties/dutyBoardModel';
import type { Duty, PlanNow } from '@/lib/depot/duties/types';
import type { BusLocation } from '@/lib/depot/infer/types';
import { resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { buildDutyBoard } from '@/lib/depot/live/dutyView';
import { assignDuties } from '@/lib/depot/optimise/assignDuties';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';
import type { BusOpState } from '@/lib/depot/types';
import type { DepotBusRow } from '@/models/depotLive';

/*
 * Ruling S55, review N3 and N4: every bus, moving or standing, must have been
 * heard recently (the module's reporting window) to be eligible, and a bus
 * held out for that has its own reason, "not heard recently". With no feed
 * clock recency cannot be judged: the check is skipped and the board says so.
 */

const AT_TEN: PlanNow = { kind: 'feed_time', feedMinute: 600 };

function bus(
  reg: string,
  state: BusOpState,
  location: BusLocation,
  ageMin: number | null,
): DepotBusView {
  const notHeardMin = ageMin !== null && ageMin > 30 ? ageMin : null;
  return { registrationNumber: reg, state, location, routeName: 'R', gpsAgeMin: ageMin, notHeardMin } as
    unknown as DepotBusView;
}

const duty: Duty = {
  id: '1', depotId: 'D', routeName: 'R', startMin: 300, endMin: 780, serviceClass: 'ordinary',
  provenance: 'modelled',
};

describe('recency decides eligibility for every bus (S55, N3, N4)', () => {
  it('holds out a bus last seen moving hours ago, and runs the yard bus heard a minute ago', () => {
    const buses = [bus('A', 'on_road', 'away', 300), bus('B', 'standing', 'in_yard', 1)];
    const plan = assignDuties([duty], buses, new Map(), { now: AT_TEN });
    expect(plan.excluded).toEqual([{ registrationNumber: 'A', reason: 'not_heard' }]);
    expect(plan.assignments[0]?.registrationNumber).toBe('B');
  });

  it('says "not heard", never "not in the yard", of a standing bus last reported in the yard', () => {
    const plan = assignDuties([duty], [bus('A', 'standing', 'in_yard', 120)], new Map(), {
      now: AT_TEN,
    });
    expect(plan.excluded).toEqual([{ registrationNumber: 'A', reason: 'not_heard' }]);
  });

  it('skips the check when the feed has no clock, rather than hold every bus out', () => {
    const plan = assignDuties([duty], [bus('A', 'standing', 'in_yard', null)], new Map(), {
      now: { kind: 'no_feed_clock' },
    });
    expect(plan.excluded).toEqual([]);
    expect(plan.assignments[0]?.registrationNumber).toBe('A');
  });

  it('words the count of buses not heard recently on its own', () => {
    expect(heldOutParts({ notInYard: 2, notHeard: 3, offRoad: 0, dark: 1 })).toEqual([
      '3 not heard recently',
      '2 not in the yard',
      '1 dark',
    ]);
  });
});

const FEED_NOW = '2026-10-06T08:00:00Z';

function row(i: number, over: Partial<DepotBusRow> = {}): DepotBusRow {
  return {
    registrationNumber: `A${i}`, latitude: 26.85, longitude: 80.95, speedKmph: 0, ignitionOn: false,
    gpsTimestamp: FEED_NOW, receivedAt: FEED_NOW, depotId: '1', depotName: 'Alambagh',
    vehicleStatus: 'stationary', tripStatus: 'Stationary', routeId: null, routeName: `ORD_${i % 3}`,
    routeDescription: null, journeyId: null, journeyCode: null, scheduledStart: null,
    scheduledEnd: null, actualStart: null, delayMinutes: null, odometerRaw: null, mainPowerOn: true,
    mainVoltage: null, tamperCode: 'C', emergency: false, ...over,
  };
}

function view(feedNow: string | null, rows: readonly DepotBusRow[]): FleetSnapshotView {
  return {
    rows, feedNow, fetchedAt: '2026-10-06T08:00:05.000Z', source: 'live', stale: false,
    recordCount: rows.length,
  };
}

beforeEach(() => resetAnalysisForTests());

describe('the duty board and recency (S55, N3)', () => {
  it('with no feed clock, gives duties to standing buses and says recency was not judged', () => {
    const rows = Array.from({ length: 8 }, (_, i) => row(i));
    const b = buildDutyBoard(view(null, rows), '1');
    expect(b?.counts.assigned).toBeGreaterThan(0);
    expect(b?.counts.excluded.notInYard).toBe(0);
    expect(b?.recencyNotJudged).toBe(true);
    expect(buildDutyBoard(view(FEED_NOW, [...rows]), '1')?.recencyNotJudged).toBe(false);
  });

  it('counts a stale yard bus as not heard recently', () => {
    const rows = [
      ...Array.from({ length: 8 }, (_, i) => row(i)),
      row(9, { gpsTimestamp: '2026-10-06T06:00:00Z' }),
    ];
    const b = buildDutyBoard(view(FEED_NOW, rows), '1');
    expect(b?.counts.excluded.notHeard).toBe(1);
    expect(b?.counts.excluded.notInYard).toBe(0);
  });
});

describe('the spare buses are counted by where they stand (S55, N2)', () => {
  it('splits 50 in service and 5 in the yard over 40 duties into 10 on the road and 5 in the yard', () => {
    const buses = [
      ...Array.from({ length: 50 }, (_, i) => bus(`S${String(i).padStart(2, '0')}`, 'in_service', 'away', 1)),
      ...Array.from({ length: 5 }, (_, i) => bus(`Y${i}`, 'standing', 'in_yard', 1)),
    ];
    const duties = Array.from({ length: 40 }, (_, i) => ({ ...duty, id: `D${i}` }));
    const plan = assignDuties(duties, buses, new Map(), { now: AT_TEN });
    expect(plan.spareBuses).toHaveLength(15);
    expect(plan.spareByStanding).toEqual({ inYard: 5, standing: 0, onRoad: 10 });
  });

  it('sends the split on the board', () => {
    const rows = Array.from({ length: 8 }, (_, i) => row(i));
    const b = buildDutyBoard(view(FEED_NOW, rows), '1');
    const split = b?.counts.spareByStanding;
    expect(split).toBeDefined();
    expect((split?.inYard ?? 0) + (split?.standing ?? 0) + (split?.onRoad ?? 0)).toBe(b?.counts.spare);
  });
});
