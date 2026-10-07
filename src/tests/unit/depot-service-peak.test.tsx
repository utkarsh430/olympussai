import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServicePeakFigure, ServicePeakLine } from '@/components/depot/service/ServicePeak';
import { bannedOnScreen } from './depot-guard-rendered';
import { networkHourlyFixture } from './depot-service-network-response';

const state = vi.hoisted(() => ({ polled: null as unknown, asks: [] as unknown[] }));
vi.mock('@/hooks/useNetworkHourly', () => ({
  useNetworkHourly: (ask: unknown): unknown => {
    state.asks.push(ask);
    return state.polled;
  },
}));

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let container: HTMLDivElement;
let root: Root;

const polled = (over: object): unknown => ({ data: null, error: null, loading: false, refresh: () => undefined, ...over });

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  state.asks.length = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the overview’s service figure', () => {
  it('counts the routes short at the next peak, MODELLED, linking to the page', () => {
    state.polled = polled({ data: networkHourlyFixture({ nextPeak: 'morning_peak' }) });
    act(() => root.render(<ServicePeakFigure />));
    expect(container.textContent).toContain('Routes short at the next peak');
    expect(container.textContent).toContain('MODELLED');
    expect(container.textContent).toContain('Of 3 routes, morning peak');
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/project/depots/service');
    expect(bannedOnScreen(container)).toEqual([]);
  });

  it('says so when the hours are unavailable', () => {
    state.polled = polled({ error: 'Depot data unavailable' });
    act(() => root.render(<ServicePeakFigure />));
    expect(container.textContent).toContain('Service by the hour is unavailable now.');
  });
});

describe('the cockpit’s service line', () => {
  it('asks for the depot and links to the page filtered to it', () => {
    state.polled = polled({ data: networkHourlyFixture({ nextPeak: 'morning_peak', depotId: '12' }) });
    act(() => root.render(<ServicePeakLine depotId="12" />));
    expect(state.asks[0]).toEqual({ band: null, depotId: '12', page: 0 });
    const link = container.querySelector('[data-testid="service-peak-line"]');
    expect(link?.getAttribute('href')).toBe('/project/depots/service?depot=12');
    expect(link?.textContent).toContain('of this depot’s 3 routes short at the next peak (morning peak)');
    expect(link?.textContent).toContain('MODELLED');
  });

  it('is silent while loading', () => {
    state.polled = polled({ loading: true });
    act(() => root.render(<ServicePeakLine depotId="12" />));
    expect(container.textContent).toBe('');
  });
});
