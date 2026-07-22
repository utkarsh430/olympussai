import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3000',
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
    command: 'npm run start',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
