import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MaintenancePage } from '@/components/depot/maintenance/MaintenancePage';
import type { DepotBusView } from '@/lib/depot/api';
import type { MaintenanceResponse } from '@/lib/depot/maintenance/api';

const hooks = vi.hoisted(() => ({ detail: null as unknown, maintenance: null as unknown }));

vi.mock('@/components/depot/data/DepotDetailProvider', () => ({
  useDepotDetailContext: (): unknown => hooks.detail,
}));
vi.mock('@/hooks/useDepotMaintenance', () => ({
  useDepotMaintenance: (): unknown => hooks.maintenance,
}));

const bus = (registrationNumber: string, state: DepotBusView['state']): DepotBusView =>
  ({
    registrationNumber,
    state,
    vehicleStatus: state === 'off_road' ? 'under_maintenance' : 'live',
    tripStatus: 'Stationary',
    gpsAgeMin: 30,
    mainPowerOn: true,
    tamperCode: 'C',
  }) as DepotBusView;

const DETAIL = {
  feedNow: '2026-10-06T10:00:00Z',
  stale: false,
  depot: { id: '1', name: 'Alambagh' },
  buses: [bus('LIVE1', 'off_road'), bus('LIVE2', 'off_road'), bus('OK1', 'in_service')],
};

/** The endpoint counts one bus off the road: it is behind the live detail by a poll. */
const MODELLED = {
  feedNow: '2026-10-06T09:59:50Z',
  stale: false,
  depot: { id: '1', name: 'Alambagh' },
  distanceCoverage: { provenance: 'live', coverage: { n: 1, of: 3 } },
  preventive: {
    provenance: 'modelled',
    dueSoonWithinKm: 1500,
    counts: { overdue: 1, due_soon: 0, not_due: 2 },
    buses: [
      {
        registrationNumber: 'UP32A0009',
        serviceClass: 'ordinary',
        ageYears: 9,
        odometerKm: 90000,
        lastServiceKm: 80000,
        intervalKm: 10000,
        kmToNextService: -3400,
        group: 'overdue',
      },
    ],
  },
  workshop: {
    provenance: 'modelled',
    offRoadProvenance: 'live',
    load: { bays: 4, offRoad: 1, inBays: 1, queue: 0, freeBays: 3 },
  },
} as unknown as MaintenanceResponse;

const set = (detail: Record<string, unknown>, maintenance: Record<string, unknown>): void => {
  const base = { data: null, error: null, loading: false, refresh: () => {} };
  hooks.detail = { depotId: '1', ...base, ...detail };
  hooks.maintenance = { ...base, ...maintenance };
};
const text = (markup: string): string => markup.replace(/<[^>]*>/g, ' ');

describe('MaintenancePage', () => {
  beforeEach(() => set({ data: DETAIL }, { data: MODELLED }));

  it('lists the off-road buses from the depot detail context, not from its own endpoint', () => {
    const markup = renderToStaticMarkup(<MaintenancePage />);
    expect(markup).toContain('LIVE1');
    expect(markup).toContain('LIVE2');
    expect(markup).not.toContain('OK1');
    expect(text(markup)).toContain('2 buses are off the road now.');
  });

  it('puts the live count, not the endpoint count, in the workshop load', () => {
    const body = text(renderToStaticMarkup(<MaintenancePage />));
    expect(body).toContain('2 buses off the road fit in 4 modelled bays');
  });

  it('says the modelled row is modelled in every cell', () => {
    const body = text(renderToStaticMarkup(<MaintenancePage />));
    expect(body).toContain('Modelled: overdue by 3,400 km');
  });

  it('keeps the live list when only the modelled parts failed, and says so', () => {
    set({ data: DETAIL }, { data: null, error: 'Depot data unavailable' });
    const markup = renderToStaticMarkup(<MaintenancePage />);
    expect(markup).toContain('LIVE1');
    expect(markup).toContain('role="alert"');
  });

  it('shows the modelled sections as loading while the live list is already there', () => {
    set({ data: DETAIL }, { loading: true });
    const markup = renderToStaticMarkup(<MaintenancePage />);
    expect(markup).toContain('LIVE1');
    expect(markup).toContain('Loading the modelled maintenance view');
  });

  it('shows an error, not the modelled parts, when the depot detail failed', () => {
    set({ error: 'Depot data unavailable' }, { data: MODELLED });
    const markup = renderToStaticMarkup(<MaintenancePage />);
    expect(markup).toContain('role="alert"');
    expect(markup).not.toContain('Modelled: overdue');
  });
});
