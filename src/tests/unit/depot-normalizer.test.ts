import { describe, expect, it } from 'vitest';
import { deriveFeedNow, normalizeDepotRows } from '@/lib/upsrtc/depotNormalizer';
import { depotBusRowSchema } from '@/models/depotLive';
import type { DepotBusRow } from '@/models/depotLive';
import liveFixture from '@/fixtures/upsrtc-live-sample.json';

const BASE_RAW = {
  regNum: 'UP78JT4102',
  latitude: 28.36,
  longitude: 79.43,
  speed: 15.34,
  ignition: 1,
  timestamp: '2026-07-20T07:01:32Z',
  receivedTime: '2026-07-20T07:01:50Z',
  home_depot: '81',
  depot_name: 'BAREILLY(R)',
  vehicle_status: 'live',
  status: 'Live',
  route: 10869,
  routename: 'BLY_9509_ORD',
  route_description: 'BAREILLY OLD BUS STATION TO ANAND VIHAR',
  vehicle_journey_id: 57833,
  vehicle_journey_code: 'BLY0524',
  scheduled_start_time: '2026-07-20T07:05:00Z',
  actual_start_time: 'None',
  scheduled_end_time: '2026-07-20T15:05:00Z',
  delay: -5.433333333333334,
  distance: 83990,
  mainPowerStatus: 1,
  mainInputVoltage: 28.08,
  tamperAlert: 'C',
  emergencyStatus: 0,
};

function makeRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...BASE_RAW, ...overrides };
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function only(overrides: Record<string, unknown>): DepotBusRow {
  const { rows } = normalizeDepotRows([makeRaw(overrides)]);
  expect(rows).toHaveLength(1);
  return rows[0] as DepotBusRow;
}

describe('normalizeDepotRows', () => {
  it('maps every field of a real record', () => {
    expect(only({})).toEqual({
      registrationNumber: 'UP78JT4102',
      latitude: 28.36,
      longitude: 79.43,
      speedKmph: 15.3,
      ignitionOn: true,
      gpsTimestamp: '2026-07-20T07:01:32.000Z',
      receivedAt: '2026-07-20T07:01:50.000Z',
      depotId: '81',
      depotName: 'BAREILLY(R)',
      vehicleStatus: 'live',
      tripStatus: 'Live',
      routeId: '10869',
      routeName: 'BLY_9509_ORD',
      routeDescription: 'BAREILLY OLD BUS STATION TO ANAND VIHAR',
      journeyId: '57833',
      journeyCode: 'BLY0524',
      scheduledStart: '2026-07-20T07:05:00.000Z',
      scheduledEnd: '2026-07-20T15:05:00.000Z',
      actualStart: null,
      delayMinutes: -5.4,
      odometerRaw: 83990,
      mainPowerOn: true,
      mainVoltage: 28.08,
      tamperCode: 'C',
      emergency: false,
    });
  });

  it('keeps a row with 0,0 or missing coordinates, position nulled', () => {
    const zero = only({ latitude: 0, longitude: 0 });
    expect([zero.latitude, zero.longitude]).toEqual([null, null]);
    const missing = only({ latitude: undefined, longitude: undefined });
    expect([missing.latitude, missing.longitude]).toEqual([null, null]);
    expect(missing.registrationNumber).toBe('UP78JT4102');
  });

  it('rejects rows without a registration and non-records, and counts them', () => {
    const result = normalizeDepotRows([makeRaw({ regNum: '' }), 'junk', makeRaw()]);
    expect(result.rows).toHaveLength(1);
    expect(result.recordCount).toBe(3);
    expect(result.rejectedRecordCount).toBe(2);
  });

  it('reads vehicleStatus only from vehicle_status', () => {
    expect(only({ vehicle_status: 'UNDER_MAINTENANCE ' }).vehicleStatus).toBe('under_maintenance');
    expect(only({ vehicle_status: 'teleporting' }).vehicleStatus).toBe('unknown');
    const row = only({ vehicle_status: 'no_signal', status: 'Live' });
    expect(row.vehicleStatus).toBe('no_signal');
    expect(row.tripStatus).toBe('Live');
  });

  it('turns sentinel strings into null', () => {
    const row = only({
      home_depot: '',
      depot_name: 'None',
      route: 'null',
      routename: '',
      scheduled_start_time: 'None',
      scheduled_end_time: '',
      vehicle_journey_id: 'None',
    });
    expect(row.depotId).toBeNull();
    expect(row.depotName).toBeNull();
    expect(row.routeId).toBeNull();
    expect(row.routeName).toBeNull();
    expect(row.scheduledStart).toBeNull();
    expect(row.scheduledEnd).toBeNull();
    expect(row.journeyId).toBeNull();
  });

  it('nulls a malformed time without throwing', () => {
    const row = only({ scheduled_start_time: '2026-07-19T1 day, 3:01:41Z' });
    expect(row.scheduledStart).toBeNull();
  });

  it('accepts only digit depot ids', () => {
    expect(only({ home_depot: '81' }).depotId).toBe('81');
    expect(only({ home_depot: 81 }).depotId).toBe('81');
    expect(only({ home_depot: 'DEPOT-81' }).depotId).toBeNull();
    expect(only({ home_depot: '' }).depotId).toBeNull();
  });

  it('nulls a non-numeric or infinite delay', () => {
    expect(only({ delay: 'late' }).delayMinutes).toBeNull();
    expect(only({ delay: Infinity }).delayMinutes).toBeNull();
  });

  it('keeps the newest gpsTimestamp among duplicate registrations', () => {
    const { rows } = normalizeDepotRows([
      makeRaw({ timestamp: '2026-07-20T07:00:00Z', speed: 1 }),
      makeRaw({ timestamp: '2026-07-20T07:10:00Z', speed: 2 }),
      makeRaw({ timestamp: '2026-07-20T07:05:00Z', speed: 3 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.speedKmph).toBe(2);
  });

  it('unwraps a data wrapper and a JSON string payload', () => {
    expect(normalizeDepotRows({ data: [makeRaw()] }).rows).toHaveLength(1);
    expect(normalizeDepotRows(JSON.stringify([makeRaw()])).rows).toHaveLength(1);
  });

  it('returns no rows for a bare string payload', () => {
    const result = normalizeDepotRows(' Bus Not Assigned!!! ');
    expect(result.rows).toEqual([]);
    expect(result.recordCount).toBe(0);
  });

  it('does not mutate its input', () => {
    const input = deepFreeze([makeRaw(), makeRaw({ regNum: 'UP80A1' })]);
    expect(() => normalizeDepotRows(input)).not.toThrow();
  });

  it('does not force ignition on from speed', () => {
    expect(only({ ignition: 0, speed: 40 }).ignitionOn).toBe(false);
  });
});

describe('deriveFeedNow', () => {
  it('returns the newest receivedAt, or null', () => {
    const { rows } = normalizeDepotRows([
      makeRaw({ receivedTime: '2026-07-20T07:01:50Z' }),
      makeRaw({ regNum: 'B', receivedTime: '2026-07-20T07:09:00Z' }),
      makeRaw({ regNum: 'C', receivedTime: 'None' }),
    ]);
    expect(deriveFeedNow(rows)).toBe('2026-07-20T07:09:00.000Z');
    expect(deriveFeedNow([])).toBeNull();
    expect(deriveFeedNow(normalizeDepotRows([makeRaw({ receivedTime: 'None' })]).rows)).toBeNull();
  });
});

describe('fixture', () => {
  it('projects every record, schema-valid, across 113 depots', () => {
    const { rows } = normalizeDepotRows(liveFixture);
    expect(rows).toHaveLength(400);
    for (const row of rows) expect(depotBusRowSchema.safeParse(row).success).toBe(true);
    expect(new Set(rows.map((row) => row.depotId).filter((id) => id !== null)).size).toBe(113);
  });
});
