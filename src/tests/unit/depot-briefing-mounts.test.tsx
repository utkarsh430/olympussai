import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DepotCockpit } from '@/components/depot/cockpit/DepotCockpit';
import { NetworkOverview } from '@/components/depot/network/NetworkOverview';

const contexts = vi.hoisted(() => ({
  network: null as unknown,
  detail: null as unknown,
}));

vi.mock('@/components/depot/data/DepotNetworkProvider', () => ({
  useDepotNetworkContext: (): unknown => contexts.network,
}));
vi.mock('@/components/depot/data/DepotDetailProvider', () => ({
  useDepotDetailContext: (): unknown => contexts.detail,
}));
// The mounts are under test, not the sections around them.
vi.mock('@/components/depot/network/KpiBand', () => ({ KpiBand: () => null }));
vi.mock('@/components/depot/cockpit/AttentionStrip', () => ({ AttentionStrip: () => null }));
vi.mock('@/components/depot/cockpit/AvailabilityBar', () => ({ AvailabilityBar: () => null }));
vi.mock('@/components/depot/cockpit/OutshedTracker', () => ({ OutshedTracker: () => null }));
vi.mock('@/components/depot/cockpit/DepotExceptions', () => ({ DepotExceptions: () => null }));
vi.mock('@/components/depot/cockpit/CockpitMethod', () => ({ CockpitMethod: () => null }));
vi.mock('@/lib/depot/cockpit/cockpitModel', () => ({
  buildCockpit: (): unknown => ({
    header: { kindLabel: 'Depot', fleet: 0 },
    indexMeta: { label: '', reason: null, href: '' },
    board: { fleet: 0, yard: { established: false, sentence: '' } },
    tracker: [],
    visitorCount: 0,
  }),
}));

const fetchSpy = vi.fn();
const base = { error: null, loading: false, refresh: (): void => {} };

function countOf(markup: string, text: string): number {
  return markup.split(text).length - 1;
}

beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => vi.unstubAllGlobals());

describe('Network overview briefing', () => {
  it('shows the card once when data is present and requests nothing on mount', () => {
    contexts.network = {
      ...base,
      data: { stale: false, depots: [], scores: [], kpis: {}, feedNow: 'x' },
    };
    const markup = renderToStaticMarkup(<NetworkOverview />);
    expect(countOf(markup, '>Network briefing<')).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('folds the card into one closed row and ends the page with the closed disclosure', () => {
    contexts.network = {
      ...base,
      data: { stale: false, depots: [], scores: [], kpis: {}, feedNow: 'x' },
    };
    const markup = renderToStaticMarkup(<NetworkOverview />);
    const row = markup.slice(markup.indexOf('data-testid="depot-briefing-row"') - 60);
    expect(row.startsWith('<details') || row.includes('<details class')).toBe(true);
    expect(markup).not.toMatch(/<details[^>]*\sopen/);
    expect(markup).toContain('How these figures are produced');
    expect(markup.indexOf('How these figures are produced')).toBeGreaterThan(
      markup.indexOf('Network briefing'),
    );
  });

  it('does not show the card while loading or after a failure', () => {
    contexts.network = { ...base, data: null, loading: true };
    expect(renderToStaticMarkup(<NetworkOverview />)).not.toContain('Network briefing');
    contexts.network = { ...base, data: null, error: 'down' };
    expect(renderToStaticMarkup(<NetworkOverview />)).not.toContain('Network briefing');
  });
});

describe('Depot cockpit briefing', () => {
  it('shows the card once when data is present and requests nothing on mount', () => {
    contexts.detail = {
      ...base,
      depotId: '20',
      data: { stale: false, feedNow: 'x', depot: { status: {} }, outshed: { coverage: {} } },
    };
    const markup = renderToStaticMarkup(<DepotCockpit />);
    expect(countOf(markup, '>Depot briefing<')).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('folds the card into one closed row and ends the page with the closed disclosure', () => {
    contexts.network = {
      ...base,
      data: { stale: false, depots: [], scores: [], kpis: {}, feedNow: 'x' },
    };
    const markup = renderToStaticMarkup(<NetworkOverview />);
    const row = markup.slice(markup.indexOf('data-testid="depot-briefing-row"') - 60);
    expect(row.startsWith('<details') || row.includes('<details class')).toBe(true);
    expect(markup).not.toMatch(/<details[^>]*\sopen/);
    expect(markup).toContain('How these figures are produced');
    expect(markup.indexOf('How these figures are produced')).toBeGreaterThan(
      markup.indexOf('Network briefing'),
    );
  });

  it('does not show the card while loading or after a failure', () => {
    contexts.detail = { ...base, depotId: '20', data: null, loading: true };
    expect(renderToStaticMarkup(<DepotCockpit />)).not.toContain('Depot briefing');
    contexts.detail = { ...base, depotId: '20', data: null, error: 'down' };
    expect(renderToStaticMarkup(<DepotCockpit />)).not.toContain('Depot briefing');
  });
});
