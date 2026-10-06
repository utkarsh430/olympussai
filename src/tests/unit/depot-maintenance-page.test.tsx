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

  // Round 3: no raw ISO date in any text, title or aria-label, in any state of the page.
  it.each([
    ['data', { data: DETAIL }, { data: MODELLED }],
    ['modelled loading', { data: DETAIL }, { loading: true }],
    ['modelled error', { data: DETAIL }, { error: 'Depot data unavailable' }],
    ['loading', { loading: true }, {}],
    ['error', { error: 'Depot data unavailable' }, {}],
  ] as const)('puts no raw ISO date anywhere (%s)', (_n, detail, maintenance) => {
    set(detail, maintenance);
    const markup = renderToStaticMarkup(<MaintenancePage />);
    expect(text(markup)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    const attributes = [...markup.matchAll(/(?:title|aria-label)="([^"]*)"/g)].map((m) => m[1]);
    expect(attributes.join(' ')).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  // Round 3, maintenance Must 4: 40 px from the band to the off-road section (the band's
  // own 24 px margin plus 16 px on the lists).
  it('leaves 40 px between the band and the off-road section: the shared stack, no page spacing', () => {
    const markup = renderToStaticMarkup(<MaintenancePage />);
    const doc = new DOMParser().parseFromString(markup, 'text/html');
    const band = doc.querySelector('.depot-band');
    // The band sits directly in the shared stack (its own margin dropped, 40 px to the next rule).
    expect(band?.parentElement?.className).toBe('depot-stack');
    const lists = doc.querySelector('[data-testid="maintenance-lists"]');
    expect(lists?.className).toBe('depot-stack');
    expect(lists?.previousElementSibling).toBe(band);
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
    // queried per figure on the visible band, not by character offsets (guard M19)
    const page = document.createElement('div');
    page.innerHTML = markup;
    const tagsOf = [...page.querySelectorAll('[data-testid="depot-figure-band"] li')].map(
      (li) => li.querySelectorAll('[data-provenance="modelled"]').length,
    );
    expect(tagsOf).toEqual([0, 1, 1]);
  });

  it('guards the generated status beside a real registration on every surface that shows it', () => {
    const markup = renderToStaticMarkup(<MaintenancePage />);
    const body = text(markup);
    // the section label carries the ONE tag (queried on the visible page, not by offset)
    const page = document.createElement('div');
    page.innerHTML = markup;
    const section = page.querySelector('section[aria-labelledby="depot-preventive-heading"]');
    expect(section).not.toBeNull();
    const tags = section?.querySelectorAll('[data-provenance]') ?? [];
    expect(tags).toHaveLength(1);
    expect(
      section?.querySelector('[data-testid="depot-section-label"] [data-provenance="modelled"]'),
    ).not.toBeNull();
    expect(body).toContain('they are not workshop records');
    // no "(MODELLED)" in any header, no status column; the group row says it in words
    expect(body).not.toMatch(/\(MODELLED\)/);
    expect(body).toContain('To next service, km');
    expect([...page.querySelectorAll('th')].map((th) => th.textContent)).not.toContain('Status');
    expect(body).toContain('UP32A0009');
    expect(body).not.toContain('Modelled: overdue');
    expect(page.querySelector('[data-testid="depot-table-group"]')?.textContent).toBe(
      'Modelled overdue \u00b7 1',
    );
    expect(markup).toContain('\u22123,400');
  });

  it('puts the one MODELLED tag on the workshop label and none on its rows', () => {
    const page = document.createElement('div');
    page.innerHTML = renderToStaticMarkup(<MaintenancePage />);
    const section = page.querySelector('section[aria-labelledby="depot-workshop-heading"]');
    expect(section?.querySelectorAll('[data-provenance]')).toHaveLength(1);
    expect(section?.querySelector('dl [data-provenance]')).toBeNull();
  });

  it('says once, as the off-road section note, what every row shares, with no constant columns', () => {
    const body = text(renderToStaticMarkup(<MaintenancePage />));
    expect(body).toContain('Every bus here has feed status: Under maintenance');
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

  it('says in its section, with fixed words, that the modelled parts did not refresh, and keeps no older rows', () => {
    set({ data: DETAIL }, { data: MODELLED, error: 'Depot data unavailable' });
    const markup = renderToStaticMarkup(<MaintenancePage />);
    const words = text(markup).replace(/&#x27;/g, "'");
    expect(markup).toContain('LIVE1');
    expect(words).toContain(
      'The modelled maintenance figures did not load, so the overdue and due-soon counts and the preventive table are not shown.',
    );
    expect(words).toContain("The workshop's bay count did not load, so its load is not shown.");
    expect(markup).not.toContain('UP32A0009');
    expect(words).not.toContain('Overdue');
    expect(words).not.toContain('Depot data unavailable');
  });

  it('names the missing workshop load when the modelled parts never loaded', () => {
    set({ data: DETAIL }, { data: null, error: 'Depot data unavailable' });
    const words = text(renderToStaticMarkup(<MaintenancePage />)).replace(/&#x27;/g, "'");
    expect(words).toContain("The workshop's bay count did not load, so its load is not shown.");
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
