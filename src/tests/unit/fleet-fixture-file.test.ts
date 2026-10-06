import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { normalizeDepotRows } from '@/lib/upsrtc/depotNormalizer';
import { normalizeLivePayload } from '@/lib/upsrtc/normalizer';
import { FLEET_FIXTURE_KEYS } from '@/lib/upsrtc/fleetFixtureShape';

const FILE = path.join(process.cwd(), 'src', 'fixtures', 'upsrtc-fleet-sample.json.gz');
const present = existsSync(FILE);
const T0 = 1_800_000_000_000;

const PERSON_KEY = /driver|conductor|mobile|phone|contact|imei|sim\b|simno/i;
const TEN_DIGITS = /\d{10,}/;

function readRecords(): Record<string, unknown>[] {
  return JSON.parse(gunzipSync(readFileSync(FILE)).toString('utf8')) as Record<string, unknown>[];
}

/** Fractions (coordinates, timestamps' seconds, delays) are not identifiers. */
function integerPart(value: unknown): string {
  return String(value).replace(/\.\d+/g, '');
}

describe.skipIf(!present)('the generated full-fleet fixture', () => {
  const records = present ? readRecords() : [];

  it('is a full fleet', () => {
    expect(records.length).toBeGreaterThan(5_000);
    const depots = new Set(records.map((r) => r['depot_name']).filter(Boolean));
    expect(depots.size).toBeGreaterThan(100);
  });

  it('holds no key outside the allowlist, and none that suggests a person', () => {
    const allowed = new Set(FLEET_FIXTURE_KEYS);
    const offenders = new Set<string>();
    for (const record of records) {
      for (const key of Object.keys(record)) {
        if (!allowed.has(key) || PERSON_KEY.test(key)) offenders.add(key);
      }
    }
    expect([...offenders]).toEqual([]);
  });

  it('holds no value that looks like a phone number', () => {
    const offenders = new Set<string>();
    for (const record of records) {
      for (const [key, value] of Object.entries(record)) {
        if (TEN_DIGITS.test(integerPart(value))) offenders.add(key);
      }
    }
    expect([...offenders]).toEqual([]);
  });

  it('parses through both normalisers and drops nothing the live path would keep', () => {
    const depot = normalizeDepotRows(records);
    const live = normalizeLivePayload(records, T0);
    expect(depot.rejectedRecordCount).toBe(0);
    expect(live.rejectedRecordCount).toBe(0);
    expect(depot.rows.length).toBeGreaterThan(5_000);
    expect(live.buses.length).toBeGreaterThan(5_000);
    expect(depot.recordCount).toBe(records.length);
  });
});
