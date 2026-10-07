import { test as base, expect, request, type ConsoleMessage, type Page } from '@playwright/test';
import path from 'node:path';

/**
 * Shared set-up for the depot sample suite: one sign-in per worker kept as a storage state,
 * the PIN guard, and the console filter. The raw PIN is never committed; the run supplies it.
 */

export const E2E_PIN = process.env.E2E_PROJECT_PIN;
export const IN_CI = Boolean(process.env.CI);
export const PIN_MISSING =
  'E2E_PROJECT_PIN is not set, so the depot sample browser suite cannot sign in';
export const E2E_ORIGIN =
  process.env.E2E_ORIGIN ??
  `http://${process.env.E2E_HOST ?? 'localhost'}:${process.env.E2E_PORT ?? '3000'}`;
export const E2E_PROJECT_NAME = process.env.E2E_PROJECT_NAME ?? 'upsrtc';

/** A storage state with no session, for the tests that must run signed out. */
export const SIGNED_OUT = { cookies: [], origins: [] };

/** Signs in through the login route and returns the session as a storage state file. */
async function signIn(baseURL: string, file: string): Promise<void> {
  const context = await request.newContext({ baseURL, storageState: SIGNED_OUT });
  try {
    const res = await context.post('/api/auth/login', {
      headers: { 'Content-Type': 'application/json', Origin: E2E_ORIGIN },
      data: { projectName: E2E_PROJECT_NAME, pin: E2E_PIN },
    });
    if (!res.ok()) throw new Error(`E2E login failed (${res.status()})`);
    await context.storageState({ path: file });
  } finally {
    await context.dispose();
  }
}

/** What the suite reads from the sample once per worker. */
export interface SampleFacts {
  /** A depot (kind `depot`, fleet of at least `MIN_FLEET`) every depot-scope test uses. */
  readonly depotId: string;
  readonly depotName: string;
  /** A route the sample carries with at least one bus, for the route day's page and API. */
  readonly routeName: string;
  /** A bus seen on that route, for the bus-day lookup (refused on the sample, no outside call). */
  readonly busOnRoute: string;
}

const MIN_FLEET = 50;

interface NetworkUnit {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly fleet: number;
}

interface RouteListBody {
  readonly routes?: readonly { readonly routeName: string; readonly buses: number }[];
}

/** The first route in the sample's route table that has a bus on it. */
async function sampleRoute(context: Awaited<ReturnType<typeof request.newContext>>): Promise<string> {
  const res = await context.get('/api/upsrtc/depot/routes');
  if (!res.ok()) throw new Error(`route list failed (${res.status()})`);
  const route = ((await res.json()) as RouteListBody).routes?.find((r) => r.buses >= 1);
  if (!route) throw new Error('the sample has no route with a bus on it');
  return route.routeName;
}

/** The first bus the route day lists on the route. */
async function sampleBus(
  context: Awaited<ReturnType<typeof request.newContext>>,
  routeName: string,
): Promise<string> {
  const res = await context.get(`/api/upsrtc/depot/service/route/${encodeURIComponent(routeName)}`);
  if (!res.ok()) throw new Error(`route day failed (${res.status()})`);
  const bus = ((await res.json()) as { busesOnRoute?: readonly string[] }).busesOnRoute?.[0];
  if (!bus) throw new Error(`the sample shows no bus on ${routeName}`);
  return bus;
}

/**
 * Reads the network from the server and fails unless it is serving the saved sample: this
 * suite's fixed counts hold only there, and the route lookups it makes are refused without
 * an outside call only there.
 */
async function readSample(baseURL: string, storageState: string): Promise<SampleFacts> {
  const context = await request.newContext({ baseURL, storageState });
  try {
    const res = await context.get('/api/upsrtc/depot/network');
    if (!res.ok()) throw new Error(`network view failed (${res.status()})`);
    const body = (await res.json()) as { source?: string; depots?: readonly NetworkUnit[] };
    if (body.source !== 'fixture') {
      throw new Error(
        `the server is not on the saved sample (source ${String(body.source)}); ` +
          'run this suite with npm run test:e2e:sample',
      );
    }
    const depot = (body.depots ?? []).find((u) => u.kind === 'depot' && u.fleet >= MIN_FLEET);
    if (!depot) throw new Error(`the sample has no depot with a fleet of ${MIN_FLEET} or more`);
    const routeName = await sampleRoute(context);
    const busOnRoute = await sampleBus(context, routeName);
    return { depotId: depot.id, depotName: depot.name, routeName, busOnRoute };
  } finally {
    await context.dispose();
  }
}

interface WorkerFixtures {
  readonly workerStorageState: string;
  readonly sample: SampleFacts;
}

/**
 * `test` with every page and `request` signed in: the worker signs in once and each test
 * starts from that session. A test that needs no session sets `storageState: SIGNED_OUT`.
 * Every test first confirms, once per worker, that the server is on the saved sample.
 */
export const test = base.extend<object, WorkerFixtures>({
  storageState: ({ workerStorageState }, provide) => provide(workerStorageState),
  sample: [
    async ({ workerStorageState }, provide, workerInfo) => {
      const baseURL = String(workerInfo.project.use.baseURL ?? E2E_ORIGIN);
      await provide(await readSample(baseURL, workerStorageState));
    },
    { scope: 'worker' },
  ],
  workerStorageState: [
    async ({}, provide, workerInfo) => {
      const baseURL = String(workerInfo.project.use.baseURL ?? E2E_ORIGIN);
      const file = path.join(
        workerInfo.project.outputDir,
        `.auth/depot-sample-${workerInfo.parallelIndex}.json`,
      );
      if (!E2E_PIN) throw new Error(PIN_MISSING);
      await signIn(baseURL, file);
      await provide(file);
    },
    { scope: 'worker' },
  ],
});

export { expect };

/** Console errors we tolerate: they originate outside our application code. */
const IGNORABLE_CONSOLE = [
  'Google Maps',
  'googleapis.com',
  'maps.googleapis',
  'billing',
  'ApiTargetBlockedMapError',
  'InvalidKeyMapError',
  'RefererNotAllowed',
  'net::ERR_',
  'Failed to load resource',
  'favicon',
];

/** Collects the page's console errors and uncaught exceptions from now on. */
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (IGNORABLE_CONSOLE.some((pattern) => text.includes(pattern))) return;
    errors.push(text);
  });
  page.on('pageerror', (error) => {
    if (IGNORABLE_CONSOLE.some((pattern) => error.message.includes(pattern))) return;
    errors.push(error.message);
  });
  return errors;
}
