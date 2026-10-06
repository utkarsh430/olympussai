import { describe, expect, it } from 'vitest';
import { MAX_ROW_TEXT_CHARS, normalizeDepotRows } from '@/lib/upsrtc/depotNormalizer';

const BASE = {
  regNum: 'UP78JT4102',
  latitude: 28.36,
  longitude: 79.43,
  timestamp: '2026-07-20T07:01:32Z',
  receivedTime: '2026-07-20T07:01:50Z',
  home_depot: '81',
  depot_name: 'BAREILLY(R)',
  routename: 'BLY_9509_ORD',
  route_description: 'BAREILLY OLD BUS STATION TO ANAND VIHAR',
};

describe('depot projection: text fields are bounded and registrations have one spelling', () => {
  const tooLong = 'X'.repeat(MAX_ROW_TEXT_CHARS + 1);

  it('drops a text field longer than the limit instead of carrying it', () => {
    const [row] = normalizeDepotRows([
      { ...BASE, routename: tooLong, depot_name: tooLong, route_description: tooLong },
    ]).rows;
    expect(row?.routeName).toBeNull();
    expect(row?.depotName).toBeNull();
    expect(row?.routeDescription).toBeNull();
    expect(row?.registrationNumber).toBe('UP78JT4102');
  });

  it('keeps a field at exactly the limit', () => {
    const atLimit = 'R'.repeat(MAX_ROW_TEXT_CHARS);
    expect(normalizeDepotRows([{ ...BASE, routename: atLimit }]).rows[0]?.routeName).toBe(atLimit);
  });

  it('refuses a row whose registration is longer than the limit', () => {
    const result = normalizeDepotRows([{ ...BASE, regNum: tooLong }, BASE]);
    expect(result.rows).toHaveLength(1);
    expect(result.rejectedRecordCount).toBe(1);
  });

  it('upper-cases and trims registrations, so two spellings are one bus', () => {
    const { rows } = normalizeDepotRows([
      { ...BASE, regNum: ' up78jt4102 ', speed: 1, timestamp: '2026-07-20T07:00:00Z' },
      { ...BASE, regNum: 'UP78JT4102', speed: 2, timestamp: '2026-07-20T07:05:00Z' },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.registrationNumber).toBe('UP78JT4102');
    expect(rows[0]?.speedKmph).toBe(2);
  });

  it('keeps the limit well above the longest real field in the feed', () => {
    expect(MAX_ROW_TEXT_CHARS).toBeGreaterThanOrEqual(2 * BASE.route_description.length);
  });
});
