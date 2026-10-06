import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FleetDistributionPage from '@/app/(protected)/project/depots/rebalance/page';
import type { DepotDistributionResponse } from '@/lib/depot/api';
import type { DepotBalance, TransferPlan } from '@/lib/depot/optimise/types';
import { bannedOnScreen } from './depot-guard-rendered';

/*
 * The page's MIXED provenance line, rendered by the page's real
 * top-level component in every state. Changing or dropping the page default fails here.
 */

const hooks = vi.hoisted(() => ({ distribution: vi.fn(), gates: [] as string[] }));

vi.mock('@/components/depot/rebalance/TransferMap', () => ({ TransferMap: () => null }));
vi.mock('@/hooks/useDepotDistribution', () => ({ useDepotDistribution: hooks.distribution }));
vi.mock('@/components/depot/data/DepotNetworkProvider', () => ({
  useDepotNetworkContext: () => ({
    data: { feedNow: '2026-10-06T08:00:00Z', stale: false, source: 'live' },
    error: null,
  }),
}));
vi.mock('@/lib/auth/server', () => ({
  requireProjectSession: async (path: string): Promise<void> => {
    hooks.gates.push(path);
  },
}));

const text = (markup: string): string =>
  markup
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/ ([;.,])/g, '$1');

function balance(depotId: string, value: number): DepotBalance {
  return {
    depotId,
    depotName: depotId,
    kind: 'depot',
    position: null,
    fleet: 20,
    offRoad: 0,
    available: 20,
    peakRequirement: 20 - value,
    spareTarget: 0,
    required: 20 - value,
    balance: value,
  } as DepotBalance;
}

function response(withTransfer: boolean): DepotDistributionResponse {
  const moved = withTransfer ? 5 : 0;
  const transfer = {
    id: 'Agra>Kanpur',
    fromDepotId: 'Agra',
    toDepotId: 'Kanpur',
    buses: 5,
    distanceKm: 120,
    busKm: 600,
  };
  return {
    operatingDate: '2026-10-06',
    feedNow: '2026-10-06T08:00:00Z',
    stale: false,
    source: 'live',
    balances: [balance('Agra', moved), balance('Kanpur', -moved)],
    plan: {
      transfers: withTransfer ? [transfer] : [],
      uncovered: [],
      before: { totalSurplus: moved, totalDeficit: moved },
      after: { totalSurplus: 0, totalDeficit: 0 },
      coveredDeficit: moved,
      totalBusKm: moved * 120,
    } as unknown as TransferPlan,
    requirementParams: { spareRatio: 0.08 },
    rebalanceParams: { maxTransferKm: 250 },
  } as unknown as DepotDistributionResponse;
}

function polled(data: DepotDistributionResponse | null, extra: Record<string, unknown> = {}) {
  return { data, loading: false, error: null, refresh: () => {}, ...extra };
}

const STATES = [
  ['loading', () => polled(null, { loading: true })],
  ['error', () => polled(null, { error: 'Depot data unavailable' })],
  ['empty', () => polled(response(false))],
  ['data', () => polled(response(true))],
] as const;

const LINE =
  'Fleet, off-the-road and available counts are LIVE; requirement, spare target, surplus, ' +
  'deficit and every transfer are MODELLED.';

beforeEach(() => {
  hooks.gates.length = 0;
});

describe('the fleet distribution page provenance', () => {
  it.each(STATES)('shows no "simulated" and no raw date in the %s state', async (_state, make) => {
    hooks.distribution.mockReturnValue(make());
    expect(bannedOnScreen(renderToStaticMarkup(await FleetDistributionPage()))).toEqual([]);
  });

  it.each(STATES)('prints its MIXED line in the %s state', async (_state, make) => {
    hooks.distribution.mockReturnValue(make());
    const markup = renderToStaticMarkup(await FleetDistributionPage());
    const lines = markup.match(/data-testid="depot-provenance-line" data-tone="[a-z]+"/g);
    expect(lines).toEqual(['data-testid="depot-provenance-line" data-tone="mixed"']);
    const at = markup.indexOf('data-testid="depot-provenance-line"');
    const line = markup.slice(markup.lastIndexOf('<', at));
    expect(text(line).trim()).toMatch(/^MIXED /);
    expect(text(line)).toContain(LINE);
    expect(hooks.gates).toEqual(['/project/depots/rebalance']);
  });

  it('says nothing is dispatched on the first screen once the plan has loaded', async () => {
    hooks.distribution.mockReturnValue(polled(response(true)));
    const page = text(renderToStaticMarkup(await FleetDistributionPage()));
    expect(page).toContain('Nothing is dispatched or reassigned');
  });
});
