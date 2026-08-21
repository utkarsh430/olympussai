// The network-wide occupancy switch: the row, the cache, and the failure mode.
//
// ─── WHAT THE SWITCH ACTUALLY DOES ───────────────────────────────────────
//
// OFF (the default) the objective weighs exactly two things: the waiting that
// even spacing minimises, and the lateness that punctuality minimises - the
// operator's two stated priorities. ON it adds the in-vehicle term, which
// prices the delay a hold imposes on the people already aboard.
//
// ON is not simply "more considerate". The exchange rate between those two
// groups is lambda, and lambda is still proxied as 1/H*, under which the
// in-vehicle term costs H*/2 seconds of hold PER PASSENGER. Turning the switch
// on before lambda is calibrated does not make the controller kinder; it makes
// it stop proposing anything. That is why OFF is the default, why the fallback
// on a failed read is OFF, and why the arithmetic is pinned in
// test/costOptimalAndSelection.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  readControlSettings,
  writeControlSettings,
  SETTINGS_FALLBACK,
  _resetSettingsCacheForTests,
} from '../src/db/settings.js';
import { liveOnboardCount } from '../src/mpc/objective.js';
import type { RoutePolicyRow, VehicleStateRow } from '../src/state/store.js';

function fakePool(rows: unknown[]) {
  return { query: vi.fn(() => Promise.resolve({ rows })) } as never;
}

function failingPool() {
  return { query: vi.fn(() => Promise.reject(new Error('pool is down'))) } as never;
}

const SETTINGS_ROW = {
  weigh_occupancy: true,
  updated_at: '2026-08-20T09:00:00.000Z',
  updated_by: 'operator@example.com',
  update_reason: 'lambda calibrated from March boardings',
};

beforeEach(() => {
  _resetSettingsCacheForTests();
});

describe('readControlSettings', () => {
  it('reads the singleton row', async () => {
    const settings = await readControlSettings(fakePool([SETTINGS_ROW]));
    expect(settings.weighOccupancy).toBe(true);
    expect(settings.updatedBy).toBe('operator@example.com');
    expect(settings.updateReason).toContain('lambda calibrated');
  });

  it('caches, so a decision cycle over many corridors costs one query', async () => {
    const pool = fakePool([SETTINGS_ROW]);
    await readControlSettings(pool);
    await readControlSettings(pool);
    await readControlSettings(pool);
    expect((pool as unknown as { query: { mock: { calls: unknown[] } } }).query.mock.calls).toHaveLength(1);
  });

  // THE ONE THAT MATTERS. This read sits on the solver's hot path, which had
  // no database read at all before it. Letting a query failure propagate would
  // turn a hiccup on one small config table into the controller proposing
  // nothing on every corridor at once.
  it('falls back to occupancy OFF rather than failing the solve', async () => {
    const settings = await readControlSettings(failingPool());
    expect(settings).toEqual(SETTINGS_FALLBACK);
    expect(settings.weighOccupancy).toBe(false);
  });

  // A cached failure would pin the fallback for the full TTL and hide a
  // setting the operator had already turned on.
  it('does not cache a failure', async () => {
    const pool = failingPool();
    await readControlSettings(pool);
    await readControlSettings(pool);
    expect((pool as unknown as { query: { mock: { calls: unknown[] } } }).query.mock.calls).toHaveLength(2);
  });

  // Only reachable if somebody deleted the seeded row. A missing switch reads
  // as "off"; it must not take the controller down.
  it('treats a missing row as the default rather than an error', async () => {
    expect(await readControlSettings(fakePool([]))).toEqual(SETTINGS_FALLBACK);
  });
});

describe('writeControlSettings', () => {
  it('records who changed it and why, and invalidates the cache immediately', async () => {
    const readPool = fakePool([{ ...SETTINGS_ROW, weigh_occupancy: false }]);
    expect((await readControlSettings(readPool)).weighOccupancy).toBe(false);

    const writePool = fakePool([SETTINGS_ROW]);
    const written = await writeControlSettings(
      {
        weighOccupancy: true,
        updatedBy: 'operator@example.com',
        updateReason: 'lambda calibrated from March boardings',
      },
      writePool,
    );
    expect(written.weighOccupancy).toBe(true);

    // The next read goes back to the database rather than serving the stale
    // cached value - an operator who flips a switch looks straight at the
    // screen to see whether it worked.
    const afterPool = fakePool([SETTINGS_ROW]);
    expect((await readControlSettings(afterPool)).weighOccupancy).toBe(true);
    expect((afterPool as unknown as { query: { mock: { calls: unknown[] } } }).query.mock.calls).toHaveLength(1);
  });
});

describe('liveOnboardCount honours the switch', () => {
  const policy = { occupancyStaleSeconds: null } as RoutePolicyRow;
  const now = new Date('2026-08-20T09:00:00.000Z');
  const loaded = {
    vehicleId: 'bus-1',
    occupancyCount: 42,
    observedAt: now.toISOString(),
  } as VehicleStateRow;

  it('reports the load when the switch is on', () => {
    expect(liveOnboardCount(loaded, policy, now, true)).toBe(42);
  });

  // Null, not zero. Null is already this function's word for "do not weigh a
  // load", so the switch reuses the meaning every caller already handles
  // rather than introducing a second way of saying it.
  it('reports NO load when the switch is off, whatever the bus is carrying', () => {
    expect(liveOnboardCount(loaded, policy, now, false)).toBeNull();
  });

  it('still reports no load when the switch is on but nothing is measured', () => {
    const unmeasured = { ...loaded, occupancyCount: null } as VehicleStateRow;
    expect(liveOnboardCount(unmeasured, policy, now, true)).toBeNull();
  });
});
