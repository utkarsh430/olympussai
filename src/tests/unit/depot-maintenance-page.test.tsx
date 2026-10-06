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

  it('shows the three-figure band: live off-road count, then overdue and due soon tagged MODELLED', () => {
    const markup = renderToStaticMarkup(<MaintenancePage />);
    const band = markup.slice(markup.indexOf('data-testid="depot-figure-band"'));
    const live = band.indexOf('Off the road now');
    const overdue = band.indexOf('Overdue');
    const dueSoon = band.indexOf('Due soon');
    expect(live).toBeGreaterThan(-1);
    expect(overdue).toBeGreaterThan(live);
    expect(dueSoon).toBeGreaterThan(overdue);
    // the live figure carries no tag; each modelled figure carries one
    expect(band.slice(live, overdue)).not.toMatch(/Modelled|MODELLED/i);
    expect(band.slice(overdue, dueSoon)).toMatch(/modelled/i);
    expect(band.slice(dueSoon, dueSoon + 400)).toMatch(/modelled/i);
  });

  it('guards the generated status beside a real registration on every surface that shows it', () => {
    const markup = renderToStaticMarkup(<MaintenancePage />);
    const body = text(markup);
    // the section label carries the tag, the one sentence says not workshop records
    const section = markup.slice(markup.indexOf('depot-preventive-heading'));
    expect(section.slice(0, 600)).toMatch(/modelled/i);
    expect(body).toContain('they are not workshop records');
    // both column headers carry the tag; the cells hold the word and the number only
    expect(body).toContain('Status (MODELLED)');
    expect(body).toContain('To next service, km (MODELLED)');
    expect(body).toContain('UP32A0009');
    expect(body).not.toContain('Modelled: overdue');
    expect(markup).toMatch(/<td[^>]*>Overdue<\/td>/);
    expect(markup).toContain('\u22123,400');
  });

  it('says once, above the off-road table, what every row shares, with no constant columns', () => {
    const body = text(renderToStaticMarkup(<MaintenancePage />));
    expect(body).toContain('Every bus here has feed status Under maintenance');
    expect(body).not.toContain('Feed status');
    expect(body.match(/Under maintenance/g)).toHaveLength(1);
  });

  it('puts the actionable workshop line beside the live list, with the same count as the band', () => {
    const body = text(renderToStaticMarkup(<MaintenancePage />));
    expect(body).toContain('2 buses off the road fit in 4 modelled bays');
    expect(body).toContain('Would wait for a bay');
  });

  it('ends with a closed disclosure holding the model statements', () => {
    const markup = renderToStaticMarkup(<MaintenancePage />);
    expect(markup).toContain('<details');
    expect(markup).not.toContain('<details open');
    expect(text(markup)).toContain('How these figures are produced');
    expect(text(markup)).toContain('not derived from any record');
    expect(text(markup)).toContain('distance field is not used on this page');
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
    expect(markup).not.toContain('UP32A0009');
  });
});
