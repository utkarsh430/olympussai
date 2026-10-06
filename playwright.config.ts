import { defineConfig, devices } from '@playwright/test';

// The host defaults to `localhost` because that is the origin the Google Maps key
// authorises; on any other host Maps refuses the key and the basemap never loads.
// Both are overridable so a run can avoid a port another project already holds.
const HOST = process.env.E2E_HOST ?? 'localhost';
const PORT = process.env.E2E_PORT ?? '3000';
const BASE_URL = `http://${HOST}:${PORT}`;

// `E2E_SUITE=sample` runs the depot sample suite alone, against a server started on the
// saved full-fleet sample (`NEXT_PUBLIC_DEMO_MODE=1`: fixed feed time, depots and counts),
// so its assertions are deterministic. Any other value runs the live-feed suites as before.
const SAMPLE_SUITE = process.env.E2E_SUITE === 'sample';
const SAMPLE_SPEC = /depot-sample\.spec\.ts$/;

// A server already on the port is reused only on request (`E2E_REUSE_SERVER=1`): a server
// left running in the other feed mode would otherwise be reused silently, and the sample
// suite would run against the live feed or the live suite against the sample.
const REUSE_SERVER = process.env.E2E_REUSE_SERVER === '1';

// The scripted copilot writer always: a browser test must never make a model writer run.
const SERVER_ENV: Record<string, string> = {
  DEPOT_COPILOT_PROVIDER: 'scripted',
  ...(SAMPLE_SUITE ? { NEXT_PUBLIC_DEMO_MODE: '1' } : {}),
};

export default defineConfig({
  testDir: './tests/e2e',
  ...(SAMPLE_SUITE ? { testMatch: SAMPLE_SPEC } : { testIgnore: SAMPLE_SPEC }),
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    // The dashboard is viewed at ~85% browser zoom on a 1920-wide display, which
    // presents ~2259x1271 CSS px to the page. Testing at that effective viewport
    // mirrors real usage (the enlarged command centre has full room at this
    // width; a 100%-zoom 1920 viewport is narrower than the dashboard is used at).
    viewport: { width: 2259, height: 1271 },
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'command-centre-85pct',
      use: { ...devices['Desktop Chrome'], viewport: { width: 2259, height: 1271 } },
    },
  ],
  webServer: {
    command: `npm run start -- -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: REUSE_SERVER,
    env: SERVER_ENV,
    timeout: 120_000,
  },
});
