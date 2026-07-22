import { describe, it, expect } from 'vitest';
import {
  normalizeLivePayload,
  normalizeSchedulePayload,
  isValidCoordinate,
  classifyDataQuality,
  extractArray,
  toNumber,
} from '@/lib/upsrtc/normalizer';

/** Shape mirrors the real upstream record discovered via scripts/inspect-upsrtc-api.ts */
function upstreamBus(overrides: Record<string, unknown> = {}) {
  return {
    regNum: 'UP25FT4823',
    latitude: 28.356138,
    longitude: 79.42025,
    speed: 42.5,
    heading: 253.2,
    depot_name: 'ROHILKHAND',
    route: 6842,
    routename: 'RKD_4560_ORD_OUT',
    vehicle_journey_code: 'RKD0399',
    vehicle_journey_id: 30396,
    timestamp: new Date().toISOString(),
    ignition: 1,
    status: 'Live',
    ...overrides,
  };
}

describe('coordinate validation', () => {
  it('accepts coordinates inside valid ranges', () => {
    expect(isValidCoordinate(28.35, 79.42)).toBe(true);
    expect(isValidCoordinate(-89.9, 179.9)).toBe(true);
  });

  it('rejects the zero-zero null island sentinel', () => {
    expect(isValidCoordinate(0, 0)).toBe(false);
  });

  it('rejects out-of-range values', () => {
    expect(isValidCoordinate(91, 20)).toBe(false);
    expect(isValidCoordinate(20, 181)).toBe(false);
    expect(isValidCoordinate(-91, 20)).toBe(false);
  });

  it('rejects nulls and non-finite numbers', () => {
    expect(isValidCoordinate(null, 79)).toBe(false);
    expect(isValidCoordinate(28, null)).toBe(false);
    expect(isValidCoordinate(Number.NaN, 79)).toBe(false);
  });

  it('accepts a valid non-zero latitude paired with zero longitude', () => {
    // Only exact 0,0 is the sentinel — 0 longitude alone is legitimate.
    expect(isValidCoordinate(28.35, 0)).toBe(true);
  });
});

describe('numeric coercion', () => {
  it('parses numeric strings from PHP payloads', () => {
    expect(toNumber('42.5')).toBe(42.5);
    expect(toNumber(42.5)).toBe(42.5);
  });

  it('returns null for unparseable values', () => {
    expect(toNumber('')).toBeNull();
    expect(toNumber('abc')).toBeNull();
    expect(toNumber(null)).toBeNull();
    expect(toNumber(undefined)).toBeNull();
  });
});

describe('payload unwrapping', () => {
  it('handles a bare array', () => {
    expect(extractArray([{ a: 1 }])).toHaveLength(1);
  });

  it('handles wrapper objects', () => {
    expect(extractArray({ data: [{ a: 1 }] })).toHaveLength(1);
    expect(extractArray({ result: [{ a: 1 }] })).toHaveLength(1);
    expect(extractArray({ vehicles: [{ a: 1 }] })).toHaveLength(1);
    expect(extractArray({ buses: [{ a: 1 }] })).toHaveLength(1);
  });

  it('handles JSON text nested inside JSON', () => {
    expect(extractArray(JSON.stringify([{ a: 1 }]))).toHaveLength(1);
    expect(extractArray({ data: JSON.stringify([{ a: 1 }, { b: 2 }]) })).toHaveLength(2);
  });

  it('returns an empty array for the upstream "Bus Not Assigned" string', () => {
    // Real upstream behaviour: HTTP 200 with a bare JSON string body.
    expect(extractArray(' Bus Not Assigned!!! ')).toEqual([]);
  });

  it('does not recurse infinitely on deeply nested wrappers', () => {
    let nested: unknown = [{ a: 1 }];
    for (let i = 0; i < 12; i += 1) nested = { data: nested };
    expect(() => extractArray(nested)).not.toThrow();
  });
});

describe('live payload normalization', () => {
  it('normalizes a realistic upstream record', () => {
    const { buses } = normalizeLivePayload([upstreamBus()]);
    expect(buses).toHaveLength(1);

    const bus = buses[0]!;
    expect(bus.registrationNumber).toBe('UP25FT4823');
    expect(bus.latitude).toBeCloseTo(28.356138);
    expect(bus.longitude).toBeCloseTo(79.42025);
    expect(bus.speedKmph).toBe(42.5);
    expect(bus.headingDegrees).toBeCloseTo(253.2);
    expect(bus.depotName).toBe('ROHILKHAND');
    expect(bus.routeName).toBe('RKD_4560_ORD_OUT');
    expect(bus.ignitionOn).toBe(true);
    expect(bus.rawStatus).toBe('Live');
  });

  describe('ignition', () => {
    it('reports ON for a moving bus even when the ignition line says otherwise', () => {
      const { buses } = normalizeLivePayload([upstreamBus({ speed: 34.2, ignition: 0 })]);
      expect(buses[0]?.ignitionOn).toBe(true);
    });

    it('leaves a stationary bus reporting its own ignition state', () => {
      const off = normalizeLivePayload([upstreamBus({ speed: 0, ignition: 0 })]);
      expect(off.buses[0]?.ignitionOn).toBe(false);

      // Idling at a stand: stopped, but the engine is genuinely running.
      const idling = normalizeLivePayload([upstreamBus({ speed: 0, ignition: 1 })]);
      expect(idling.buses[0]?.ignitionOn).toBe(true);
    });

    it('stays unknown when a stationary bus reports no ignition at all', () => {
      const { buses } = normalizeLivePayload([upstreamBus({ speed: 0, ignition: null })]);
      expect(buses[0]?.ignitionOn).toBeNull();
    });
  });

  describe('trip date', () => {
    it('takes the operating date from scheduled_start_time', () => {
      const { buses } = normalizeLivePayload([
        upstreamBus({ scheduled_start_time: '2026-07-19T22:40:00Z' }),
      ]);
      // Read literally: the Z suffix is a lie, the value is already IST, and
      // parsing it would slide a late departure onto the following day.
      expect(buses[0]?.tripDate).toBe('2026-07-19');
    });

    it('is null when the vehicle carries no assignment', () => {
      const { buses } = normalizeLivePayload([upstreamBus({ scheduled_start_time: 'None' })]);
      expect(buses[0]?.tripDate).toBeNull();
    });
  });

  it('supports registration-number aliases', () => {
    const aliases = [
      'reg_num', 'registration_number', 'registrationNo', 'vehicle_no',
      'vehicleNumber', 'veh_no', 'bus_no', 'busNumber',
    ];

    for (const alias of aliases) {
      const { buses } = normalizeLivePayload([
        { [alias]: 'UP77AN2509', latitude: 26.8, longitude: 80.9 },
      ]);
      expect(buses[0]?.registrationNumber, `alias ${alias}`).toBe('UP77AN2509');
    }
  });

  it('supports latitude and longitude aliases', () => {
    const { buses } = normalizeLivePayload([
      { regNum: 'UP77AN2509', gps_lat: 26.8, gpsLongitude: 80.9 },
    ]);
    expect(buses[0]?.latitude).toBe(26.8);
    expect(buses[0]?.longitude).toBe(80.9);
  });

  it('rejects records with invalid coordinates and counts them', () => {
    const result = normalizeLivePayload([
      upstreamBus(),
      upstreamBus({ regNum: 'UP11AA1111', latitude: 0, longitude: 0 }),
      upstreamBus({ regNum: 'UP22BB2222', latitude: 999, longitude: 80 }),
      upstreamBus({ regNum: null }),
    ]);

    expect(result.buses).toHaveLength(1);
    expect(result.rejectedRecordCount).toBe(3);
    expect(result.recordCount).toBe(4);
  });

  it('merges duplicate registrations keeping the latest timestamp', () => {
    const older = new Date('2026-07-20T10:00:00Z').toISOString();
    const newer = new Date('2026-07-20T10:05:00Z').toISOString();

    const { buses } = normalizeLivePayload([
      upstreamBus({ timestamp: older, latitude: 20, longitude: 70 }),
      upstreamBus({ timestamp: newer, latitude: 28.9, longitude: 79.9 }),
    ]);

    expect(buses).toHaveLength(1);
    expect(buses[0]?.latitude).toBeCloseTo(28.9);
  });

  it('normalizes heading into the 0-360 range', () => {
    const { buses } = normalizeLivePayload([upstreamBus({ heading: -45 })]);
    expect(buses[0]?.headingDegrees).toBe(315);
  });

  it('treats the string "None" as absent', () => {
    const { buses } = normalizeLivePayload([upstreamBus({ depot_name: 'None' })]);
    expect(buses[0]?.depotName).toBeNull();
  });

  it('handles a completely empty payload without throwing', () => {
    expect(normalizeLivePayload([]).buses).toEqual([]);
    expect(normalizeLivePayload(null).buses).toEqual([]);
    expect(normalizeLivePayload('not json').buses).toEqual([]);
  });
});

describe('data-quality classification', () => {
  const now = Date.parse('2026-07-20T12:00:00Z');

  it('labels a recent fix as good', () => {
    expect(classifyDataQuality('2026-07-20T11:58:00Z', now)).toBe('good');
  });

  it('labels a 5-30 minute old fix as degraded', () => {
    expect(classifyDataQuality('2026-07-20T11:45:00Z', now)).toBe('degraded');
  });

  it('labels a fix older than 30 minutes as stale', () => {
    expect(classifyDataQuality('2026-07-20T10:00:00Z', now)).toBe('stale');
  });

  it('labels a missing or unparseable timestamp as stale', () => {
    expect(classifyDataQuality(null, now)).toBe('stale');
    expect(classifyDataQuality('not-a-date', now)).toBe('stale');
  });
});

describe('schedule normalization', () => {
  const upstreamStops = [
    {
      vj_id: 30396,
      atco_code: 14035,
      stop_sequence: 1,
      stop_name: 'BAREILLY OLD BUS STATION',
      RouteName: 'RKD_4560_ORD_OUT',
      route_description: 'BAREILLY OLD BUS STATION TO RUDRAPUR VIA KICHHA',
      scheduled_time: '10:06:00',
      Latitude: 28.358965,
      Longitude: 79.41976,
    },
    {
      vj_id: 30396,
      atco_code: 20851,
      stop_sequence: 2,
      stop_name: 'IZATNAGAR',
      RouteName: 'RKD_4560_ORD_OUT',
      route_description: 'BAREILLY OLD BUS STATION TO RUDRAPUR VIA KICHHA',
      scheduled_time: '10:27:45',
      Latitude: 0.0,
      Longitude: 0.0,
    },
    {
      vj_id: 30396,
      atco_code: 10537,
      stop_sequence: 3,
      stop_name: 'BHOJIPURA',
      RouteName: 'RKD_4560_ORD_OUT',
      route_description: 'BAREILLY OLD BUS STATION TO RUDRAPUR VIA KICHHA',
      scheduled_time: '10:51:28',
      Latitude: 28.49592,
      Longitude: 79.44753,
    },
  ];

  it('normalizes a realistic schedule payload', () => {
    const schedule = normalizeSchedulePayload(upstreamStops, 'UP25FT4823', '2026-07-20');
    expect(schedule).not.toBeNull();
    expect(schedule?.registrationNumber).toBe('UP25FT4823');
    expect(schedule?.stops).toHaveLength(3);
    expect(schedule?.routeName).toBe('RKD_4560_ORD_OUT');
    expect(schedule?.direction).toBe('OUT');
  });

  it('nulls out stop coordinates reported as 0,0 upstream', () => {
    const schedule = normalizeSchedulePayload(upstreamStops, 'UP25FT4823', '2026-07-20');
    const izatnagar = schedule?.stops.find((stop) => stop.name === 'IZATNAGAR');
    expect(izatnagar?.latitude).toBeNull();
    expect(izatnagar?.longitude).toBeNull();

    const bareilly = schedule?.stops.find((stop) => stop.sequence === 1);
    expect(bareilly?.latitude).toBeCloseTo(28.358965);
  });

  it('derives origin and destination from the route description', () => {
    const schedule = normalizeSchedulePayload(upstreamStops, 'UP25FT4823', '2026-07-20');
    expect(schedule?.originName).toBe('BAREILLY OLD BUS STATION');
    expect(schedule?.destinationName).toBe('RUDRAPUR');
  });

  it('sorts stops by sequence', () => {
    const shuffled = [upstreamStops[2], upstreamStops[0], upstreamStops[1]];
    const schedule = normalizeSchedulePayload(shuffled, 'UP25FT4823', '2026-07-20');
    expect(schedule?.stops.map((stop) => stop.sequence)).toEqual([1, 2, 3]);
  });

  describe('multi-trip responses', () => {
    /**
     * A real day's response for one bus: several vehicle journeys concatenated,
     * each restarting stop_sequence at 1.
     */
    const secondTrip = [
      {
        vj_id: 44286,
        atco_code: 19001,
        stop_sequence: 1,
        stop_name: 'RUDRAPUR',
        RouteName: 'RKD_4560_ORD_IN',
        route_description: 'RUDRAPUR TO BAREILLY OLD BUS STATION',
        scheduled_time: '14:10:00',
        Latitude: 28.98,
        Longitude: 79.4,
      },
      {
        vj_id: 44286,
        atco_code: 14035,
        stop_sequence: 2,
        stop_name: 'BAREILLY OLD BUS STATION',
        RouteName: 'RKD_4560_ORD_IN',
        route_description: 'RUDRAPUR TO BAREILLY OLD BUS STATION',
        scheduled_time: '16:40:00',
        Latitude: 28.358965,
        Longitude: 79.41976,
      },
    ];
    const wholeDay = [...upstreamStops, ...secondTrip];

    it('returns only the journey matching the live trip id', () => {
      const schedule = normalizeSchedulePayload(wholeDay, 'UP25FT4823', '2026-07-20', '44286');
      expect(schedule?.stops).toHaveLength(2);
      expect(schedule?.originName).toBe('RUDRAPUR');
      expect(schedule?.destinationName).toBe('BAREILLY OLD BUS STATION');
      expect(schedule?.direction).toBe('IN');
      expect(schedule?.tripCount).toBe(2);
    });

    it('does not merge trips into one fictitious journey', () => {
      // Merging would yield 5 stops and an origin/destination spanning both.
      const schedule = normalizeSchedulePayload(wholeDay, 'UP25FT4823', '2026-07-20', '30396');
      expect(schedule?.stops).toHaveLength(3);
      expect(schedule?.scheduledDeparture).toBe('10:06:00');
      expect(schedule?.scheduledArrival).toBe('10:51:28');
    });

    it('falls back to the earliest-departing trip when the id is unknown', () => {
      for (const hint of [undefined, null, '99999']) {
        const schedule = normalizeSchedulePayload(wholeDay, 'UP25FT4823', '2026-07-20', hint);
        expect(schedule?.stops, `hint ${String(hint)}`).toHaveLength(3);
        expect(schedule?.scheduledDeparture).toBe('10:06:00');
      }
    });

    it('reports a single trip as tripCount 1', () => {
      const schedule = normalizeSchedulePayload(upstreamStops, 'UP25FT4823', '2026-07-20');
      expect(schedule?.tripCount).toBe(1);
    });

    it('keeps stop ids unique when upstream repeats a sequence within a trip', () => {
      const duplicated = [upstreamStops[0], upstreamStops[0], upstreamStops[1]];
      const schedule = normalizeSchedulePayload(duplicated, 'UP25FT4823', '2026-07-20');
      const ids = schedule?.stops.map((stop) => stop.id) ?? [];
      expect(new Set(ids).size, `ids: ${ids.join()}`).toBe(ids.length);
    });
  });

  it('returns null for the upstream "Bus Not Assigned" response', () => {
    expect(normalizeSchedulePayload(' Bus Not Assigned!!! ', 'UP78KT8662', '2026-07-20')).toBeNull();
  });

  it('returns null for an empty array', () => {
    expect(normalizeSchedulePayload([], 'UP78KT8662', '2026-07-20')).toBeNull();
  });

  it('exposes first departure and last arrival', () => {
    const schedule = normalizeSchedulePayload(upstreamStops, 'UP25FT4823', '2026-07-20');
    expect(schedule?.scheduledDeparture).toBe('10:06:00');
    expect(schedule?.scheduledArrival).toBe('10:51:28');
  });
});
