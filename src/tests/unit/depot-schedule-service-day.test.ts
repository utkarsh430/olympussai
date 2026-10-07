import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpstreamFetchResult } from '@/lib/upsrtc/client';
import type { ScheduledTrip } from '@/lib/depot/service/types';
import scheduleFixture from '@/fixtures/upsrtc-schedule-sample.json';

vi.mock('@/lib/upsrtc/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/upsrtc/client')>()),
  fetchUpstream: vi.fn(),
}));

import { fetchUpstream } from '@/lib/upsrtc/client';

/*
 * The schedule service hands a caller that asks for it the whole day of trips the
 * server answered with, beside the one trip it always returns. Only the server is
 * mocked; the fixture stand-in never hands a day.
 */

const mockFetch = vi.mocked(fetchUpstream);
const T0 = Date.UTC(2026, 9, 6, 6, 0, 0);
const TODAY = '2026-10-06';
const NOT_ASSIGNED = ' Bus Not Assigned!!! ';

const ok = (payload: unknown): UpstreamFetchResult => ({
  ok: true, status: 200, contentType: 'application/json', payload,
});
const fail: UpstreamFetchResult = {
  ok: false, status: 502, contentType: 'unknown', payload: null, error: 'HTTP 502',
};

type Service = typeof import('@/lib/upsrtc/scheduleService');
let service: Service;

beforeEach(async () => {
  vi.resetModules();
  mockFetch.mockReset();
  delete process.env.NEXT_PUBLIC_DEMO_MODE;
  service = await import('@/lib/upsrtc/scheduleService');
});
afterEach(() => {
  delete process.env.NEXT_PUBLIC_DEMO_MODE;
});

async function lookUp(regNum: string): Promise<readonly ScheduledTrip[][]> {
  const days: ScheduledTrip[][] = [];
  await service.fetchBusSchedule({ regNum, date: TODAY, tripId: null }, T0, {
    today: TODAY,
    requireEveryDateAnswered: true,
    onDay: (trips) => days.push([...trips]),
  });
  return days;
}

describe('the schedule service day hand-off', () => {
  it('hands every trip of the answered day, stamped with the date that answered', async () => {
    mockFetch.mockResolvedValue(ok(scheduleFixture));
    const days = await lookUp('UP78JT4102');
    expect(days).toHaveLength(1);
    expect(days[0]).toHaveLength(4);
    expect(days[0]?.every((t) => t.answeredDate === TODAY && t.registrationNumber === 'UP78JT4102'))
      .toBe(true);
  });

  it('says which earlier date answered when the requested date was not assigned', async () => {
    mockFetch.mockImplementation(async (url) =>
      new URL(String(url)).searchParams.get('date') === '2026-10-05'
        ? ok(scheduleFixture)
        : ok(NOT_ASSIGNED),
    );
    const days = await lookUp('UP78JT4103');
    expect(days[0]?.[0]?.answeredDate).toBe('2026-10-05');
  });

  it('hands the cached day again on a cache hit, with no call', async () => {
    mockFetch.mockResolvedValue(ok(scheduleFixture));
    await lookUp('UP78JT4104');
    const calls = mockFetch.mock.calls.length;
    const again = await lookUp('UP78JT4104');
    expect(mockFetch.mock.calls.length).toBe(calls);
    expect(again[0]).toHaveLength(4);
  });

  it('hands nothing for "not assigned", a failure or the fixture stand-in', async () => {
    mockFetch.mockResolvedValue(ok(NOT_ASSIGNED));
    expect(await lookUp('UP78JT4105')).toEqual([]);
    mockFetch.mockResolvedValue(fail);
    expect(await lookUp('UP78JT4106')).toEqual([]);
    process.env.NEXT_PUBLIC_DEMO_MODE = '1';
    expect(await lookUp('UP78JT4107')).toEqual([]);
  });

  it('keeps the one-trip answer unchanged for a caller that does not ask for the day', async () => {
    mockFetch.mockResolvedValue(ok(scheduleFixture));
    const response = await service.fetchBusSchedule(
      { regNum: 'UP78JT4108', date: TODAY, tripId: null }, T0, { today: TODAY },
    );
    expect(response.schedule?.tripCount).toBe(4);
    const sent = JSON.parse(JSON.stringify(response)) as object;
    expect(Object.keys(sent).sort()).toEqual(['fetchedAt', 'schedule', 'source', 'stale']);
  });
});
