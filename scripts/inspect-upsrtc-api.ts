/**
 * UPSRTC upstream API inspector.
 *
 * Run: npm run inspect:api
 *
 * Probes the two real UPSRTC endpoints, reports their actual shape, guesses the
 * semantic role of each field, and writes SANITIZED fixtures for offline dev.
 *
 * Safety: never prints phone numbers, device identifiers, secrets or full
 * payloads. Only a capped sample of records is echoed, with sensitive keys
 * redacted.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(HERE, '../src/fixtures');

const LIVE_URL =
  process.env.UPSRTC_LIVE_URL ?? 'https://margdarshi.upsrtcvlt.com/php/getGpsLiveData.php';
const SCHEDULE_URL =
  process.env.UPSRTC_SCHEDULE_URL ?? 'https://margdarshi.upsrtcvlt.com/php/getScheduledBusInfo.php';

/** Keys that must never be written to disk or printed. */
const SENSITIVE_KEYS = [
  'phone', 'mobile', 'contact', 'driver_name', 'drivername', 'conductor',
  'imei', 'sim', 'simno', 'password', 'token', 'apikey', 'api_key',
  'systemCodeNumber', 'system_code_number', 'vendorId', 'firmwareVersion',
];

function isSensitive(key: string): boolean {
  const k = key.toLowerCase();
  return SENSITIVE_KEYS.some((s) => k.includes(s.toLowerCase()));
}

function sanitize(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = isSensitive(key) ? '[REDACTED]' : value;
  }
  return out;
}

function describeShape(payload: unknown): string {
  if (Array.isArray(payload)) return `array (length ${payload.length})`;
  if (payload === null) return 'null';
  if (typeof payload === 'string') return `string (length ${payload.length}) — possibly a status message`;
  if (typeof payload === 'object') {
    const keys = Object.keys(payload as object);
    return `object (keys: ${keys.slice(0, 10).join(', ')}${keys.length > 10 ? ', …' : ''})`;
  }
  return typeof payload;
}

/** Heuristic field-role detection so we can document the undocumented API. */
const ROLE_PATTERNS: Array<{ role: string; test: RegExp }> = [
  { role: 'Registration number', test: /^(reg_?num|registration_?no|registration_number|regno|bus_id|vehicle_?no)$/i },
  { role: 'Latitude', test: /^(lat|latitude|gps_?lat)$/i },
  { role: 'Longitude', test: /^(lng|lon|long|longitude|gps_?lng)$/i },
  { role: 'Speed', test: /^(speed|speed_kmph)$/i },
  { role: 'Heading', test: /^(heading|bearing|course)$/i },
  { role: 'Depot', test: /^(depot_?name|depot|home_depot)$/i },
  { role: 'Route', test: /^(route|routename|route_name|route_description|line_id|line_name)$/i },
  { role: 'Service / journey', test: /^(vehicle_journey_code|vehicle_journey_id|vj_id|service.*)$/i },
  { role: 'Timestamp', test: /^(timestamp|receivedTime|scheduled_.*time|actual_.*time|.*_eta|scheduled_time)$/i },
  { role: 'Vehicle status', test: /^(status|vehicle_status|packetStatus|ignition|gpsFix)$/i },
  { role: 'Stop', test: /^(stop_name|stop_sequence|atco_code|platform_name|next_stop|previous_stop|destination)$/i },
];

function detectRoles(keys: string[]): Map<string, string[]> {
  const roles = new Map<string, string[]>();
  for (const key of keys) {
    for (const { role, test } of ROLE_PATTERNS) {
      if (test.test(key)) {
        const list = roles.get(role) ?? [];
        list.push(key);
        roles.set(role, list);
        break;
      }
    }
  }
  return roles;
}

function heading(title: string): void {
  console.log(`\n${'═'.repeat(72)}\n${title}\n${'═'.repeat(72)}`);
}

async function probe(url: string, label: string) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    const contentType = response.headers.get('content-type') ?? 'unknown';
    const text = await response.text();
    const elapsed = Date.now() - started;

    console.log(`  HTTP status   : ${response.status} ${response.statusText}`);
    console.log(`  Content-Type  : ${contentType}`);
    console.log(`  Body size     : ${(text.length / 1024).toFixed(1)} KiB`);
    console.log(`  Elapsed       : ${elapsed} ms`);

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      console.log(`  Parse         : NOT valid JSON (first 120 chars): ${text.slice(0, 120)}`);
      return null;
    }

    console.log(`  Parsed shape  : ${describeShape(payload)}`);
    return payload;
  } catch (error) {
    console.log(`  ${label} FAILED: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  mkdirSync(FIXTURE_DIR, { recursive: true });

  heading('1. LIVE GPS ENDPOINT');
  console.log(`  URL: ${LIVE_URL}`);
  const livePayload = await probe(LIVE_URL, 'live');

  if (!Array.isArray(livePayload) || livePayload.length === 0) {
    console.error('\n  Could not obtain a usable live array. Aborting.');
    process.exitCode = 1;
    return;
  }

  const records = livePayload as Array<Record<string, unknown>>;
  const keys = Object.keys(records[0] ?? {});

  console.log(`\n  Records       : ${records.length}`);
  console.log(`  Fields/record : ${keys.length}`);

  heading('2. PROBABLE FIELD ROLES (live feed)');
  for (const [role, fields] of detectRoles(keys)) {
    console.log(`  ${role.padEnd(22)} → ${fields.join(', ')}`);
  }

  heading('3. SANITIZED SAMPLE (max 3 records)');
  const sample = records.slice(0, 3).map(sanitize);
  console.log(JSON.stringify(sample, null, 2).slice(0, 2400));

  heading('4. DATA-QUALITY SUMMARY');
  let validCoords = 0;
  let nullIsland = 0;
  const regs = new Set<string>();
  const depots = new Set<string>();
  const statuses = new Set<string>();

  for (const record of records) {
    const lat = Number(record['latitude']);
    const lng = Number(record['longitude']);
    if (lat === 0 && lng === 0) nullIsland += 1;
    else if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      validCoords += 1;
    }
    const reg = record['regNum'];
    if (typeof reg === 'string') regs.add(reg);
    const depot = record['depot_name'];
    if (typeof depot === 'string') depots.add(depot);
    const status = record['status'];
    if (typeof status === 'string') statuses.add(status);
  }

  console.log(`  Valid coordinates    : ${validCoords}`);
  console.log(`  Null-island (0,0)    : ${nullIsland}`);
  console.log(`  Unique registrations : ${regs.size} (duplicates: ${records.length - regs.size})`);
  console.log(`  Unique depots        : ${depots.size}`);
  console.log(`  Distinct statuses    : ${[...statuses].join(', ')}`);

  // Choose a registration likely to HAVE a schedule: prefer one with a journey id.
  const withJourney = records.filter(
    (r) => r['vehicle_journey_id'] && r['vehicle_journey_id'] !== 'None' && typeof r['regNum'] === 'string',
  );
  const candidates = (withJourney.length > 0 ? withJourney : records)
    .slice(0, 6)
    .map((r) => String(r['regNum']));

  heading('5. SCHEDULE ENDPOINT');
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  console.log(`  Asia/Kolkata date: ${date}`);

  let schedulePayload: unknown = null;
  let scheduleReg = '';

  for (const reg of candidates) {
    const url = `${SCHEDULE_URL}?date=${date}&reg_num=${reg}`;
    console.log(`\n  Trying reg_num=${reg}`);
    const result = await probe(url, 'schedule');
    if (Array.isArray(result) && result.length > 0) {
      schedulePayload = result;
      scheduleReg = reg;
      break;
    }
    if (typeof result === 'string') {
      console.log(`  → Upstream returned a bare JSON string: ${JSON.stringify(result)}`);
      console.log('    (this is the "no assignment for this date" signal, HTTP 200)');
    }
  }

  if (Array.isArray(schedulePayload) && schedulePayload.length > 0) {
    const stops = schedulePayload as Array<Record<string, unknown>>;
    const stopKeys = Object.keys(stops[0] ?? {});
    heading('6. PROBABLE FIELD ROLES (schedule)');
    console.log(`  Registration used : ${scheduleReg}`);
    console.log(`  Stops returned    : ${stops.length}`);
    for (const [role, fields] of detectRoles(stopKeys)) {
      console.log(`  ${role.padEnd(22)} → ${fields.join(', ')}`);
    }
    const zeroCoordStops = stops.filter(
      (s) => Number(s['Latitude']) === 0 && Number(s['Longitude']) === 0,
    ).length;
    console.log(`  Stops with 0,0 coords : ${zeroCoordStops} / ${stops.length} (must be rejected)`);

    heading('7. SANITIZED SCHEDULE SAMPLE (max 3 stops)');
    console.log(JSON.stringify(stops.slice(0, 3).map(sanitize), null, 2));
  } else {
    console.log('\n  No assigned schedule found among sampled registrations.');
  }

  heading('8. WRITING SANITIZED FIXTURES');

  // Live fixture: a geographically diverse, sanitized subset.
  const fixtureBuses = records
    .filter((r) => {
      const lat = Number(r['latitude']);
      const lng = Number(r['longitude']);
      return Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
    })
    .slice(0, 400)
    .map(sanitize);

  const livePath = resolve(FIXTURE_DIR, 'upsrtc-live-sample.json');
  writeFileSync(livePath, JSON.stringify(fixtureBuses, null, 2));
  console.log(`  Wrote ${fixtureBuses.length} sanitized bus records → src/fixtures/upsrtc-live-sample.json`);

  const schedulePath = resolve(FIXTURE_DIR, 'upsrtc-schedule-sample.json');
  const fixtureSchedule = Array.isArray(schedulePayload)
    ? (schedulePayload as Array<Record<string, unknown>>).map(sanitize)
    : [];
  writeFileSync(schedulePath, JSON.stringify(fixtureSchedule, null, 2));
  console.log(`  Wrote ${fixtureSchedule.length} sanitized stop records → src/fixtures/upsrtc-schedule-sample.json`);

  heading('INSPECTION COMPLETE');
  console.log('  No phone numbers, device IDs, firmware strings or secrets were printed or stored.\n');
}

main().catch((error) => {
  console.error('Inspector failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
