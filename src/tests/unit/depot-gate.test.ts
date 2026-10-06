import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/** The real notFound never returns; the mock throws so a fall-through is caught. */
class NotFoundSignal extends Error {}
const notFoundMock = vi.fn((): never => {
  throw new NotFoundSignal();
});
vi.mock('next/navigation', () => ({
  notFound: (): never => notFoundMock(),
}));

const requireProjectSession = vi.fn<(path: string) => Promise<void>>(async () => undefined);
vi.mock('@/lib/auth/server', () => ({
  requireProjectSession: (path: string): Promise<void> => requireProjectSession(path),
}));

import { requireDepotPage, requireRoutePage } from '@/lib/depot/depotGate';
import { routeHourlyPath } from '@/lib/depot/nav';

describe('requireDepotPage', () => {
  beforeEach(() => {
    notFoundMock.mockClear();
    requireProjectSession.mockClear();
  });

  it('gates a valid depot on its own encoded path', async () => {
    await requireDepotPage('12');
    expect(requireProjectSession).toHaveBeenCalledExactlyOnceWith('/project/depots/d/12');
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it('appends the page under the depot', async () => {
    await requireDepotPage('12', '/roster');
    expect(requireProjectSession).toHaveBeenCalledExactlyOnceWith('/project/depots/d/12/roster');
  });

  it('ends in not-found for a malformed id, before the session gate sees it', async () => {
    for (const bad of ['abc', '../upsrtc', '..%2F..%2Fupsrtc', '12/roster', '', '1234567']) {
      await expect(requireDepotPage(bad, '/roster')).rejects.toBeInstanceOf(NotFoundSignal);
    }
    expect(requireProjectSession).not.toHaveBeenCalled();
  });
});

describe('requireRoutePage', () => {
  beforeEach(() => {
    notFoundMock.mockClear();
    requireProjectSession.mockClear();
  });

  it('gates a valid route on its own path under the Routes page', async () => {
    await requireRoutePage('RKD_4560_ORD_OUT');
    expect(requireProjectSession).toHaveBeenCalledExactlyOnceWith(
      '/project/depots/routes/r/RKD_4560_ORD_OUT',
    );
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it('ends in not-found for a malformed name, before the session gate sees it', async () => {
    for (const bad of ['', '../upsrtc', '..%2Fx', 'A B', 'x'.repeat(65), 'r/1']) {
      await expect(requireRoutePage(bad)).rejects.toBeInstanceOf(NotFoundSignal);
    }
    expect(requireProjectSession).not.toHaveBeenCalled();
  });
});

describe('routeHourlyPath', () => {
  it('encodes the name it is given', () => {
    expect(routeHourlyPath('KANPUR-LUCKNOW')).toBe('/project/depots/routes/r/KANPUR-LUCKNOW');
    expect(routeHourlyPath('a/b?c')).toBe('/project/depots/routes/r/a%2Fb%3Fc');
  });
});
