import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

/**
 * End-to-end coverage for the Depot Management shell at /project/depots:
 * the login deep link, the shell chrome, and the accessibility and layout
 * guarantees every depot page inherits.
 */

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

function collectConsoleErrors(page: Page): string[] {
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

// The raw PIN is never committed; without it the suite is skipped, not failed.
const E2E_PIN = process.env.E2E_PROJECT_PIN;
const E2E_ORIGIN = process.env.E2E_ORIGIN ?? 'http://127.0.0.1:3000';
const E2E_PROJECT_NAME = process.env.E2E_PROJECT_NAME ?? 'upsrtc';

const NETWORK_OVERVIEW = /Network overview/i;

test.use({ viewport: { width: 1440, height: 900 } });

// Deliberately outside the authenticated block: this test needs a cookie-less
// context, and the API-login beforeEach below would defeat it.
test.describe('Depot Management deep link', () => {
  test.skip(!E2E_PIN, 'Set E2E_PROJECT_PIN to run the depot e2e suite');

  test('1. an unauthenticated deep link survives login', async ({ page }) => {
    await page.goto('/project/depots');

    await expect(page).toHaveURL(/\/login\?/);
    const next = new URL(page.url()).searchParams.get('next');
    expect(next).toBe('/project/depots');

    await page.getByLabel('Project name').fill(E2E_PROJECT_NAME);
    await page.getByLabel('Project PIN').fill(E2E_PIN ?? '');
    await page.getByRole('button', { name: /Enter Project/i }).click();

    await expect(page).toHaveURL(/\/project\/depots$/);
    await expect(page.getByRole('heading', { level: 1, name: NETWORK_OVERVIEW })).toBeVisible();
  });
});

test.describe('Depot Management shell', () => {
  test.skip(!E2E_PIN, 'Set E2E_PROJECT_PIN to run the depot e2e suite');

  test.beforeEach(async ({ context }) => {
    const res = await context.request.post('/api/auth/login', {
      headers: { 'Content-Type': 'application/json', Origin: E2E_ORIGIN },
      data: { projectName: E2E_PROJECT_NAME, pin: E2E_PIN },
    });
    if (!res.ok()) throw new Error(`E2E login failed (${res.status()})`);
  });

  test('2. the shell shows its top bar, navigation and footer', async ({ page }) => {
    await page.goto('/project/depots');

    await expect(page.getByTestId('depot-top-bar')).toBeVisible();
    const nav = page.getByTestId('depot-nav');
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('link', { name: /Overview/i })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByTestId('footer-disclaimer')).toBeVisible();
  });

  test('3. Back to Operations returns to the command centre', async ({ page }) => {
    await page.goto('/project/depots');

    await page.getByTestId('depot-back-to-operations').click();

    await expect(page).toHaveURL(/\/project\/upsrtc$/);
  });

  test('4. no rendered text uses the banned wording', async ({ page }) => {
    await page.goto('/project/depots');
    await expect(page.getByRole('heading', { level: 1, name: NETWORK_OVERVIEW })).toBeVisible();

    const bodyText = await page.evaluate(() => document.body.innerText);

    expect(bodyText).not.toMatch(/simulated/i);
  });

  for (const [width, height] of [
    [1440, 900],
    [1024, 768],
    [800, 900],
  ] as const) {
    test(`5. no horizontal page scroll at ${width}px wide`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/project/depots');
      await expect(page.getByRole('heading', { level: 1, name: NETWORK_OVERVIEW })).toBeVisible();

      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          ),
        )
        .toBeLessThanOrEqual(0);
    });
  }

  test('6. the skip link is first in tab order and moves focus into main', async ({ page }) => {
    await page.goto('/project/depots');
    await expect(page.getByRole('heading', { level: 1, name: NETWORK_OVERVIEW })).toBeVisible();

    await page.keyboard.press('Tab');
    const skipLink = page.getByRole('link', { name: /Skip to depot content/i });
    await expect(skipLink).toBeFocused();

    await page.keyboard.press('Enter');

    await expect(page.locator('#depot-main')).toBeFocused();
  });

  test('7. loading the page raises no console errors', async ({ page }) => {
    const errors = collectConsoleErrors(page);

    await page.goto('/project/depots');
    await expect(page.getByRole('heading', { level: 1, name: NETWORK_OVERVIEW })).toBeVisible();
    await page.waitForLoadState('networkidle');

    expect(errors).toEqual([]);
  });
});
