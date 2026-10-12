import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import DepotSchedulePage from '@/app/(protected)/project/depots/d/[depotId]/schedule/page';
import type { DepotBusView } from '@/lib/depot/api';
import type { CrewSlot } from '@/lib/depot/crew/types';
import { planSchedule } from '@/lib/depot/schedule/planSchedule';
import type { ScheduleInput } from '@/lib/depot/schedule/types';
import { needInputsFor } from '@/lib/depot/service/need';
import { planDay } from '@/lib/depot/sim/dayPlan';
import { modelBus } from '@/lib/depot/sim/fleetMaster';
import type { DepotSummary } from '@/lib/depot/types';
import { bannedOnScreen } from './depot-guard-rendered';

const hooks = vi.hoisted(() => ({ schedule: null as unknown }));

vi.mock('@/lib/depot/depotGate', () => ({ requireDepotPage: async (): Promise<void> => {} }));
vi.mock('@/components/depot/data/DepotDetailProvider', () => ({
  useDepotDetailContext: (): unknown => ({ depotId: '7', data: null }),
}));
vi.mock('@/components/depot/data/DepotNetworkProvider', () => ({
  useDepotNetworkContext: (): unknown => ({ data: { source: 'live', stale: false, feedNow: '2026-10-12T10:00:00Z' }, error: null }),
}));
vi.mock('@/hooks/useDepotSchedule', () => ({ useDepotSchedule: (): unknown => hooks.schedule }));
vi.mock('@/hooks/useScheduleWhatIf', () => ({
  useScheduleWhatIf: (): unknown => ({ data: null, error: null, busy: false, run: () => {}, reset: () => {} }),
}));

const depot = { id: '7', name: 'Kanpur', kind: 'depot' } as unknown as DepotSummary;
const bus = (reg: string): DepotBusView =>
  ({ registrationNumber: reg, state: 'standing', location: 'in_yard', gpsAgeMin: 1, notHeardMin: null, routeName: null }) as unknown as DepotBusView;
const slots = (role: 'driver' | 'conductor', n: number): CrewSlot[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${role[0]?.toUpperCase()}-${i + 1}`, role, availability: 'available', hoursThisWeek: 8 }));
const BOARDINGS = [0, 0, 0, 0, 0, 65, 65, 65, 65, 65, 30, 30, 30, 30, 0, 0, 65, 65, 65, 0, 0, 0, 0, 0];

function planFor(): ReturnType<typeof planSchedule> {
  const buses = ['UP1', 'UP2', 'UP3', 'UP4', 'UP5', 'UP6'].map(bus);
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
        operatorBuses: [{ depotId: '7', buses: 6 }],
        deadKm: null,
      },
    ],
    crewPool: [...slots('driver', 12), ...slots('conductor', 12)],
    holds: [],
    baselinePlan: planDay({ depot, buses, peakRequirement: 4, operatingDate: '2026-10-12', yardEstablished: true, now: { kind: 'no_feed_clock' } }),
  };
  return planSchedule(input);
}

describe('the depot AI Scheduler page', () => {
  it('shows the plan with the two fixed sentences and no provenance line or banned word', async () => {
    const plan = planFor();
    hooks.schedule = {
      data: { depotId: '7', depotName: 'Kanpur', operatingDate: '2026-10-12', feedNow: '2026-10-12T10:00:00Z', fetchedAt: '2026-10-12T10:00:05Z', source: 'live', stale: false, plan, planKey: 'abc', limits: { surgePercent: { min: -50, max: 100 }, targetLoad: { min: 0.5, max: 1 }, blockMinutes: { min: 240, max: 960 }, turnaroundMinutes: { min: 0, max: 180 } } },
      error: null,
      loading: false,
      refresh: () => {},
    };
    const html = renderToStaticMarkup(await DepotSchedulePage({ params: Promise.resolve({ depotId: '7' }) }));
    expect(html).toContain('AI Scheduler');
    expect(html).toContain('Recommendation only. Nothing is dispatched or assigned.');
    expect(html).toContain('Availability and rostering only. No individual is assessed.');
    expect(html).toContain('Every hour of need is covered.');
    expect(html).not.toContain('depot-provenance-line');
    expect(html).not.toMatch(/\bmodel(led|ling|s)?\b/i);
    expect(bannedOnScreen(html)).toEqual([]);
  });
});
