// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';

const cookieGet = vi.fn();
vi.mock('next/headers', () => ({ cookies: async () => ({ get: cookieGet }) }));

import { requireUpsrtcAccess } from '@/lib/auth/authorize';
import { SESSION_ROLE } from '@/lib/auth/config';
import { createSessionToken, verifySessionToken } from '@/lib/auth/session';

/** A test-only secret, set for this file and restored after it. */
const TEST_SECRET = 'test-session-secret-0123456789abcdef';
const saved = { secret: process.env.SESSION_SECRET, project: process.env.PROJECT_NAME };

beforeEach(() => {
  process.env.SESSION_SECRET = TEST_SECRET;
  process.env.PROJECT_NAME = 'upsrtc';
  cookieGet.mockReset();
});
afterEach(() => {
  if (saved.secret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = saved.secret;
  if (saved.project === undefined) delete process.env.PROJECT_NAME;
  else process.env.PROJECT_NAME = saved.project;
});

describe('session id claim', () => {
  it('gives every new session token its own random id', async () => {
    const a = await verifySessionToken(await createSessionToken('upsrtc'));
    const b = await verifySessionToken(await createSessionToken('upsrtc'));
    expect(a?.sid).toMatch(/^[0-9a-f-]{36}$/);
    expect(b?.sid).toMatch(/^[0-9a-f-]{36}$/);
    expect(a?.sid).not.toBe(b?.sid);
  });

  it('still accepts a token issued before the claim existed', async () => {
    const now = Math.floor(Date.now() / 1000);
    const legacy = await new SignJWT({ project: 'upsrtc', role: SESSION_ROLE })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt(now)
      .setExpirationTime(now + 60)
      .sign(new TextEncoder().encode(TEST_SECRET));
    const claims = await verifySessionToken(legacy);
    expect(claims).toMatchObject({ project: 'upsrtc', role: SESSION_ROLE });
    expect(claims?.sid).toBeUndefined();
  });

  it('returns the verified claims, with the id, from requireUpsrtcAccess', async () => {
    const token = await createSessionToken('upsrtc');
    cookieGet.mockReturnValue({ value: token });
    const claims = await requireUpsrtcAccess();
    expect(claims?.project).toBe('upsrtc');
    expect(claims?.sid).toMatch(/^[0-9a-f-]{36}$/);
    expect(claims?.sid).toEqual((await verifySessionToken(token))?.sid);
  });

  it('still denies a missing or foreign session', async () => {
    cookieGet.mockReturnValue(undefined);
    await expect(requireUpsrtcAccess()).resolves.toBeNull();
    cookieGet.mockReturnValue({ value: await createSessionToken('other') });
    await expect(requireUpsrtcAccess()).resolves.toBeNull();
  });
});
