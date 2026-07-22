import { describe, it, expect } from 'vitest';
import {
  ALERT_ROTATION,
  buildAlert,
  buildInitialAlerts,
  buildNextAlert,
  selectAlertCandidate,
} from '@/lib/alerts/alertEngine';
import type { CanonicalLiveBus } from '@/models/canonical';

function makeBus(overrides: Partial<CanonicalLiveBus> = {}): CanonicalLiveBus {
  return {
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
    ...overrides,
  };
}

const fleet: CanonicalLiveBus[] = Array.from({ length: 24 }, (_, index) =>
  makeBus({
    id: `UP25FT${4800 + index}`,
    registrationNumber: `UP25FT${4800 + index}`,
    latitude: 28.3 + index * 0.01,
    longitude: 79.4 + index * 0.01,
    dataQuality: index % 5 === 0 ? 'stale' : 'good',
    routeName: index % 7 === 0 ? null : `ROUTE_${index}`,
  }),
);

describe('alert anchoring to real vehicles', () => {
  it('carries the real registration, depot, route and position', () => {
    const bus = makeBus();
    const alert = buildAlert('bunching', bus);

    expect(alert.registrationNumber).toBe(bus.registrationNumber);
    expect(alert.busId).toBe(bus.id);
    expect(alert.depotName).toBe(bus.depotName);
    expect(alert.routeName).toBe(bus.routeName);
    expect(alert.latitude).toBe(bus.latitude);
    expect(alert.longitude).toBe(bus.longitude);
  });

  it('produces a usable title, summary and confidence', () => {
    for (const kind of ALERT_ROTATION) {
      const alert = buildAlert(kind, makeBus());
      expect(alert.title.length).toBeGreaterThan(5);
      expect(alert.summary.length).toBeGreaterThan(10);
      expect(alert.confidencePercent).toBeGreaterThan(0);
      expect(alert.confidencePercent).toBeLessThanOrEqual(100);
      expect(alert.severityText.length).toBeGreaterThan(5);
    }
  });

  it('starts unacknowledged', () => {
    expect(buildAlert('traffic', makeBus()).acknowledged).toBe(false);
  });

  it('is deterministic for the same vehicle and kind', () => {
    const at = new Date('2026-07-20T10:00:00Z');
    const first = buildAlert('breakdown', makeBus(), at);
    const second = buildAlert('breakdown', makeBus(), at);
    expect(first).toEqual(second);
  });
});

describe('initial alert seeding', () => {
  it('seeds exactly five alerts', () => {
    expect(buildInitialAlerts(fleet, 5)).toHaveLength(5);
  });

  it('seeds exactly one vehicle-fault alert', () => {
    const breakdowns = buildInitialAlerts(fleet, 5).filter((a) => a.kind === 'breakdown');
    expect(breakdowns).toHaveLength(1);
  });

  it('fills the remaining slots with headway and corridor conditions only', () => {
    const rest = buildInitialAlerts(fleet, 5).filter((a) => a.kind !== 'breakdown');
    expect(rest).toHaveLength(4);
    for (const alert of rest) expect(['bunching', 'traffic']).toContain(alert.kind);
  });

  it('alternates the non-incident slots evenly', () => {
    const rest = buildInitialAlerts(fleet, 5).filter((a) => a.kind !== 'breakdown');
    expect(rest.filter((a) => a.kind === 'bunching')).toHaveLength(2);
    expect(rest.filter((a) => a.kind === 'traffic')).toHaveLength(2);
  });

  it('uses a distinct vehicle per seeded alert', () => {
    const alerts = buildInitialAlerts(fleet, 5);
    expect(new Set(alerts.map((alert) => alert.busId)).size).toBe(alerts.length);
  });

  it('orders newest first with staggered timestamps', () => {
    const alerts = buildInitialAlerts(fleet, 5);
    for (let index = 1; index < alerts.length; index += 1) {
      expect(Date.parse(alerts[index - 1]!.raisedAt)).toBeGreaterThan(
        Date.parse(alerts[index]!.raisedAt),
      );
    }
  });

  it('returns an empty list when no vehicles are available', () => {
    expect(buildInitialAlerts([], 5)).toEqual([]);
  });

  it('degrades gracefully when the fleet is smaller than the requested count', () => {
    expect(buildInitialAlerts([makeBus()], 5).length).toBeGreaterThan(0);
  });
});

describe('rotation', () => {
  it('alternates bunching and traffic', () => {
    const kinds = [0, 1, 2, 3, 4, 5].map(
      (index) => buildNextAlert(fleet, index, new Set())?.kind,
    );
    expect(kinds).toEqual(['bunching', 'traffic', 'bunching', 'traffic', 'bunching', 'traffic']);
  });

  it('never raises a vehicle fault or demand alert on the ongoing stream', () => {
    for (let index = 0; index < 40; index += 1) {
      const kind = buildNextAlert(fleet, index, new Set())?.kind;
      expect(kind).not.toBe('breakdown');
      expect(kind).not.toBe('demand');
    }
  });

  it('returns null when there are no vehicles', () => {
    expect(buildNextAlert([], 0, new Set())).toBeNull();
  });
});

describe('candidate selection', () => {
  it('prefers vehicles with a good fix, a route and a depot', () => {
    const bus = selectAlertCandidate(fleet, new Set(), 'seed-a');
    expect(bus).not.toBeNull();
    expect(bus!.dataQuality).toBe('good');
    expect(bus!.routeName).toBeTruthy();
    expect(bus!.depotName).toBeTruthy();
  });

  it('avoids vehicles already on the board', () => {
    const exclude = new Set(fleet.slice(0, 20).map((bus) => bus.id));
    const bus = selectAlertCandidate(fleet, exclude, 'seed-b');
    expect(bus).not.toBeNull();
    expect(exclude.has(bus!.id)).toBe(false);
  });

  it('falls back rather than returning null when every vehicle is excluded', () => {
    const exclude = new Set(fleet.map((bus) => bus.id));
    expect(selectAlertCandidate(fleet, exclude, 'seed-c')).not.toBeNull();
  });

  it('returns null only for an empty fleet', () => {
    expect(selectAlertCandidate([], new Set(), 'seed-d')).toBeNull();
  });
});
