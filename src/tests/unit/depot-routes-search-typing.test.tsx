import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoutesPage, ROUTE_SEARCH_DEBOUNCE_MS } from '@/components/depot/routes/RoutesPage';
import { PLAN_FIXTURE, ROUTES_FIXTURE } from './depot-routes.fixtures';

vi.mock('next/navigation', () => ({ useSearchParams: (): URLSearchParams => new URLSearchParams() }));
vi.mock('@/components/depot/data/DepotNetworkProvider', () => ({
  useDepotNetworkContext: (): unknown => ({ data: { depots: [] }, error: null }),
}));

const originalFetch = globalThis.fetch;
let requested: string[] = [];
/** Routes requests wait here until the test answers them, as a slow server would. */
let pendingRoutes: (() => void)[] = [];

function reply(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

beforeEach(() => {
  requested = [];
  pendingRoutes = [];
  // Every request is answered from fixtures; no route lookup ever leaves the test.
  globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    if (url.startsWith('/api/upsrtc/depot/allocation')) return Promise.resolve(reply(PLAN_FIXTURE));
    if (url.startsWith('/api/upsrtc/depot/routes') && requested.filter((u) => u.startsWith('/api/upsrtc/depot/routes')).length > 1) {
      return new Promise<Response>((resolve) => pendingRoutes.push(() => resolve(reply(ROUTES_FIXTURE))));
    }
    return Promise.resolve(reply(ROUTES_FIXTURE));
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('the Routes page while a new query loads', () => {
  it('keeps the search box focused and every key typed, with the previous rows marked busy', async () => {
    const user = userEvent.setup();
    render(<RoutesPage />);
    const box = await screen.findByRole('searchbox', { name: /route name contains/i });
    await user.click(box);
    await user.type(box, 'agra');

    // Typing never unmounts the box: the same element holds every key and the focus.
    expect(box.isConnected).toBe(true);
    expect(document.activeElement).toBe(box);
    expect((box as HTMLInputElement).value).toBe('agra');

    // One request after typing pauses, for the whole word.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ROUTE_SEARCH_DEBOUNCE_MS + 50));
    });
    const searches = requested.filter((u) => u.includes('q='));
    expect(searches).toEqual(['/api/upsrtc/depot/routes?q=agra']);

    // While it is pending the previous rows stay, dimmed and busy, and the box keeps focus.
    const frame = screen.getByTestId('route-table-frame');
    expect(frame.getAttribute('aria-busy')).toBe('true');
    expect(frame.className).toContain('opacity-60');
    expect(screen.getByRole('button', { name: ROUTES_FIXTURE.routes[0]?.routeName })).toBeTruthy();
    expect(document.activeElement).toBe(box);

    await act(async () => pendingRoutes.forEach((answer) => answer()));
    await waitFor(() => expect(screen.getByTestId('route-table-frame').getAttribute('aria-busy')).toBeNull());
    expect(document.activeElement).toBe(box);
  });
});
