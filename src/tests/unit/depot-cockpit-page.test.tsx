import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DepotCockpitPage from '@/app/(protected)/project/depots/d/[depotId]/page';
import { DEPOT_NOT_FOUND_MESSAGE } from '@/hooks/useDepotDetail';
import { bannedOnScreen } from './depot-guard-rendered';

/**
 * The cockpit's page-level default (DERIVED) is pinned by rendering the
 * real route page in every state, so changing or dropping the default fails here.
 */

const contexts = vi.hoisted(() => ({ detail: null as unknown }));

vi.mock('@/lib/depot/depotGate', () => ({ requireDepotPage: async (): Promise<void> => {} }));
vi.mock('@/components/depot/data/DepotDetailProvider', () => ({
  useDepotDetailContext: (): unknown => contexts.detail,
}));
vi.mock('@/components/depot/data/DepotNetworkProvider', () => ({
  useDepotNetworkContext: (): unknown => ({
    data: { feedNow: '2026-10-05T14:20:00.000Z', stale: false },
    error: null,
  }),
}));

const base = { depotId: '20', data: null, error: null, loading: false, refresh: (): void => {} };

function depotData(fleet: number): unknown {
  const buses = Array.from({ length: fleet }, (_, i) => ({
    registrationNumber: `UP${i}`, state: 'standing', location: 'in_yard',
    mainPowerOn: true, tamperCode: null, notHeardMin: null,
  }));
  return {
    feedNow: '2026-10-05T14:20:00.000Z',
    stale: false,
    depot: {
      id: '20', name: 'Varanasi', kind: 'depot', fleet,
      status: { live: 0, stationary: fleet, noSignal: 0, underMaintenance: 0, unknown: 0 },
      states: { inService: 0, onRoad: 0, standing: fleet, dark: 0, offRoad: 0 },
    },
    score: null,
    yard: { value: null, provenance: 'derived' },
    yardSnapshotsSeen: 9,
    buses,
    locationMix: { in_yard: 0, at_other_yard: 0, away: 0, unknown: 0 },
    outshed: { rows: [], coverage: { n: 0, of: fleet } },
    exceptions: { depot: [], bus: [] },
    visitors: [],
  };
}

const STATES: readonly (readonly [string, Record<string, unknown>])[] = [
  ['loading', { loading: true }],
  ['error', { error: 'The feed did not answer' }],
  ['unknown depot', { error: DEPOT_NOT_FOUND_MESSAGE }],
  ['empty', { data: depotData(0) }],
  ['data', { data: depotData(3) }],
];

async function renderPage(): Promise<string> {
  const page = await DepotCockpitPage({ params: Promise.resolve({ depotId: '20' }) });
  return renderToStaticMarkup(page);
}

const text = (markup: string): string => markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

function provenanceOf(markup: string): string {
  const start = markup.indexOf('data-testid="depot-provenance-line"');
  return text(markup.slice(start, markup.indexOf('</div>', start)));
}

describe('depot cockpit route page', () => {
  beforeEach(() => {
    contexts.detail = base;
  });

  it.each(STATES)('shows no "simulated" and no raw date in the %s state', async (_name, partial) => {
    contexts.detail = { ...base, ...partial };
    expect(bannedOnScreen(await renderPage())).toEqual([]);
  });

  it.each(STATES)('declares DERIVED, computed from the live feed, in the %s state', async (_name, partial) => {
    contexts.detail = { ...base, ...partial };
    const markup = await renderPage();
    expect(markup).toMatch(/data-testid="depot-provenance-line"[^>]*data-tone="derived"/);
    const line = provenanceOf(markup);
    expect(line).toContain('DERIVED');
    expect(line).toMatch(/Computed from the live feed at \d\d:\d\d\./);
    expect(line).not.toMatch(/MODELLED|LIVE /);
  });

  it('puts the index meta in the header, before the provenance line, linked to the league', async () => {
    contexts.detail = { ...base, data: depotData(3) };
    const markup = await renderPage();
    const meta = markup.indexOf('data-testid="depot-cockpit-index"');
    expect(meta).toBeGreaterThan(-1);
    expect(meta).toBeLessThan(markup.indexOf('data-testid="depot-provenance-line"'));
    expect(markup).toContain('href="/project/depots/league"');
    expect(text(markup)).toContain('No score is available for this depot.');
  });

  it('shows no index meta before the first response', async () => {
    contexts.detail = { ...base, loading: true };
    expect(await renderPage()).not.toContain('data-testid="depot-cockpit-index"');
  });
});
