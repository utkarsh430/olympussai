import 'server-only';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { logDepotError } from '@/lib/depot/log';
import { REG_ALIASES, isRecord, pick } from '@/lib/upsrtc/normalizer';

/**
 * Lazy loader for the full-fleet offline fixture.
 *
 * The file is gzip-compressed JSON (several MB uncompressed), so it is read at
 * run time, only when the fallback is actually used, never imported: nothing is
 * bundled, read or parsed on the live path. The path is built from
 * `process.cwd()`; next.config.ts lists the file in `outputFileTracingIncludes`
 * so a standalone server output carries it.
 *
 * The result is memoised for the life of the process, failure included, so the
 * same array identity comes back every time (depot views memoise on it) and a
 * broken file is logged once, not on every request.
 */

export const FLEET_FIXTURE_RELATIVE_PATH = 'src/fixtures/upsrtc-fleet-sample.json.gz';

interface Loaded {
  readonly records: readonly unknown[] | null;
}

let loaded: Loaded | null = null;

function isUsable(value: unknown): value is readonly unknown[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => isRecord(item) && pick(item, REG_ALIASES) !== undefined)
  );
}

export type ReadBytes = (file: string) => Buffer;

function readFixture(readBytes: ReadBytes): readonly unknown[] {
  const file = path.join(process.cwd(), ...FLEET_FIXTURE_RELATIVE_PATH.split('/'));
  const parsed: unknown = JSON.parse(gunzipSync(readBytes(file)).toString('utf8'));
  if (!isUsable(parsed)) throw new Error('The full-fleet fixture is not a list of bus records');
  return parsed;
}

/**
 * The full-fleet records, or null when the file is missing, unreadable or invalid.
 * `readBytes` is a seam for tests; it only matters on the first call.
 */
export function loadFleetFixture(readBytes: ReadBytes = readFileSync): readonly unknown[] | null {
  if (loaded) return loaded.records;
  try {
    loaded = { records: readFixture(readBytes) };
  } catch (error) {
    // The caller falls back to the small bundled sample; say why, once.
    logDepotError('fleet-fixture', error);
    loaded = { records: null };
  }
  return loaded.records;
}

/** Test seam: forget the memo so the next call reads again. */
export function resetFleetFixtureForTests(): void {
  loaded = null;
}
