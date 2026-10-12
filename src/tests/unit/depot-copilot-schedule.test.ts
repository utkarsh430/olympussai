import { describe, expect, it } from 'vitest';
import type { DepotBusView } from '@/lib/depot/api';
import {
  buildScheduleRationale,
  scheduleShiftCoverAnswer,
  scheduleSummaryAnswer,
  scheduleUncoveredAnswer,
  schedulerSummaryAnswer,
} from '@/lib/depot/copilot/facts/schedule';
import { renderDraft } from '@/lib/depot/copilot/render';
import type { CopilotRequest } from '@/lib/depot/copilot/types';
import type { CrewSlot } from '@/lib/depot/crew/types';
import { planSchedule } from '@/lib/depot/schedule/planSchedule';
import type { ScheduleInput } from '@/lib/depot/schedule/types';
import { needInputsFor } from '@/lib/depot/service/need';
import { planDay } from '@/lib/depot/sim/dayPlan';
import { modelBus } from '@/lib/depot/sim/fleetMaster';
import type { DepotSummary } from '@/lib/depot/types';

const depot = { id: '7', name: 'KANPUR', kind: 'depot' } as unknown as DepotSummary;
const bus = (reg: string): DepotBusView =>
  ({ registrationNumber: reg, state: 'standing', location: 'in_yard', gpsAgeMin: 1, notHeardMin: null, routeName: null }) as unknown as DepotBusView;
const slots = (role: 'driver' | 'conductor', n: number): CrewSlot[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${role[0]?.toUpperCase()}-${i + 1}`, role, availability: 'available', hoursThisWeek: 8 }));
const BOARDINGS = [0, 0, 0, 0, 0, 65, 65, 65, 65, 65, 30, 30, 30, 30, 0, 0, 65, 65, 65, 0, 0, 0, 0, 0];

function planFor(busCount: number, drivers: number) {
  const buses = Array.from({ length: busCount }, (_, i) => bus(`UP${i + 1}`));
  const need = needInputsFor({ routeName: 'KANPUR-LUCKNOW', ledger: [], profileDurationMin: 120 });
  const input: ScheduleInput = {
    depot,
    operatingDate: '2026-10-12',
    now: { kind: 'no_feed_clock' },
    buses,
    fleet: new Map(buses.map((b) => [b.registrationNumber, modelBus(b.registrationNumber, null)])),
    yardEstablished: true,
    routes: [
      {
        need: { routeName: 'KANPUR-LUCKNOW', boardingsByHour: BOARDINGS, need, neededByHour: [], provenance: 'modelled' },
        timing: { journeyMinutes: 120, layoverMinutes: 15, cycleMinutes: 135, provenance: 'derived' },
        operatorBuses: [{ depotId: '7', buses: busCount }],
        deadKm: null,
      },
    ],
    crewPool: [...slots('driver', drivers), ...slots('conductor', 12)],
    holds: [],
    baselinePlan: planDay({ depot, buses, peakRequirement: 4, operatingDate: '2026-10-12', yardEstablished: true, now: { kind: 'no_feed_clock' } }),
  };
  return { plan: planSchedule(input), depotName: 'KANPUR' };
}

const PLACEHOLDER = /\{\{fact:[^}]+\}\}/g;
const prose = (r: CopilotRequest): string => [r.scriptedDraft.headline, ...r.scriptedDraft.paragraphs].join(' ');

const covered = planFor(6, 12);
const short = planFor(2, 1);
const rollup = {
  feedNow: null, fetchedAt: '2026-10-12T10:00:05Z', source: 'live' as const, stale: false, operatingDate: '2026-10-12',
  depots: [{ depotId: '7', depotName: 'KANPUR', busesScheduled: 5, busesToday: 6, busesFreed: 1, crewSlotsUsed: { driver: 8, conductor: 8 }, crewSlotsToday: { driver: 9, conductor: 9 }, crewHours: 60, crewHoursToday: 70, uncoveredBusHours: 0, deadKm: null, routes: 2, planKey: 'abc' }],
  planned: 1, pending: 2, total: 3, summary: { busesFreed: 1, crewSlotsFreed: 2, uncoveredBusHours: 0, depotsWithUncovered: 0 },
};

const REQUESTS: readonly [string, CopilotRequest][] = [
  ['summary covered', scheduleSummaryAnswer(covered)],
  ['summary short', scheduleSummaryAnswer(short)],
  ['shift cover covered', scheduleShiftCoverAnswer(covered)],
  ['shift cover short', scheduleShiftCoverAnswer(short)],
  ['uncovered none', scheduleUncoveredAnswer(covered)],
  ['uncovered some', scheduleUncoveredAnswer(short)],
  ['scheduler roll-up', schedulerSummaryAnswer(rollup)],
  ['scheduler empty', schedulerSummaryAnswer({ ...rollup, depots: [] })],
  ['rationale covered', buildScheduleRationale(covered)],
  ['rationale short', buildScheduleRationale(short)],
];

describe('the AI Engine schedule answers', () => {
  it.each(REQUESTS)('%s renders through the vocabulary with no digit and no origin word in its prose', (_label, request) => {
    const rendered = renderDraft(request.scriptedDraft, request.facts);
    expect(rendered).toMatchObject({ ok: true });
    expect(prose(request).replace(PLACEHOLDER, ' ')).not.toMatch(/\d/);
    expect(prose(request)).not.toMatch(/\bmodel(led|ling|s)?\b|\bsimulated\b/i);
    expect(request.refuseWords).toContain('modelled');
  });

  it('says where the need is short when buses are too few', () => {
    expect(short.plan.uncovered.length).toBeGreaterThan(0);
    expect(scheduleUncoveredAnswer(short).facts.some((f) => f.id === 'unc.1.name')).toBe(true);
  });
});
