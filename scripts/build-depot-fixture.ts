/**
 * Full-fleet offline fixture builder.
 *
 * Run: npm run build:depot-fixture
 *
 * Makes ONE request to the live feed (same default URL as src/lib/upsrtc/client.ts),
 * keeps only the allowlisted keys, and writes src/fixtures/upsrtc-fleet-sample.json.gz.
 * It never prints the URL or any credential, and never retries.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { buildFleetFixture } from '../src/lib/upsrtc/fleetFixtureShape';
import type { FleetFixture } from '../src/lib/upsrtc/fleetFixtureShape';

const HERE = dirname(fileURLToPath(import.meta.url));
export const FLEET_FIXTURE_PATH = resolve(HERE, '../src/fixtures/upsrtc-fleet-sample.json.gz');

const FETCH_TIMEOUT_MS = 60_000;

export type FetchPayload = () => Promise<unknown>;

async function fetchLivePayload(): Promise<unknown> {
  const url =
    process.env.UPSRTC_LIVE_URL ?? 'https://margdarshi.upsrtcvlt.com/php/getGpsLiveData.php';
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { Accept: 'application/json, text/plain, */*' },
  });
  if (!response.ok) throw new Error(`The feed answered HTTP ${response.status}`);
  const text = await response.text();
  if (text.trimStart().startsWith('<')) throw new Error('The feed returned a document, not data');
  return JSON.parse(text) as unknown;
}

/** The network call and the file write are injected so the flow is testable. */
export async function buildDepotFixture(
  fetchPayload: FetchPayload,
  write: (compressed: Buffer) => void,
): Promise<FleetFixture> {
  const fixture = buildFleetFixture(await fetchPayload());
  const compressed = gzipSync(Buffer.from(JSON.stringify(fixture.records)), { level: 9 });
  write(compressed);
  return fixture;
}

async function main(): Promise<void> {
  mkdirSync(dirname(FLEET_FIXTURE_PATH), { recursive: true });
  const fixture = await buildDepotFixture(fetchLivePayload, (compressed) =>
    writeFileSync(FLEET_FIXTURE_PATH, compressed),
  );
  const { records, depots, routes, feedNow } = fixture.counts;
  console.info(`Records ${records}, depots ${depots}, routes ${routes}, feed time ${feedNow}`);
}

// Run only when executed directly, not when a test imports the builder.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    // Only the message: a fetch error text can carry the URL in some runtimes.
    const message = error instanceof Error ? error.name : 'unknown error';
    console.error(`Fixture build failed (${message}). Nothing was written.`);
    process.exitCode = 1;
  });
}
