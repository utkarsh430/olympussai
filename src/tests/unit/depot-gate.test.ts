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

const requireProjectSession = vi.fn(async (_path: string): Promise<void> => undefined);
vi.mock('@/lib/auth/server', () => ({
  requireProjectSession: (path: string): Promise<void> => requireProjectSession(path),
}));

import { requireDepotPage } from '@/lib/depot/depotGate';

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
