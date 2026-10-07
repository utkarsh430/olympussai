import { act, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouteHourlyPage } from '@/components/depot/service/RouteHourlyPage';
import { FIXTURE_BUSES, routeHourlyFixture } from './depot-service-fixtures';

/*
 * The timetable loader on the route day: the control sits in the chart section's controls,
 * a press looks up the route's unrecorded buses one at a time through the schedule-day
 * endpoint, the status line says the run, a 429 pauses it, and the page asks for its
 * figures again once a run ends. The sample's refusal is said, and the page stays.
 */

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) =>
      isValidElement(children)
        ? cloneElement(children as ReactElement<{ width: number; height: number }>, { width: 960, height: 300 })
        : null,
  };
});

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let container: HTMLDivElement;
let root: Root;

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers });

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const status = (): string => container.querySelector('[data-testid="timetable-status"]')?.textContent ?? '';
const button = (id: string): HTMLButtonElement | null =>
  container.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await act(async () => Promise.resolve());
}

describe('the route day timetable loader', () => {
  it('sits in the chart section controls with its cost in the title, and never starts by itself', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    act(() => root.render(<RouteHourlyPage response={routeHourlyFixture()} error={null} loading={false} />));
    const load = button('timetable-load');
    expect(load?.textContent).toBe('Load this route’s full timetable');
    expect(load?.closest('[data-testid="depot-section-controls"]')).not.toBeNull();
    expect(load?.title).toContain('20 buses');
    expect(container.textContent).toContain('28 of 40 buses still to load; a press loads up to 20.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads the unrecorded buses one at a time, at most 20, and refreshes the figures after', async () => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      asked.push(url);
      return json(200, { status: 'ok', trips: [], tripsOnRoute: 1 });
    }));
    const refreshed = vi.fn();
    act(() =>
      root.render(
        <RouteHourlyPage response={routeHourlyFixture()} error={null} loading={false} onTimetableLoaded={refreshed} />,
      ),
    );
    act(() => button('timetable-load')?.click());
    await settle();
    expect(asked).toHaveLength(20);
    expect(asked[0]).toBe(`/api/upsrtc/depot/schedule-day/${FIXTURE_BUSES[12]}?route=KANPUR-LUCKNOW`);
    expect(status()).toBe('Done: 20 of 20 loaded. The chart updates on its next refresh.');
    expect(refreshed).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('8 of 40 buses still to load');
  });

  it('pauses at the limit and says so, then continues', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? json(429, { error: 'Too many requests', retryAfterSeconds: 2 }, { 'Retry-After': '2' })
        : json(200, { status: 'ok', trips: [], tripsOnRoute: 1 });
    }));
    const release: (() => void)[] = [];
    const wait = (): Promise<void> => new Promise((resolve) => release.push(resolve));
    act(() => root.render(<RouteHourlyPage response={routeHourlyFixture()} error={null} loading={false} wait={wait} />));
    act(() => button('timetable-load')?.click());
    await settle();
    expect(status()).toBe('Paused at the lookup limit; resuming in 2 seconds · 0 of 20 loaded · 20 remain');
    expect(button('timetable-cancel')).not.toBeNull();
    for (let i = 0; i < 2; i += 1) {
      release.shift()?.();
      await settle();
    }
    expect(status()).toBe('Done: 20 of 20 loaded. The chart updates on its next refresh.');
    expect(calls).toBe(21);
  });

  it('says the sample refusal and keeps the page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { status: 'unavailable', reason: 'upstream_error' })));
    act(() => root.render(<RouteHourlyPage response={routeHourlyFixture()} error={null} loading={false} />));
    act(() => button('timetable-load')?.click());
    await settle();
    expect(status()).toBe('Done: 0 of 20 loaded · 20 could not be read. The chart updates on its next refresh.');
    expect(container.querySelector('[data-testid="route-hourly-page"]')).not.toBeNull();
  });

  it('says nothing is left, and a borrowed timetable', () => {
    const response = routeHourlyFixture({
      busesWithDay: FIXTURE_BUSES,
      timetableBorrowedFrom: ['2026-10-05'],
    });
    act(() => root.render(<RouteHourlyPage response={response} error={null} loading={false} />));
    expect(button('timetable-load')).toBeNull();
    expect(container.textContent).toContain('Every bus seen on this route has its timetable loaded.');
    expect(container.textContent).toContain('Timetable of 5 Oct 2026 used for 6 Oct 2026.');
  });
});
