import { describe, expect, it } from 'vitest';
import { normalizeDepotRows } from '@/lib/upsrtc/depotNormalizer';
import { normalizeLivePayload } from '@/lib/upsrtc/normalizer';

const NOW = Date.parse('2026-07-20T08:00:00.000Z');

function raw(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    regNum: 'UP78JT4102',
    latitude: 28.36,
    longitude: 79.43,
    timestamp: '2026-07-20T07:00:00Z',
    receivedTime: '2026-07-20T07:00:10Z',
    home_depot: '81',
    ...overrides,
  };
}

/** The row each projection keeps, told apart by the speed each candidate carries. */
function picks(payload: readonly unknown[]): { map: number | null; depot: number | null } {
  const map = normalizeLivePayload(payload, NOW).buses;
  const depot = normalizeDepotRows(payload).rows;
  expect(map).toHaveLength(1);
  expect(depot).toHaveLength(1);
  return { map: map[0]?.speedKmph ?? null, depot: depot[0]?.speedKmph ?? null };
}

describe('repeated registrations: the depot projection keeps the row the map keeps', () => {
  it('keeps the older row with a fix over a newer row without one', () => {
    const payload = [
      raw({ speed: 1, home_depot: '81', timestamp: '2026-07-20T07:00:00Z' }),
      // Newer, but at 0,0: the "no fix" sentinel the map refuses.
      raw({
        speed: 2,
        home_depot: '92',
        timestamp: '2026-07-20T07:30:00Z',
        latitude: 0,
        longitude: 0,
      }),
    ];
    expect(picks(payload)).toEqual({ map: 1, depot: 1 });
    expect(normalizeDepotRows(payload).rows[0]?.depotId).toBe('81');
  });

  it('keeps a later row with a fix over an earlier one without, whatever the order', () => {
    const payload = [
      raw({ speed: 2, timestamp: '2026-07-20T07:30:00Z', latitude: null, longitude: null }),
      raw({ speed: 1, timestamp: '2026-07-20T07:00:00Z' }),
    ];
    expect(picks(payload)).toEqual({ map: 1, depot: 1 });
  });

  it('reads the time as the map does, falling back to the receive time', () => {
    const payload = [
      raw({ speed: 1, timestamp: undefined, receivedTime: '2026-07-20T07:10:00Z' }),
      raw({ speed: 2, timestamp: undefined, receivedTime: '2026-07-20T07:20:00Z' }),
    ];
    expect(picks(payload)).toEqual({ map: 2, depot: 2 });
  });

  it('keeps the first row on equal times, as the map does', () => {
    const payload = [raw({ speed: 1 }), raw({ speed: 2 })];
    expect(picks(payload)).toEqual({ map: 1, depot: 1 });
  });

  it('keeps the newest row when no row has a fix', () => {
    const { rows } = normalizeDepotRows([
      raw({ speed: 1, latitude: null, timestamp: '2026-07-20T07:00:00Z' }),
      raw({ speed: 2, latitude: null, timestamp: '2026-07-20T07:20:00Z' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.speedKmph).toBe(2);
  });
});
