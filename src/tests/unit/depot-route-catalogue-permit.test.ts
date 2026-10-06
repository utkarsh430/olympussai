import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DepotBusRow } from '@/models/depotLive';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';
import type { BusScheduleOptions } from '@/lib/upsrtc/scheduleService';

vi.mock('@/lib/upsrtc/scheduleService', () => ({ fetchBusSchedule: vi.fn() }));

import { fetchBusSchedule } from '@/lib/upsrtc/scheduleService';
import {
  getRouteProfile,
  inFlightSizeForTests,
  resetRouteCatalogueForTests,
} from '@/lib/depot/routes/routeCatalogue';

/**
 * The route lookup passes the caller's permit to the schedule service, which asks it
 * before each call to the schedule server. A refusal is answered as "limited", with
 * the wait the permit gave, and nothing about it is remembered.
 */

const mockService = vi.mocked(fetchBusSchedule);
const T0 = 1_800_000_000_000;
const FEED_NOW = '2026-10-06T10:00:00.000Z';
const ROUTE = 'RKD_4560_ORD_OUT';
const WAIT_SECONDS = 42;

const bus = { registrationNumber: 'UP1', routeName: ROUTE, journeyId: '30396' };
const view: FleetSnapshotView = {
  rows: [{ ...bus, scheduledStart: '2026-10-06T08:00:00.000Z' } as unknown as DepotBusRow],
  feedNow: FEED_NOW,
  fetchedAt: FEED_NOW,
  source: 'live',
  stale: false,
  recordCount: 1,
};

/** The service as it behaves with a permit: it asks before its one call, and stops when refused. */
function serviceAsking(): void {
  mockService.mockImplementation(async (_input, _now, options?: BusScheduleOptions) => {
    if (options?.beforeUpstreamCall && !options.beforeUpstreamCall()) {
      throw new Error('stopped');
    }
    return { schedule: null, fetchedAt: FEED_NOW, source: 'live', stale: false };
  });
}

const granted = { limited: false, retryAfterSeconds: 0 } as const;
const refused = { limited: true, retryAfterSeconds: WAIT_SECONDS } as const;

describe('getRouteProfile with a permit', () => {
  beforeEach(() => {
    resetRouteCatalogueForTests();
    mockService.mockReset();
    serviceAsking();
  });

  it('passes no permit to the service when the caller gives none', async () => {
    await getRouteProfile(ROUTE, view, T0);
    expect(mockService.mock.calls[0]?.[2]).toStrictEqual({
      today: '2026-10-06',
      requireEveryDateAnswered: true,
    });
  });

  it('asks the permit before the call the service makes', async () => {
    const permit = vi.fn(() => granted);
    const result = await getRouteProfile(ROUTE, view, T0, permit);
    expect(result).toEqual({ status: 'unavailable', reason: 'no_schedule' });
    expect(permit).toHaveBeenCalledTimes(1);
  });

  it('answers limited with the wait when a call is refused, and remembers nothing', async () => {
    const result = await getRouteProfile(ROUTE, view, T0, () => refused);
    expect(result).toEqual({ status: 'limited', retryAfterSeconds: WAIT_SECONDS });
    expect(inFlightSizeForTests()).toBe(0);
    // Not cached as an answer or a failure: the next request asks the server again.
    const permit = vi.fn(() => granted);
    expect((await getRouteProfile(ROUTE, view, T0, permit)).status).toBe('unavailable');
    expect(permit).toHaveBeenCalledTimes(1);
    expect(mockService).toHaveBeenCalledTimes(2);
  });

  it('still answers upstream_error when the service fails for any other reason', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockService.mockRejectedValueOnce(new Error('boom'));
    const result = await getRouteProfile(ROUTE, view, T0, () => granted);
    expect(result).toEqual({ status: 'unavailable', reason: 'upstream_error' });
    spy.mockRestore();
  });

  it('gives a request that joined a refused lookup the same answer', async () => {
    const first = getRouteProfile(ROUTE, view, T0, () => refused);
    const joined = getRouteProfile(ROUTE, view, T0, () => granted);
    expect(await joined).toEqual(await first);
    expect(mockService).toHaveBeenCalledTimes(1);
  });
});
