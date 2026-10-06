import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DepotYardPage from '@/app/(protected)/project/depots/d/[depotId]/yard/page';
import type { DepotBusView, DepotDetailResponse } from '@/lib/depot/api';
import type { ParkingResponse } from '@/lib/depot/yard/parkingApi';

const hooks = vi.hoisted(() => ({ detail: null as unknown, parking: null as unknown }));

vi.mock('@/lib/depot/depotGate', () => ({ requireDepotPage: async (): Promise<void> => {} }));
vi.mock('@/components/depot/data/DepotDetailProvider', () => ({
  useDepotDetailContext: (): unknown => hooks.detail,
}));
vi.mock('@/components/depot/data/DepotNetworkProvider', () => ({
  useDepotNetworkContext: (): unknown => ({ data: null, error: null }),
}));
vi.mock('@/hooks/useDepotParking', () => ({ useDepotParking: (): unknown => hooks.parking }));

const YARD = { lat: 18.5, lng: 73.8, radiusM: 200, parked: 6, inCluster: 5 };

const bus = (reg: string, over: Partial<DepotBusView> = {}): DepotBusView =>
  ({
    registrationNumber: reg,
    state: 'standing',
    location: 'in_yard',
    otherDepotId: null,
    distanceFromYardKm: 0,
    latitude: YARD.lat,
    longitude: YARD.lng,
    speedKmph: 0,
    gpsAgeMin: 3,
    ...over,
  }) as DepotBusView;

function detail(buses: readonly DepotBusView[], withYard: boolean): DepotDetailResponse {
  return {
    feedNow: null,
    fetchedAt: '2026-10-06T00:00:00Z',
    source: 'live',
    stale: false,
    depot: { id: '20', name: 'Kaushambi', fleet: buses.length },
    yard: { value: withYard ? YARD : null, provenance: 'derived' },
    yardSnapshotsSeen: 30,
    locationMix: { in_yard: buses.length, away: 0, at_other_yard: 0, unknown: 0 },
    buses,
    visitors: [],
  } as unknown as DepotDetailResponse;
}

const PARKING = {
  feedNow: null,
  fetchedAt: '2026-10-06T00:00:00Z',
  source: 'live',
  stale: false,
  depot: { id: '20', name: 'Kaushambi' },
  operatingDate: '2026-10-07',
  state: 'planned',
  capacity: {
    bays: { value: 60, provenance: 'modelled' },
    inYard: { value: 2, provenance: 'derived' },
    visiting: { value: 0, provenance: 'derived' },
    fleet: { value: 2, provenance: 'live' },
  },
  droppedRows: 0,
  order: {
    provenance: 'modelled',
    lanes: [{ id: 'A', depth: 3, slots: [{ position: 1, registrationNumber: 'UP32AA0001', firstDutyStartMin: 330 }] }],
    overflow: [{ registrationNumber: 'UP32AA0002', firstDutyStartMin: 360, reason: 'no_lane_space' }],
    blocked: 0,
    parkedCount: 1,
  },
} as unknown as ParkingResponse;

const DATA = detail([bus('UP32AA0001'), bus('UP32AA0002')], true);
const base = { refresh: (): void => {}, depotId: '20' };
const parked = { data: PARKING, error: null, loading: false, refresh: (): void => {} };

const STATES = [
  ['loading', { ...base, data: null, error: null, loading: true }],
  ['error', { ...base, data: null, error: 'The feed did not answer.', loading: false }],
  ['empty', { ...base, data: detail([], false), error: null, loading: false }],
  ['data', { ...base, data: DATA, error: null, loading: false }],
] as const;

const text = (markup: string): string =>
  markup.replace(/<[^>]*>/g, '').replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

async function renderPage(): Promise<string> {
  const element = await DepotYardPage({ params: Promise.resolve({ depotId: '20' }) });
  return renderToStaticMarkup(element);
}

/** The provenance line's markup: its opening tag (with the tone) and its words. */
function provenanceLine(markup: string): string {
  const start = markup.indexOf('data-testid="depot-provenance-line"');
  expect(start).toBeGreaterThan(-1);
  return markup.slice(start, markup.indexOf('</div>', start));
}

const MIXED_SENTENCE =
  'Bus positions, states and the yard circle are DERIVED; capacity, lanes and the parking order are MODELLED.';

describe('the yard page', () => {
  beforeEach(() => {
    hooks.parking = parked;
  });

  it.each(STATES)('declares the page MIXED in the %s state', async (_name, state) => {
    hooks.detail = state;
    const line = provenanceLine(await renderPage());
    expect(line).toContain('data-tone="mixed"');
    expect(text(line)).toContain('MIXED');
    expect(text(line)).toContain(MIXED_SENTENCE);
  });

  it.each(STATES)('never says "simulated" anywhere in the %s state, attributes included', async (_n, state) => {
    hooks.detail = state;
    const markup = await renderPage();
    // The raw markup holds every title and aria-label as well as the visible text.
    expect(markup).not.toMatch(/simulat/i);
    expect(markup).not.toMatch(/not in a lane/i);
  });

  it('tags the capacity figure and the night parking order where they are seen', async () => {
    hooks.detail = STATES[3][1];
    const markup = await renderPage();
    const beforeDisclosure = markup.slice(0, markup.indexOf('data-testid="yard-how"'));
    const band = beforeDisclosure.slice(beforeDisclosure.indexOf('data-testid="yard-summary"'));
    expect(band.slice(0, band.indexOf('</section>') > 0 ? band.indexOf('</section>') : undefined)).toContain(
      'data-provenance="modelled"',
    );
    const plan = beforeDisclosure.slice(beforeDisclosure.indexOf('data-testid="parking-plan"'));
    const label = plan.slice(0, plan.indexOf('data-testid="parking-blocked"'));
    expect(text(label)).toContain('Night parking order');
    expect(label).toContain('data-provenance="modelled"');
    expect(text(label)).toMatch(/7 Oct\w* 2026/);
  });

  it('never lists a bus in the roll for a reason from the modelled order; the order shows it, tagged', async () => {
    hooks.detail = STATES[3][1];
    const markup = await renderPage();
    const roll = markup.slice(
      markup.indexOf('data-testid="yard-roll"'),
      markup.indexOf('data-testid="parking-section"'),
    );
    expect(text(roll)).not.toContain('UP32AA0002');
    expect(text(roll)).not.toMatch(/lane|parking|order/i);
    const overflow = markup.slice(markup.indexOf('data-testid="parking-overflow"'));
    expect(text(overflow)).toContain('UP32AA0002');
    expect(text(overflow)).toMatch(/modelled/i);
  });

  it('keeps "Nothing is instructed or dispatched" visible beside the order', async () => {
    hooks.detail = STATES[3][1];
    const markup = await renderPage();
    const visible = markup.slice(0, markup.indexOf('data-testid="yard-how"'));
    expect(text(visible)).toContain('Nothing is instructed or dispatched.');
  });

  it.each(STATES)('has no raw ISO date in its text or attributes in the %s state', async (_n, state) => {
    hooks.detail = state;
    expect(await renderPage()).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('gives a yard B the "Yard map" label and a panel sized to its text, the state lists after', async () => {
    hooks.detail = { ...base, data: detail([bus('UP32AA0001')], false), error: null, loading: false };
    const markup = await renderPage();
    const start = markup.indexOf('data-testid="yard-not-established"');
    const panel = markup.slice(markup.indexOf('>', start) + 1, markup.indexOf('</section>', start));
    expect(text(panel)).toMatch(/^Yard map/);
    expect(panel).not.toMatch(/min-height/);
    expect(markup.indexOf('id="yard-roll-in"')).toBeGreaterThan(start);
  });

  it('keeps the yard rule sentence in the closing disclosure (R2-m14)', async () => {
    hooks.detail = { ...base, data: detail([bus('UP32AA0001')], false), error: null, loading: false };
    const markup = await renderPage();
    const how = markup.slice(markup.indexOf('data-testid="yard-how"'));
    expect(text(how)).toMatch(/at least 6 parked buses/);
  });

  it('captions "In the yard" as this depot\'s buses, visitors counted apart (R2-m13)', async () => {
    hooks.detail = { ...base, data: DATA, error: null, loading: false };
    const t = text(await renderPage());
    expect(t).toContain("this depot's buses inside the circle");
    expect(t).toContain('Buses from other depots inside it are counted under Visiting.');
    expect(t).not.toContain('inside the yard circle, any state');
  });

  it('sets the capacity tag inside the label line and the bar at the head of the caption', async () => {
    hooks.detail = { ...base, data: DATA, error: null, loading: false };
    const doc = new DOMParser().parseFromString(await renderPage(), 'text/html');
    const capacity = Array.from(doc.querySelectorAll('[data-testid="yard-figure"]')).find((li) =>
      (li.textContent ?? '').startsWith('Capacity'),
    );
    const labelLine = capacity?.querySelector('[data-provenance="modelled"]')?.parentElement;
    expect(labelLine?.className).toContain('h-4');
    const bar = capacity?.querySelector('[data-testid="depot-figure-share"]');
    expect(bar?.closest('p')?.className).toContain('depot-caption');
  });

  it('says how many snapshots it has decided the yard on when no yard is placed after one', async () => {
    hooks.detail = { ...base, data: { ...detail([], false), yardSnapshotsSeen: 1 }, error: null, loading: false };
    expect(text(await renderPage())).toContain("This server has decided this depot's yard on 1 snapshot so far");
  });
});
