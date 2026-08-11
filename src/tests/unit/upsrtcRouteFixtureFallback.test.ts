// @vitest-environment node
//
// GET /api/upsrtc/live and GET /api/upsrtc/schedule — the two route handlers
// that used to substitute bundled fixture data for a failed upstream call
// automatically, with no opt-in.
//
// Same governing principle as src/tests/unit/fleetData.test.ts: every
// algorithm and system operates on live data obtained from the APIs — never
// assumed or placeholder data. The handlers are exercised directly with the
// Supabase auth gate replaced by a stub (same approach as
// src/tests/unit/pilotDriverVehicleAssignment.test.ts), because what is under
// test is the fallback ladder, not the gate.
import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LiveFeedResponse, ScheduleResponse } from '@/models/canonical';

vi.mock('@/lib/auth/authorize', () => ({
  requireUpsrtcAccess: async () => ({ id: 'test-user', email: 'ops@olympuss.us' }),
  unauthorizedResponse: () => new Response('unauthorized', { status: 401 }),
}));

function clearFixtureEnv() {
  delete process.env.NEXT_PUBLIC_DEMO_MODE;
  delete process.env.ALLOW_FIXTURE_FALLBACK;
}

beforeEach(() => {
  vi.resetModules();
  clearFixtureEnv();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearFixtureEnv();
});

async function callLive(): Promise<LiveFeedResponse> {
  const { GET } = await import('@/app/api/upsrtc/live/route');
  const response = await GET(new NextRequest('http://localhost/api/upsrtc/live'));
  return (await response.json()) as LiveFeedResponse;
}

async function callSchedule(): Promise<ScheduleResponse> {
  const { GET } = await import('@/app/api/upsrtc/schedule/route');
  const response = await GET(
    new NextRequest('http://localhost/api/upsrtc/schedule?regNum=UP25FT4823'),
  );
  return (await response.json()) as ScheduleResponse;
}

describe('GET /api/upsrtc/live', () => {
  // Would FAIL against the previous implementation, which returned the
  // bundled fixture fleet here with no opt-in of any kind.
  it('returns an explicit unavailable body with zero buses when the upstream is unreachable and the fallback is off', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')));

    const body = await callLive();

    expect(body.source).toBe('unavailable');
    expect(body.buses).toHaveLength(0);
    expect(body.recordCount).toBe(0);
    expect(body.message).toMatch(/unavailable/i);
  });

  it('serves the bundled fixture when ALLOW_FIXTURE_FALLBACK is explicitly enabled', async () => {
    process.env.ALLOW_FIXTURE_FALLBACK = '1';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')));

    const body = await callLive();

    expect(body.source).toBe('fixture');
    expect(body.buses.length).toBeGreaterThan(0);
  });

  it('serves the fixture under NEXT_PUBLIC_DEMO_MODE=1 without calling the upstream', async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = '1';
    process.env.ALLOW_FIXTURE_FALLBACK = '0';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const body = await callLive();

    expect(body.source).toBe('fixture');
    expect(body.buses.length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports an upstream that answered with zero vehicles as live, not unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'application/json' },
        text: async () => '[]',
      }),
    );

    const body = await callLive();

    expect(body.source).toBe('live');
    expect(body.stale).toBe(false);
    expect(body.buses).toHaveLength(0);
    expect(body.message).toMatch(/no vehicles/i);
  });

  it('still prefers a real last-known-good cache (flagged stale) over the unavailable state', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        text: async () =>
          JSON.stringify([
            { regNum: 'UP25FT4823', latitude: 28.35, longitude: 79.42, speed: 10, timestamp: new Date().toISOString() },
          ]),
      })
      .mockRejectedValue(new Error('network unreachable'));
    vi.stubGlobal('fetch', fetchMock);

    const { GET } = await import('@/app/api/upsrtc/live/route');

    const first = (await (await GET(new NextRequest('http://localhost/api/upsrtc/live'))).json()) as LiveFeedResponse;
    expect(first.source).toBe('live');

    // Push past the route's own 15s TTL so the next call really re-fetches.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 20_000);
    const second = (await (await GET(new NextRequest('http://localhost/api/upsrtc/live'))).json()) as LiveFeedResponse;
    vi.useRealTimers();

    expect(second.source).toBe('cache');
    expect(second.stale).toBe(true);
    expect(second.buses).toHaveLength(1);
  });
});

describe('GET /api/upsrtc/schedule', () => {
  // Would FAIL against the previous implementation, which returned the
  // bundled sample schedule here with no opt-in.
  it('returns an explicit unavailable body with no schedule when the upstream is unreachable and the fallback is off', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')));

    const body = await callSchedule();

    expect(body.source).toBe('unavailable');
    expect(body.schedule).toBeNull();
    expect(body.message).toMatch(/unavailable/i);
  });

  it('serves the bundled fixture schedule when ALLOW_FIXTURE_FALLBACK is explicitly enabled', async () => {
    process.env.ALLOW_FIXTURE_FALLBACK = 'yes';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')));

    const body = await callSchedule();

    expect(body.source).toBe('fixture');
    expect(body.schedule).not.toBeNull();
  });

  it('serves the fixture schedule under NEXT_PUBLIC_DEMO_MODE=1 without calling the upstream', async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = '1';
    process.env.ALLOW_FIXTURE_FALLBACK = '0';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const body = await callSchedule();

    expect(body.source).toBe('fixture');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
