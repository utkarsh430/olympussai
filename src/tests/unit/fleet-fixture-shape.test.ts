import { describe, expect, it } from 'vitest';
import liveSample from '@/fixtures/upsrtc-live-sample.json';
import { normalizeDepotRows } from '@/lib/upsrtc/depotNormalizer';
import { normalizeLivePayload } from '@/lib/upsrtc/normalizer';
import {
  FLEET_FIXTURE_KEYS,
  buildFleetFixture,
  filterRecord,
  stripSensitive,
} from '@/lib/upsrtc/fleetFixtureShape';

const T0 = 1_800_000_000_000;
const PERSON_KEY = /driver|conductor|mobile|phone|contact|imei|sim/i;

describe('stripSensitive', () => {
  it('drops sensitive keys and keeps the rest, without mutating the input', () => {
    const input = Object.freeze({ regNum: 'UP1', driver_name: 'x', Mobile: '1', imei: '2' });
    expect(stripSensitive(input)).toEqual({ regNum: 'UP1' });
    expect(input.driver_name).toBe('x');
  });
});

describe('filterRecord', () => {
  it('keeps only allowlisted keys and drops empty, null and "None" values', () => {
    const out = filterRecord({
      regNum: 'UP1',
      speed: 0,
      route: '',
      routename: 'None',
      delay: null,
      frameNumber: 5,
      zone_name: 'somewhere',
      driver: 'A B',
    });
    expect(out).toEqual({ regNum: 'UP1', speed: 0 });
  });

  it('allowlists no key that suggests a person', () => {
    expect(FLEET_FIXTURE_KEYS.filter((key) => PERSON_KEY.test(key))).toEqual([]);
  });

  it('does not change what either normaliser makes of the real sample', () => {
    const records = (liveSample as Record<string, unknown>[]).map(filterRecord);
    expect(normalizeDepotRows(records).rows).toEqual(normalizeDepotRows(liveSample).rows);
    expect(normalizeLivePayload(records, T0).buses).toEqual(
      normalizeLivePayload(liveSample, T0).buses,
    );
  });
});

describe('buildFleetFixture', () => {
  it('filters records, skips non-records and counts depots and routes', () => {
    const payload = [
      {
        regNum: 'UP1',
        depot_name: 'A',
        route: 7,
        routename: 'R1',
        receivedTime: '2026-07-20T07:00:00Z',
        phone: '9999999999',
      },
      { regNum: 'UP2', depot_name: 'A', route: 8, routename: 'R2' },
      { regNum: 'UP3', depot_name: 'B', route: 7, routename: 'R1' },
      'junk',
    ];
    const built = buildFleetFixture(payload);
    expect(built.records).toHaveLength(3);
    expect(JSON.stringify(built.records)).not.toContain('9999999999');
    expect(built.counts).toEqual({
      records: 3,
      depots: 2,
      routes: 2,
      feedNow: '2026-07-20T07:00:00.000Z',
    });
  });

  it('refuses a payload with no usable records', () => {
    expect(() => buildFleetFixture({ nothing: true })).toThrow(/no usable records/);
  });
});
