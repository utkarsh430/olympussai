import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import DepotIncidentsPage from '@/app/(protected)/project/depots/d/[depotId]/incidents/page';
import type { IncidentView } from '@/lib/depot/incident/api';
import { planReplacement } from '@/lib/depot/incident/replace';
import type { Incident, ReplacementInput } from '@/lib/depot/incident/types';
import { bannedOnScreen } from './depot-guard-rendered';

const hooks = vi.hoisted(() => ({ incidents: null as unknown, rollup: null as unknown }));

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('') }));
vi.mock('@/lib/depot/depotGate', () => ({ requireDepotPage: async (): Promise<void> => {} }));
vi.mock('@/lib/auth/server', () => ({ requireProjectSession: async (): Promise<void> => {} }));
vi.mock('@/components/depot/data/DepotDetailProvider', () => ({ useDepotDetailContext: (): unknown => ({ depotId: '7', data: null }) }));
vi.mock('@/components/depot/data/DepotNetworkProvider', () => ({
  useDepotNetworkContext: (): unknown => ({ data: { source: 'live', stale: false, feedNow: '2026-10-12T10:00:00Z' }, error: null }),
}));
vi.mock('@/hooks/useDepotIncidents', () => ({
  useDepotIncidents: (): unknown => hooks.incidents,
  useDeclareIncident: (): unknown => ({ declared: [], error: null, busy: false, declare: () => {}, withdraw: () => {} }),
  useIncidentRollup: (): unknown => hooks.rollup,
}));

const incident: Incident = {
  id: 'inc:UP32AB1234:2026-10-12', origin: 'detected', registrationNumber: 'UP32AB1234', depotId: '7', routeName: 'KANPUR-LUCKNOW', journeyId: 'J1',
  position: { lat: 26.5, lng: 80.3 }, stoppedMinutes: 14, signals: ['stopped_on_route'], confidence: 'medium',
  nearestStop: { name: 'Unnao', distanceM: 900, sequence: 4 }, profileState: 'profiled', scheduledEnd: '2026-10-12T12:30:00Z', lastHeardMin: 2,
};
const input: ReplacementInput = {
  incident, depotName: 'Kanpur', feedMinute: 600,
  remainingTrip: { stops: 6, km: 42.5, minutes: 150, destination: 'Lucknow' },
  passengersAboard: { value: 30, provenance: 'modelled' },
  ownSpares: [{ registrationNumber: 'UP32SP0001', position: { lat: 26.45, lng: 80.33 }, seats: 52 }],
  ownFerryDriverSlotsFree: 2,
  otherDepots: [{ depotId: '8', depotName: 'Unnao', position: { lat: 26.55, lng: 80.49 }, spares: 3, seats: 52, ferryDriverSlotsFree: 1 }],
  busesOnRoute: [{ registrationNumber: 'UP32FB0002', position: { lat: 26.47, lng: 80.25 }, seats: 52, aboard: 10, sequence: 2 }],
  blockEndingBuses: [],
  cycleMinutes: 135, busesOnRouteNow: 3, nextBusSeatsFree: 22,
  restOfBlock: { blockId: 'B1', remainingPieces: 2, endMin: 1200 },
  dayKnockOn: { blocksWithoutBusDelta: 1, uncoveredBusHoursDelta: 3 },
  roadTime: (a, b) => { const km = Math.hypot(a.lat - b.lat, a.lng - b.lng) * 111 * 1.3; return { km: Math.round(km * 10) / 10, minutes: (km / 30) * 60 }; },
};

describe('incident response', () => {
  const plan = planReplacement(input);
  const view: IncidentView = { incident, plan };

  it('ranks the replacements by passengers moving soonest, then dead km, and keeps the baseline', () => {
    expect(plan.recommended).not.toBeNull();
    const ranked = plan.candidates.filter((c) => c.excludedReason === null);
    for (let i = 1; i < ranked.length; i += 1) {
      const a = ranked[i - 1]!;
      const b = ranked[i]!;
      expect(a.passengersMovingMinutes! < b.passengersMovingMinutes! || (a.passengersMovingMinutes === b.passengersMovingMinutes && a.deadKm <= b.deadKm)).toBe(true);
    }
    expect(plan.baseline.kind).toBe('next_scheduled');
    expect(plan.candidates.some((c) => c.kind === 'following_bus' && c.direction === 'behind')).toBe(true);
  });

  it('renders the depot page with the recommendation, the two sentences and no provenance line', async () => {
    hooks.incidents = {
      data: { depotId: '7', depotName: 'Kanpur', operatingDate: '2026-10-12', feedNow: '2026-10-12T10:00:00Z', fetchedAt: '2026-10-12T10:00:05Z', source: 'live', stale: false, incidents: [view], detection: { considered: 40, excluded: { in_yard: 20 }, routesNotProfiled: 3 } },
      error: null, loading: false, refresh: () => {},
    };
    const html = renderToStaticMarkup(await DepotIncidentsPage({ params: Promise.resolve({ depotId: '7' }) }));
    expect(html).toContain('Incident Response');
    expect(html).toContain('UP32AB1234');
    expect(html).toContain('Recommendation only. Nothing is dispatched or assigned.');
    expect(html).not.toContain('depot-provenance-line');
    expect(html).not.toMatch(/\bmodel(led|ling|s)?\b/i);
    expect(bannedOnScreen(html)).toEqual([]);
  });

  it('renders the Headquarters roll-up', async () => {
    hooks.rollup = {
      data: { feedNow: '2026-10-12T10:00:00Z', fetchedAt: '2026-10-12T10:00:05Z', source: 'live', stale: false, operatingDate: '2026-10-12', rows: [{ depotId: '7', depotName: 'Kanpur', registrationNumber: 'UP32AB1234', routeName: 'KANPUR-LUCKNOW', origin: 'detected', confidence: 'medium', signals: ['stopped_on_route'], passengersAboard: 30, recommendedKind: 'own_yard_spare', recommendedDepotName: 'Kanpur', arrivalMinutes: 25, planState: 'ready' }], totals: { suspected: 1, high: 0, medium: 1, low: 0 }, planned: 2, pending: 1 },
      error: null, loading: false, refresh: () => {},
    };
    const { default: IncidentsRoutePage } = await import('@/app/(protected)/project/depots/incidents/page');
    const html = renderToStaticMarkup(await IncidentsRoutePage());
    expect(html).toContain('Incident Response');
    expect(html).toContain('Depots checked: 2 of 3');
    expect(html).toContain('Spare from the yard');
    expect(html).not.toContain('depot-provenance-line');
    expect(bannedOnScreen(html)).toEqual([]);
  });
});
