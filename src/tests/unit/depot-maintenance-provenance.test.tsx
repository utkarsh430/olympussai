import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DepotMaintenancePage from '@/app/(protected)/project/depots/d/[depotId]/maintenance/page';

const hooks = vi.hoisted(() => ({ detail: null as unknown, network: null as unknown }));

vi.mock('@/lib/depot/depotGate', () => ({ requireDepotPage: async (): Promise<void> => {} }));
vi.mock('@/components/depot/data/DepotDetailProvider', () => ({
  useDepotDetailContext: (): unknown => hooks.detail,
}));
vi.mock('@/components/depot/data/DepotNetworkProvider', () => ({
  useDepotNetworkContext: (): unknown => hooks.network,
}));
vi.mock('@/hooks/useDepotMaintenance', () => ({
  useDepotMaintenance: (): unknown => ({
    data: null,
    error: null,
    loading: true,
    refresh: () => {},
  }),
}));

/** X1: the page's provenance line, pinned in every state of the page. */
const LIVE_SENTENCE = 'Off-road buses are LIVE; service status and workshop bays are MODELLED.';

const BASE = { data: null, error: null, loading: false, refresh: () => {} };
const DETAIL = { feedNow: '2026-10-06T10:00:00Z', stale: false, buses: [] };
const NETWORK = {
  data: { source: 'live', stale: false, feedNow: '2026-10-06T10:00:00Z' },
  error: null,
};

const STATES: readonly (readonly [string, Record<string, unknown>])[] = [
  ['loading', { loading: true }],
  ['error', { error: 'Depot data unavailable' }],
  ['empty', { data: DETAIL }],
  ['data', { data: { ...DETAIL, buses: [] }, error: null }],
];

async function line(): Promise<{
  readonly tone: string;
  readonly text: string;
  readonly tag: string;
}> {
  const element = await DepotMaintenancePage({ params: Promise.resolve({ depotId: '1' }) });
  const page = document.createElement('div');
  page.innerHTML = renderToStaticMarkup(element);
  const node = page.querySelector('[data-testid="depot-provenance-line"]');
  return {
    tone: node?.getAttribute('data-tone') ?? '',
    text: node?.textContent ?? '',
    tag: node?.querySelector('.depot-tag')?.textContent ?? '',
  };
}

describe('the maintenance page provenance line', () => {
  beforeEach(() => {
    hooks.network = NETWORK;
  });

  it.each(STATES)(
    'is MIXED, naming what is live and what is modelled, in the %s state',
    async (_n, partial) => {
      hooks.detail = { depotId: '1', ...BASE, ...partial };
      const result = await line();
      expect(result.tone).toBe('mixed');
      expect(result.tag).toBe('MIXED');
      expect(result.text).toContain(LIVE_SENTENCE);
    },
  );

  it('never calls the live part LIVE while the feed is unavailable or stale', async () => {
    hooks.detail = { depotId: '1', ...BASE, data: DETAIL };
    hooks.network = { data: null, error: 'down' };
    expect((await line()).text).not.toContain('Off-road buses are LIVE');
    hooks.network = { data: { ...NETWORK.data, stale: true }, error: null };
    const stale = await line();
    expect(stale.tone).toBe('mixed');
    expect(stale.text).toContain('last good data');
  });
});
