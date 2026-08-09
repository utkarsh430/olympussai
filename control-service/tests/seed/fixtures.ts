// Fixture loading for the seed suite.
//
// Read from disk rather than `import ... with { type: 'json' }` so the pinned
// payloads stay plain data files that can be regenerated from a live capture
// without touching module resolution. NO TEST IN THIS SUITE MAKES A NETWORK
// CALL — every payload here is a recorded upstream body.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ScheduleProbeResult } from '../../src/seed/harvest.js';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

export function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.json`), 'utf8'));
}

export const liveFeed = loadFixture('live-feed');

let probeCounter = 0;

/** A successful schedule probe carrying `name`'s recorded payload. */
export function probe(name: string, overrides: Partial<ScheduleProbeResult> = {}): ScheduleProbeResult {
  probeCounter += 1;
  return {
    registrationNumber: `UP11AA${String(1000 + probeCounter)}`,
    routeName: null,
    date: '2026-08-08',
    payload: loadFixture(name),
    error: null,
    ...overrides,
  };
}
