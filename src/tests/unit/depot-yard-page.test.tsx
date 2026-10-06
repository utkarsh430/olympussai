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

  it('says the server has only just started when no yard is placed after one snapshot', async () => {
    hooks.detail = { ...base, data: { ...detail([], false), yardSnapshotsSeen: 1 }, error: null, loading: false };
    expect(text(await renderPage())).toContain('The server has only just started');
  });
});
