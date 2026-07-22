import { describe, it, expect } from 'vitest';
import { buildScenario } from '@/lib/simulation/scenarioEngine';
import { SeededRandom, hashSeed, offsetCoordinate, haversineKm } from '@/lib/simulation/seededRandom';
import {
  canTransition,
  nextCommunicationState,
  COMMUNICATION_FLOW,
  buildCommunicationScenario,
  type CommunicationState,
} from '@/lib/demo-scenarios/communicationScenario';
import { FUTURE_IMPACT_KPIS } from '@/lib/demo-scenarios/impactScenario';
import type { CanonicalLiveBus } from '@/models/canonical';

const bus: CanonicalLiveBus = {
  id: 'UP25FT4823',
  registrationNumber: 'UP25FT4823',
  latitude: 28.356138,
  longitude: 79.42025,
  speedKmph: 38,
  headingDegrees: 253.2,
  depotName: 'ROHILKHAND',
  routeId: '6842',
  routeName: 'RKD_4560_ORD_OUT',
  serviceNumber: 'RKD0399',
  tripId: '30396',
  vehicleType: null,
  gpsTimestamp: '2026-07-20T10:00:00Z',
  lastUpdatedAt: '2026-07-20T10:00:05Z',
  ignitionOn: true,
  rawStatus: 'Live',
  tripDate: '2026-07-20',
  dataQuality: 'good',
};

const otherBus: CanonicalLiveBus = { ...bus, id: 'UP78KT8662', registrationNumber: 'UP78KT8662' };

describe('seeded randomness', () => {
  it('produces identical sequences for identical seeds', () => {
    const a = new SeededRandom('UP25FT4823');
    const b = new SeededRandom('UP25FT4823');
    const seqA = Array.from({ length: 12 }, () => a.int(0, 1000));
    const seqB = Array.from({ length: 12 }, () => b.int(0, 1000));
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = new SeededRandom('UP25FT4823');
    const b = new SeededRandom('UP78KT8662');
    const seqA = Array.from({ length: 12 }, () => a.int(0, 1000));
    const seqB = Array.from({ length: 12 }, () => b.int(0, 1000));
    expect(seqA).not.toEqual(seqB);
  });

  it('respects declared bounds', () => {
    const random = new SeededRandom('bounds');
    for (let i = 0; i < 400; i += 1) {
      const value = random.int(5, 9);
      expect(value).toBeGreaterThanOrEqual(5);
      expect(value).toBeLessThanOrEqual(9);
    }
  });

  it('hashes strings deterministically', () => {
    expect(hashSeed('UP25FT4823')).toBe(hashSeed('UP25FT4823'));
    expect(hashSeed('a')).not.toBe(hashSeed('b'));
  });

  it('throws rather than returning undefined when picking from an empty list', () => {
    const random = new SeededRandom('empty');
    expect(() => random.pick([])).toThrow();
  });
});

describe('geo helpers', () => {
  it('offsets a coordinate by roughly the requested distance', () => {
    const start = { lat: 28.356138, lng: 79.42025 };
    const moved = offsetCoordinate(start.lat, start.lng, 5, 90);
    const distance = haversineKm(start.lat, start.lng, moved.latitude, moved.longitude);
    expect(distance).toBeGreaterThan(4.9);
    expect(distance).toBeLessThan(5.1);
  });

  it('keeps offsets inside valid coordinate ranges', () => {
    const moved = offsetCoordinate(28.35, 79.42, 40, 315);
    expect(Math.abs(moved.latitude)).toBeLessThanOrEqual(90);
    expect(Math.abs(moved.longitude)).toBeLessThanOrEqual(180);
  });
});

describe('scenario determinism', () => {
  const kinds = ['bunching', 'traffic', 'breakdown', 'demand'] as const;

  for (const kind of kinds) {
    it(`produces identical ${kind} output for the same bus`, () => {
      const first = buildScenario(kind, { bus, schedule: null });
      const second = buildScenario(kind, { bus, schedule: null });
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    });

    it(`produces different ${kind} output for a different bus`, () => {
      const first = buildScenario(kind, { bus, schedule: null });
      const second = buildScenario(kind, { bus: otherBus, schedule: null });
      expect(JSON.stringify(first)).not.toBe(JSON.stringify(second));
    });

    it(`always produces a complete ${kind} analysis`, () => {
      const scenario = buildScenario(kind, { bus, schedule: null });
      expect(scenario.simulationLabel.length).toBeGreaterThan(3);
      expect(scenario.confidencePercent).toBeGreaterThan(0);
      expect(scenario.confidencePercent).toBeLessThanOrEqual(100);
      expect(scenario.observation.length).toBeGreaterThan(20);
      expect(scenario.recommendation.length).toBeGreaterThan(10);
      expect(scenario.actions.length).toBeGreaterThan(0);
    });

    it(`anchors the ${kind} scenario to the real bus position`, () => {
      const scenario = buildScenario(kind, { bus, schedule: null });
      const selected = scenario.markers.find((marker) => marker.isRealBus);
      expect(selected).toBeDefined();
      expect(selected?.latitude).toBeCloseTo(bus.latitude);
      expect(selected?.longitude).toBeCloseTo(bus.longitude);
    });
  }
});

describe('bunching scenario', () => {
  it('places one companion service ahead and one behind', () => {
    const scenario = buildScenario('bunching', { bus, schedule: null });
    if (scenario.kind !== 'bunching') throw new Error('wrong kind');

    expect(scenario.markers).toHaveLength(3);
    expect(scenario.markers.filter((m) => m.role === 'ahead')).toHaveLength(1);
    expect(scenario.markers.filter((m) => m.role === 'behind')).toHaveLength(1);
    expect(scenario.markers.filter((m) => m.isRealBus)).toHaveLength(1);
  });

  it('projects a wider forward gap after the hold', () => {
    const scenario = buildScenario('bunching', { bus, schedule: null });
    if (scenario.kind !== 'bunching') throw new Error('wrong kind');
    expect(scenario.projectedGapAheadAfter).toBeGreaterThan(scenario.gapAheadMinutes);
    expect(scenario.projectedGapBehindAfter).toBeLessThan(scenario.gapBehindMinutes);
  });

  it('honours presenter overrides', () => {
    const scenario = buildScenario('bunching', {
      bus,
      schedule: null,
      overrides: { gapAheadMinutes: 2, gapBehindMinutes: 30, bunchingRisk: 95, holdSeconds: 120 },
    });
    if (scenario.kind !== 'bunching') throw new Error('wrong kind');
    expect(scenario.gapAheadMinutes).toBe(2);
    expect(scenario.gapBehindMinutes).toBe(30);
    expect(scenario.riskPercent).toBe(95);
    expect(scenario.holdSeconds).toBe(120);
  });
});

describe('traffic scenario', () => {
  it('offers a recommended alternative that is faster than the congested route', () => {
    const scenario = buildScenario('traffic', { bus, schedule: null });
    if (scenario.kind !== 'traffic') throw new Error('wrong kind');

    const current = scenario.routes.find((route) => route.id === 'current');
    const alternative = scenario.routes.find((route) => route.isRecommended);
    expect(current).toBeDefined();
    expect(alternative).toBeDefined();
    expect(alternative!.etaMinutes).toBeLessThan(current!.etaMinutes);
  });

  it('always carries the dispatcher-authorization safety note', () => {
    const scenario = buildScenario('traffic', { bus, schedule: null });
    if (scenario.kind !== 'traffic') throw new Error('wrong kind');
    expect(scenario.safetyNote).toMatch(/dispatcher approval/i);
    expect(scenario.recommendations).toHaveLength(3);
  });

  it('produces a density curve that dips at the incident', () => {
    const scenario = buildScenario('traffic', { bus, schedule: null });
    if (scenario.kind !== 'traffic') throw new Error('wrong kind');

    const slowest = scenario.densityCurve.reduce((min, point) =>
      point.speedKmph < min.speedKmph ? point : min,
    );
    expect(Math.abs(slowest.distanceKm - scenario.distanceToCongestionKm)).toBeLessThan(2.5);
  });
});

describe('breakdown scenario', () => {
  it('generates the requested number of rescue candidates', () => {
    const scenario = buildScenario('breakdown', {
      bus,
      schedule: null,
      overrides: { rescueCandidateCount: 4 },
    });
    if (scenario.kind !== 'breakdown') throw new Error('wrong kind');
    expect(scenario.candidates).toHaveLength(4);
  });

  it('ranks the recommended candidate first with the best suitability', () => {
    const scenario = buildScenario('breakdown', { bus, schedule: null });
    if (scenario.kind !== 'breakdown') throw new Error('wrong kind');

    const recommended = scenario.candidates.find((c) => c.id === scenario.recommendedCandidateId);
    expect(recommended).toBe(scenario.candidates[0]);
    for (const candidate of scenario.candidates.slice(1)) {
      expect(recommended!.suitabilityScore).toBeGreaterThan(candidate.suitabilityScore);
    }
  });

  it('marks severity as critical', () => {
    const scenario = buildScenario('breakdown', { bus, schedule: null });
    expect(scenario.severity).toBe('critical');
    expect(scenario.severityText).toMatch(/critical/i);
  });
});

describe('demand scenario', () => {
  it('classifies routes into deficit and surplus', () => {
    const scenario = buildScenario('demand', { bus, schedule: null });
    if (scenario.kind !== 'demand') throw new Error('wrong kind');

    expect(scenario.routes.length).toBeGreaterThanOrEqual(3);
    expect(scenario.routes.some((route) => route.status === 'deficit')).toBe(true);
    expect(scenario.routes.some((route) => route.status === 'surplus')).toBe(true);
  });

  it('increases demand when the multiplier rises', () => {
    const base = buildScenario('demand', { bus, schedule: null, overrides: { demandMultiplier: 1 } });
    const surged = buildScenario('demand', {
      bus,
      schedule: null,
      overrides: { demandMultiplier: 1.8 },
    });
    if (base.kind !== 'demand' || surged.kind !== 'demand') throw new Error('wrong kind');

    expect(surged.routes[0]!.demandPercent).toBeGreaterThan(base.routes[0]!.demandPercent);
  });

  it('changes with the selected time window', () => {
    const morning = buildScenario('demand', { bus, schedule: null, overrides: { peakWindow: '08:00' } });
    const midday = buildScenario('demand', { bus, schedule: null, overrides: { peakWindow: '13:00' } });
    if (morning.kind !== 'demand' || midday.kind !== 'demand') throw new Error('wrong kind');

    expect(morning.routes[0]!.demandPercent).not.toBe(midday.routes[0]!.demandPercent);
  });

  it('applies the festival surge multiplier', () => {
    const normal = buildScenario('demand', { bus, schedule: null, overrides: { festivalSurge: false } });
    const festival = buildScenario('demand', { bus, schedule: null, overrides: { festivalSurge: true } });
    if (normal.kind !== 'demand' || festival.kind !== 'demand') throw new Error('wrong kind');

    expect(festival.routes[0]!.demandPercent).toBeGreaterThan(normal.routes[0]!.demandPercent);
  });
});

describe('communication state machine', () => {
  it('advances one step at a time through the full flow', () => {
    let state: CommunicationState | null = 'suggestion-generated';
    const visited: CommunicationState[] = [state];

    while (state) {
      const next: CommunicationState | null = nextCommunicationState(state);
      if (!next) break;
      visited.push(next);
      state = next;
    }

    expect(visited).toEqual(COMMUNICATION_FLOW);
  });

  it('allows only forward single-step transitions', () => {
    expect(canTransition('suggestion-generated', 'awaiting-review')).toBe(true);
    expect(canTransition('approved', 'message-prepared')).toBe(true);
  });

  it('rejects skipping states or moving backwards', () => {
    expect(canTransition('suggestion-generated', 'message-sent')).toBe(false);
    expect(canTransition('message-sent', 'approved')).toBe(false);
    expect(canTransition('suggestion-generated', 'suggestion-generated')).toBe(false);
  });

  it('returns null at the end of the flow', () => {
    expect(nextCommunicationState('monitoring-outcome')).toBeNull();
  });

  it('builds a bilingual draft carrying the no-real-driver banner', () => {
    const communication = buildCommunicationScenario(
      { bus, schedule: null },
      {
        scenarioKind: 'traffic',
        scenarioLabel: 'CORRIDOR ANALYSIS',
        suggestedAction: 'Maintain approved safe speed.',
        englishMessage: 'Traffic congestion is expected ahead.',
        hindiMessage: 'आगे यातायात की भीड़ की संभावना है।',
      },
    );

    expect(communication.message.demoBanner).toMatch(/NO DRIVER IS CONTACTED/);
    expect(communication.call.demoBanner).toMatch(/NO EXTERNAL CALL IS PLACED/);
    expect(communication.message.hindiMessage.length).toBeGreaterThan(0);
    expect(communication.message.registrationNumber).toBe(bus.registrationNumber);
    expect(communication.call.speakingPoints.length).toBeGreaterThan(0);
  });
});

describe('impact figures', () => {
  it('exposes the documented headline KPIs', () => {
    const byId = new Map(FUTURE_IMPACT_KPIS.map((kpi) => [kpi.id, kpi]));
    expect(byId.get('bunching')?.changePercent).toBe(-85);
    expect(byId.get('waiting')?.changePercent).toBe(-73);
    expect(byId.get('breakdown')?.changePercent).toBe(-58);
    expect(byId.get('utilization')?.changePercent).toBe(15);
    expect(byId.get('otp')?.changePercent).toBe(31);
    expect(byId.get('dispatcher')?.changePercent).toBe(-44);
  });

  it('keeps direction consistent with the sign of the change', () => {
    for (const kpi of FUTURE_IMPACT_KPIS) {
      if (kpi.direction === 'reduction') expect(kpi.changePercent).toBeLessThan(0);
      else expect(kpi.changePercent).toBeGreaterThan(0);
    }
  });
});
