import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const cookieGet = vi.fn();
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: cookieGet }),
}));

/** The real redirect never returns; the mock throws so a fall-through is caught. */
class RedirectSignal extends Error {}
const redirectMock = vi.fn((url: string): never => {
  throw new RedirectSignal(url);
});
vi.mock('next/navigation', () => ({
  redirect: (url: string): never => redirectMock(url),
}));

const verifySessionToken = vi.fn();
vi.mock('@/lib/auth/session', () => ({
  verifySessionToken: (token: string | undefined): unknown => verifySessionToken(token),
  createSessionToken: vi.fn(),
}));

import { requireProjectSession } from '@/lib/auth/server';

const ORIGINAL_PROJECT_NAME = process.env.PROJECT_NAME;

describe('requireProjectSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PROJECT_NAME = 'upsrtc';
    cookieGet.mockReturnValue(undefined);
    verifySessionToken.mockResolvedValue(null);
  });

  afterEach(() => {
    if (ORIGINAL_PROJECT_NAME === undefined) delete process.env.PROJECT_NAME;
    else process.env.PROJECT_NAME = ORIGINAL_PROJECT_NAME;
  });

  it('redirects to login with the encoded return path when there is no cookie', async () => {
    await expect(requireProjectSession('/project/depots')).rejects.toBeInstanceOf(RedirectSignal);
    expect(redirectMock).toHaveBeenCalledTimes(1);
    expect(redirectMock).toHaveBeenCalledWith('/login?next=%2Fproject%2Fdepots');
  });

  it('redirects when the session belongs to another project', async () => {
    cookieGet.mockReturnValue({ value: 'token' });
    verifySessionToken.mockResolvedValue({ project: 'other', role: 'project-access' });
    await expect(requireProjectSession('/project/depots')).rejects.toBeInstanceOf(RedirectSignal);
    expect(redirectMock).toHaveBeenCalledTimes(1);
  });

  it('returns the claims for a session on the authorised project', async () => {
    const claims = { project: 'upsrtc', role: 'project-access' };
    cookieGet.mockReturnValue({ value: 'token' });
    verifySessionToken.mockResolvedValue(claims);
    await expect(requireProjectSession('/project/depots')).resolves.toEqual(claims);
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('percent-encodes a path with a query into a single next value', async () => {
    await expect(requireProjectSession('/project/depots/d/7?tab=yard')).rejects.toBeInstanceOf(
      RedirectSignal,
    );
    expect(redirectMock).toHaveBeenCalledWith('/login?next=%2Fproject%2Fdepots%2Fd%2F7%3Ftab%3Dyard');
  });
});
