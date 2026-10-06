import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import ExceptionsPage from '@/app/(protected)/project/depots/exceptions/page';
import type { DepotExceptionsResponse } from '@/lib/depot/api';
import type { DepotException, ExceptionKind } from '@/lib/depot/exceptions/types';

/*
 * Guard X1 and X11 (round 2): the exceptions page's real top-level component, in every
 * state, declares DERIVED with its sentence; with data, the window words are on the page
 * and each depot exception says the window it was compared over.
 */
const NOW = '2026-10-06T14:20:00.000Z';
const FRESH = {
  data: { feedNow: '2026-10-06T14:20:00.000Z', stale: false, source: 'live', depots: [] },
  error: null,
  loading: false,
};
const hooks = vi.hoisted(() => ({ exceptions: null as unknown, network: null as unknown }));

vi.mock('@/lib/auth/server', () => ({ requireProjectSession: async (): Promise<void> => {} }));
vi.mock('@/components/depot/data/DepotNetworkProvider', () => ({
  useDepotNetworkContext: (): unknown => hooks.network ?? FRESH,
}));
vi.mock('@/hooks/useDepotExceptions', () => ({
  DEPOT_UNAVAILABLE_MESSAGE: 'Depot data unavailable',
  useDepotExceptions: (): unknown => hooks.exceptions,
}));

const ZERO: Record<ExceptionKind, number> = {
  dark_share_high: 0,
  off_road_high: 0,
  on_road_low: 0,
  power_cut_cluster: 0,
  long_dark: 0,
  power_cut: 0,
  tamper_code: 0,
  emergency: 0,
};

const OFF_ROAD: DepotException = {
  id: 'off_road_high:7',
  depotId: '7',
  depotName: 'GARH',
  kind: 'off_road_high',
  severity: 'critical',
  value: 0.128,
  peerMedian: 0.016,
  z: 4,
  affected: 12,
  fleet: 94,
  basis: 'window',
  samples: 30,
};

function response(depot: readonly DepotException[]): DepotExceptionsResponse {
  return {
    feedNow: NOW,
    stale: false,
    report: { depot, busTotal: 0, counts: { ...ZERO, off_road_high: depot.length } },
    busSeverityCounts: { critical: 0, warning: 0, info: 0 },
    busPage: { kind: null, depotId: null, offset: 0, limit: 25, total: 0, items: [] },
    scoreWindow: { lengthMin: 20, since: '2026-10-06T14:00:00.000Z', samples: 30 },
  } as unknown as DepotExceptionsResponse;
}

const STATES: readonly [string, unknown][] = [
  ['loading', { data: null, error: null, loading: true, refresh: () => undefined }],
  ['error', { data: null, error: 'Depot data unavailable', loading: false, refresh: () => undefined }],
  ['empty', { data: response([]), error: null, loading: false, refresh: () => undefined }],
  ['data', { data: response([OFF_ROAD]), error: null, loading: false, refresh: () => undefined }],
];

async function renderPage(): Promise<string> {
  return renderToStaticMarkup(await ExceptionsPage());
}

function text(markup: string): string {
  return markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

describe('the exceptions page provenance', () => {
  it.each(STATES)('declares DERIVED from the live feed in the %s state', async (_name, hook) => {
    hooks.exceptions = hook;
    const markup = await renderPage();
    expect(markup).toContain('data-tone="derived"');
    expect(text(markup)).toContain('DERIVED Computed from the live feed at');
  });

  it.each([
    ['waiting', { data: null, error: null, loading: true }, 'DERIVED Waiting for the feed.'],
    ['unavailable', { data: null, error: 'down', loading: false }, 'DERIVED The feed is unavailable.'],
    ['stale', { ...FRESH, data: { ...FRESH.data, stale: true } }, 'feed time 14:20.'],
  ])('drives the provenance line through the %s feed state', async (_name, network, words) => {
    hooks.network = network;
    hooks.exceptions = STATES[3]?.[1];
    const markup = await renderPage();
    hooks.network = null;
    expect(markup).toContain('data-tone="derived"');
    expect(text(markup)).toContain(words);
  });

  it('says the window once, in the section note, and no line repeats it', async () => {
    hooks.exceptions = STATES[3]?.[1];
    const page = text(await renderPage());
    expect(page).toContain(
      'Rates are compared with peers over the last 20 minutes; bus counts are as of',
    );
    expect(page).not.toContain('Last 20 min');
    expect(page).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(page).toContain('Off-road rate 12.8% against a peer median of 1.6%');
  });

  it('replaces a band of zeros with one state line when nothing is flagged', async () => {
    hooks.exceptions = STATES[2]?.[1];
    const markup = await renderPage();
    expect(text(markup)).toContain('Nothing stands out on this snapshot');
    expect(markup).not.toContain('data-testid="depot-figure-band"');
  });
});
