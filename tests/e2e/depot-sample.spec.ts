import fs from 'node:fs';
import path from 'node:path';
import {
  test,
  expect,
  E2E_PIN,
  E2E_PROJECT_NAME,
  IN_CI,
  PIN_MISSING,
  SIGNED_OUT,
  collectConsoleErrors,
  type SampleFacts,
} from './depot-sample-fixtures';

/**
 * The depot module against the SAVED SAMPLE (`npm run test:e2e:sample`: the server runs with
 * `NEXT_PUBLIC_DEMO_MODE=1`, so the feed time, the depots and every count are fixed).
 *
 * Covered: the API contract of every depot route, every depot page rendering honestly, no
 * sideways page scroll, deep links, the cockpit-to-roster and exceptions scoping, keyboard
 * row opening, the copilot on its scripted writer, the route drawer's refusal on the sample,
 * and the sample never presented as live.
 *
 * Not covered here, because it needs the live feed: the populated route drawer (the route
 * details come from the corporation's schedule service, server side, which a browser test
 * cannot stub) and the freshness wiring (the stale notice after the stale limit with the
 * live feed blocked). Unit tests cover the timing of the latter.
 */

if (!E2E_PIN) {
  console.warn(
    `[depot sample e2e] SKIPPED: ${PIN_MISSING}.` +
      (IN_CI ? ' The PIN guard fails this CI run.' : ' Set it to run them.'),
  );
}

test('the depot sample suite has its PIN (it fails in CI when the PIN is missing)', () => {
  test.skip(!E2E_PIN && !IN_CI, `SKIPPED: ${PIN_MISSING}`);
  expect(E2E_PIN, `${PIN_MISSING}; a CI run without it must fail, not pass`).toBeTruthy();
});

const REPO_ROOT = path.resolve(__dirname, '../..');
const API_DIR = path.join(REPO_ROOT, 'src/app/api/upsrtc/depot');

/** Every file named `name` under `dir`, as a path relative to `dir` with `/` separators. */
function discover(dir: string, name: string): string[] {
  return fs
    .readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((entry) => path.basename(entry) === name)
    .map((entry) => entry.split(path.sep).join('/'))
    .sort();
}

interface ApiRoute {
  /** The URL template, e.g. `/api/upsrtc/depot/[depotId]/crew`. */
  readonly template: string;
  readonly method: 'GET' | 'POST';
}

/** The depot API as the file system declares it: each `route.ts` and the method it exports. */
const API_ROUTES: readonly ApiRoute[] = discover(API_DIR, 'route.ts').map((file) => {
  const source = fs.readFileSync(path.join(API_DIR, file), 'utf8');
  const dir = path.posix.dirname(file);
  return {
    template: `/api/upsrtc/depot${dir === '.' ? '' : `/${dir}`}`,
    method: /export\s+(async\s+)?function\s+GET\b/.test(source) ? 'GET' : 'POST',
  };
});

const DEPOT_SEGMENT = '[depotId]';
const ROUTE_SEGMENT = '[routeName]';
/** A well-formed route name; on the sample the lookup is refused without an outside call. */
const SAMPLE_ROUTE_NAME = 'ABC';
/** The route day's API answers only a route the sample carries, so it is given one. */
const ROUTE_HOURLY_API = '/api/upsrtc/depot/service/route/[routeName]';

/** Query strings the routes that require one need for a valid request. */
const VALID_QUERY: Readonly<Record<string, string>> = {
  '/api/upsrtc/depot/trends': '?metric=onRoadShare',
  '/api/upsrtc/depot/forecast': '?metric=onRoadShare&scope=network',
  '/api/upsrtc/depot/history': '?metric=onRoadShare&scope=network',
};

function fill(template: string, sample: SampleFacts): string {
  const routeName = template === ROUTE_HOURLY_API ? sample.routeName : SAMPLE_ROUTE_NAME;
  return (
    pageUrl(template, sample).replace(ROUTE_SEGMENT, routeName) +
    (VALID_QUERY[template] ?? '')
  );
}

const INVALID_DEPOT = { error: 'Invalid depot id' };
const DEPOT_NOT_FOUND = { error: 'Depot not found' };
const INVALID_QUERY = { error: 'Invalid query' };

test.describe('1. the depot API contract', () => {
  test.skip(!E2E_PIN, `SKIPPED: ${PIN_MISSING}`);

  test('the file system declares the depot routes this suite expects', () => {
    expect(API_ROUTES.length).toBeGreaterThanOrEqual(18);
    expect(API_ROUTES.some((r) => r.template.includes(DEPOT_SEGMENT))).toBe(true);
    expect(API_ROUTES.some((r) => r.template.includes(ROUTE_SEGMENT))).toBe(true);
  });

  test.describe('signed out', () => {
    test.use({ storageState: SIGNED_OUT });

    for (const route of API_ROUTES) {
      test(`${route.method} ${route.template} answers 401 without a session`, async ({
        request,
        sample,
        baseURL,
      }) => {
        const url = fill(route.template, sample);
        const res =
          route.method === 'GET'
            ? await request.get(url)
            : await request.post(url, {
                headers: { Origin: String(baseURL) },
                data: { question: 'How many buses are on the road?' },
              });

        expect(res.status()).toBe(401);
        expect(res.headers()['cache-control']).toContain('no-store');
        expect(await res.json()).toEqual({ error: 'Unauthorized' });
      });
    }
  });

  test.describe('signed in', () => {
    for (const route of API_ROUTES.filter((r) => r.method === 'GET')) {
      test(`GET ${route.template} answers 200, no-store, on the sample`, async ({
        request,
        sample,
      }) => {
        const res = await request.get(fill(route.template, sample));

        expect(res.status()).toBe(200);
        expect(res.headers()['cache-control']).toContain('no-store');
        expect(res.headers()['content-type']).toContain('application/json');
      });
    }

    for (const route of API_ROUTES.filter((r) => r.template.includes(DEPOT_SEGMENT))) {
      for (const [label, id, status, body] of [
        ['a word', 'abc', 400, INVALID_DEPOT],
        ['a path escape', '..%2Fx', 400, INVALID_DEPOT],
        ['a 65-character id', '1'.repeat(65), 400, INVALID_DEPOT],
        ['a well-formed unknown id', '999999', 404, DEPOT_NOT_FOUND],
      ] as const) {
        test(`${route.template} refuses ${label} with a fixed body`, async ({
          request,
          sample,
        }) => {
          expect(sample.depotId).not.toBe(id);
          const res = await request.get(route.template.replace(DEPOT_SEGMENT, id));

          expect(res.status()).toBe(status);
          expect(res.headers()['cache-control']).toContain('no-store');
          expect(await res.json()).toEqual(body);
        });
      }
    }

    for (const [route, query] of [
      ['trends', 'metric=bogus'],
      ['trends', 'metric=onRoadShare&days=999'],
      ['forecast', 'metric=onRoadShare&scope=network&horizon=999'],
      ['forecast', 'metric=bogus&scope=network'],
      ['history', 'metric=onRoadShare&scope=bogus'],
      ['history', 'metric=onRoadShare&scope=network&days=abc'],
    ] as const) {
      test(`${route} refuses ?${query} with a fixed 400`, async ({ request, sample }) => {
        expect(sample.depotId).toBeTruthy();
        const res = await request.get(`/api/upsrtc/depot/${route}?${query}`);

        expect(res.status()).toBe(400);
        expect(res.headers()['cache-control']).toContain('no-store');
        expect(await res.json()).toEqual(INVALID_QUERY);
      });
    }

    test('the route lookup refuses a path escape in the name', async ({ request, sample }) => {
      expect(sample.depotId).toBeTruthy();
      // The URL standard resolves a literal `%2e%2e` segment to `..` before the request is
      // sent, so it never names a route: the router answers not found, never the handler.
      const dotted = await request.get('/api/upsrtc/depot/route/%2e%2e');
      expect(dotted.status()).toBe(404);

      for (const name of ['..%2Fx', '%252e%252e']) {
        const res = await request.get(`/api/upsrtc/depot/route/${name}`);
        expect(res.status()).toBe(400);
        expect(res.headers()['cache-control']).toContain('no-store');
        expect(await res.json()).toEqual({ error: 'Invalid route name' });
      }
    });

    test('the route day refuses a hostile name, an unknown route and another date', async ({
      request,
      sample,
    }) => {
      const base = '/api/upsrtc/depot/service/route';
      for (const [url, status, body] of [
        [`${base}/..%2Fx`, 400, { error: 'Invalid route name' }],
        [`${base}/${'A'.repeat(65)}`, 400, { error: 'Invalid route name' }],
        [`${base}/NO_SUCH_ROUTE_9`, 404, { error: 'Route not found' }],
        [`${base}/${sample.routeName}?date=2001-01-01`, 400, INVALID_QUERY],
        [`${base}/${sample.routeName}?days=3`, 400, INVALID_QUERY],
      ] as const) {
        const res = await request.get(url);
        expect(res.status(), url).toBe(status);
        expect(res.headers()['cache-control']).toContain('no-store');
        expect(await res.json()).toEqual(body);
      }
    });
  });
});

const PAGES_DIR = path.join(REPO_ROOT, 'src/app/(protected)/project/depots');

/** Every depot page as the file system declares it, e.g. `/project/depots/d/[depotId]/yard`. */
const PAGE_TEMPLATES: readonly string[] = discover(PAGES_DIR, 'page.tsx').map((file) => {
  const dir = path.posix.dirname(file);
  return `/project/depots${dir === '.' ? '' : `/${dir}`}`;
});

/** Each page's heading, as the page writes it (the screen shows it in capitals). */
const PAGE_HEADING: Readonly<Record<string, string>> = {
  '/project/depots': 'Network overview',
  '/project/depots/ask': 'Ask',
  '/project/depots/economics': 'Economics',
  '/project/depots/exceptions': 'Exceptions',
  '/project/depots/league': 'League table',
  '/project/depots/rebalance': 'Fleet distribution',
  '/project/depots/routes': 'Routes',
  '/project/depots/routes/r/[routeName]': 'Hour by hour',
  '/project/depots/sources': 'Data sources',
  '/project/depots/trends': 'Trends',
  '/project/depots/d/[depotId]': 'Depot cockpit',
  '/project/depots/d/[depotId]/crew': 'Crew',
  '/project/depots/d/[depotId]/duties': 'Duties',
  '/project/depots/d/[depotId]/fuel': 'Fuel and cost',
  '/project/depots/d/[depotId]/maintenance': 'Maintenance',
  '/project/depots/d/[depotId]/revenue': 'Revenue and ridership',
  '/project/depots/d/[depotId]/roster': 'Roster',
  '/project/depots/d/[depotId]/trends': 'Trends',
  '/project/depots/d/[depotId]/yard': 'Yard',
};

/** A page template with its segments filled from the sample: its depot and its busy route. */
function pageUrl(template: string, sample: SampleFacts): string {
  return pageUrl(template, sample).replace(ROUTE_SEGMENT, sample.routeName);
}

/** The heading a page template shows; every template the file system declares has one. */
function headingOf(template: string): string {
  const heading = PAGE_HEADING[template];
  if (heading === undefined) throw new Error(`no heading listed for ${template}`);
  return heading;
}

type DepotPage = import('@playwright/test').Page;

/** Opens a depot page and waits until its heading and its data have arrived. */
async function openPage(page: DepotPage, url: string, heading: string): Promise<void> {
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1, name: heading, exact: true })).toBeVisible();
  await expect(page.getByTestId('depot-feed-status')).toHaveAttribute('data-source', 'fixture');
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
}

/** The page's rendered text, every `title` and every `aria-label`, one entry each. */
async function allPageText(page: DepotPage): Promise<string[]> {
  return page.evaluate(() => [
    document.body.innerText,
    ...Array.from(document.querySelectorAll('[title], [aria-label]')).flatMap((el) => [
      el.getAttribute('title') ?? '',
      el.getAttribute('aria-label') ?? '',
    ]),
  ]);
}

const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/;

/** Pages that log a console error on load today because of a product defect. */
/**
 * React's hydration mismatch (#418: the server HTML differs from the client's first render).
 * Depot pages logged it intermittently (a page's Suspense boundary hydrating after the
 * shell's poll had answered; the roster about one load in four). The per-page console checks
 * set it aside; the test below loads the roster repeatedly and requires none.
 */
const HYDRATION_MISMATCH = /Minified React error #418\b/;
const HYDRATION_PROBE_LOADS = 8;

test.describe('2. every depot page renders honestly on the sample', () => {
  test.skip(!E2E_PIN, `SKIPPED: ${PIN_MISSING}`);

  test('every page the file system declares has a heading in this table', () => {
    expect([...PAGE_TEMPLATES].sort()).toEqual(Object.keys(PAGE_HEADING).sort());
  });

  for (const template of PAGE_TEMPLATES) {
    test(`${template} shows its heading and provenance`, async ({ page, sample }) => {
      await openPage(page, pageUrl(template, sample), headingOf(template));

      const provenance = page.getByTestId('depot-provenance-line');
      await expect(provenance).toBeVisible();
      await expect(provenance).toContainText(/DERIVED|MODELLED|MIXED|LIVE|REFERENCE/);
    });

    test(`${template} loads with no console error`, async ({ page, sample }) => {
      const errors = collectConsoleErrors(page);
      await openPage(page, pageUrl(template, sample), headingOf(template));
      await page.waitForLoadState('networkidle');

      expect(errors.filter((error) => !HYDRATION_MISMATCH.test(error))).toEqual([]);
    });

    test(`${template} never says "simulated" or prints a raw date`, async ({ page, sample }) => {
      await openPage(page, pageUrl(template, sample), headingOf(template));

      const texts = await allPageText(page);
      expect(texts.filter((text) => /simulated/i.test(text))).toEqual([]);
      expect(texts.filter((text) => ISO_DATE.test(text))).toEqual([]);
    });
  }
});

test.describe('2. depot pages hydrate cleanly', () => {
  test.skip(!E2E_PIN, `SKIPPED: ${PIN_MISSING}`);

  test('the roster loads repeatedly with no hydration mismatch', async ({
    browser,
    storageState,
    sample,
  }) => {
    const errors: string[] = [];
    // A fresh browser context per load, as a first visit: nothing is cached.
    for (let load = 0; load < HYDRATION_PROBE_LOADS; load += 1) {
      const context = await browser.newContext({ storageState });
      const page = await context.newPage();
      const pageErrors = collectConsoleErrors(page);
      await openPage(page, `/project/depots/d/${sample.depotId}/roster`, 'Roster');
      await page.waitForLoadState('networkidle');
      errors.push(...pageErrors);
      await context.close();
    }

    expect(errors.filter((error) => HYDRATION_MISMATCH.test(error))).toEqual([]);
  });
});

const WIDTHS = [390, 640, 1024, 1280, 1440] as const;

/** Pixels the page can scroll sideways: zero when nothing is wider than the window. */
function sidewaysScroll(page: DepotPage): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test.describe('3. no sideways page scroll on any depot page', () => {
  test.skip(!E2E_PIN, `SKIPPED: ${PIN_MISSING}`);

  for (const template of PAGE_TEMPLATES) {
    test(`${template} fits 390, 640, 1024, 1280 and 1440 px`, async ({ page, sample }) => {
      const url = pageUrl(template, sample);
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await openPage(page, url, headingOf(template));
        await expect.poll(() => sidewaysScroll(page), { message: `${width} px` }).toBe(0);
      }
    });
  }

  test('the transfers table fits its box at 1280 px', async ({ page, sample }) => {
    expect(sample.depotId).toBeTruthy();
    await page.setViewportSize({ width: 1280, height: 900 });
    await openPage(page, '/project/depots/rebalance', 'Fleet distribution');
    const box = page.getByTestId('rebalance-transfers');
    await expect(box).toBeVisible();
    const overflow = await box.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBe(0);
  });
});

test.describe('4. deep links into a depot', () => {
  test.skip(!E2E_PIN, `SKIPPED: ${PIN_MISSING}`);
  test.use({ storageState: SIGNED_OUT });

  test('signing in keeps the path and the query of a depot-scope deep link', async ({
    page,
    sample,
  }) => {
    const target = `/project/depots/d/${sample.depotId}/roster?state=dark`;
    await page.goto(target);

    await expect(page).toHaveURL(/\/login\?/);
    expect(new URL(page.url()).searchParams.get('next')).toBe(target);

    await page.getByLabel('Project name').fill(E2E_PROJECT_NAME);
    await page.getByLabel('Project PIN').fill(E2E_PIN ?? '');
    await page.getByRole('button', { name: /Enter Project/i }).click();

    await expect(page).toHaveURL((url) => `${url.pathname}${url.search}` === target);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Roster', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('group', { name: 'State' }).getByRole('button', { name: /^Dark/ }),
    ).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('4. a malformed depot id', () => {
  test.skip(!E2E_PIN, `SKIPPED: ${PIN_MISSING}`);

  for (const suffix of ['', '/roster']) {
    test(`/project/depots/d/abc${suffix} gives the not-found page, not an error`, async ({
      page,
      sample,
    }) => {
      expect(sample.depotId).not.toBe('abc');
      const res = await page.goto(`/project/depots/d/abc${suffix}`);

      expect(res?.status()).toBe(404);
      await expect(
        page.getByRole('heading', { level: 1, name: 'Depot not found', exact: true }),
      ).toBeVisible();
    });
  }
});

/** The first whole number in a text, ignoring thousands separators. */
function firstCount(text: string): number {
  const match = /\d[\d,]*/.exec(text);
  if (!match) throw new Error(`no count in "${text}"`);
  return Number(match[0].replace(/,/g, ''));
}

test.describe('5. the cockpit opens the roster already filtered', () => {
  test.skip(!E2E_PIN, `SKIPPED: ${PIN_MISSING}`);

  test('each roster line on the cockpit opens the roster with that filter and count', async ({
    page,
    sample,
  }) => {
    const cockpit = `/project/depots/d/${sample.depotId}`;
    await openPage(page, cockpit, 'Depot cockpit');
    const links = page.locator('a[data-testid^="depot-attention-"][href*="/roster?"]');
    await expect(links.first()).toBeVisible();
    const targets = await links.evaluateAll((els) =>
      els.map((el) => ({
        href: el.getAttribute('href') ?? '',
        text: (el as HTMLElement).innerText,
      })),
    );
    expect(targets.length).toBeGreaterThanOrEqual(2);

    for (const { href, text } of targets) {
      await openPage(page, cockpit, 'Depot cockpit');
      await page.locator(`a[data-testid^="depot-attention-"][href="${href}"]`).click();

      await expect(page).toHaveURL((url) => `${url.pathname}${url.search}` === href);
      await expect(page.getByRole('heading', { level: 1, name: 'Roster' })).toBeVisible();
      const count = firstCount(text);
      await expect(
        page.getByText(new RegExp(`^${count} of \\d+ buses match the filters`)),
      ).toBeAttached();
      const state = new URL(href, 'http://x').searchParams.get('state');
      if (state) {
        const pressed = page
          .getByRole('group', { name: 'State' })
          .locator('button[aria-pressed="true"]');
        await expect(pressed).toHaveCount(1);
      }
    }
  });
});

interface ExceptionsBody {
  readonly busPage: {
    readonly total: number;
    readonly items: readonly { readonly registrationNumber: string; readonly depotId: string }[];
  };
  readonly depotScope: {
    readonly depotId: string;
    readonly depot: readonly { readonly depotId: string }[];
  };
}

test.describe('6. the exceptions page scoped to one depot', () => {
  test.skip(!E2E_PIN, `SKIPPED: ${PIN_MISSING}`);

  test('shows only that depot, its scope chip, and totals that match the cockpit', async ({
    page,
    request,
    sample,
  }) => {
    const res = await request.get(
      `/api/upsrtc/depot/exceptions?depotId=${sample.depotId}&limit=100`,
    );
    expect(res.status()).toBe(200);
    const body = (await res.json()) as ExceptionsBody;
    expect(body.busPage.total).toBeLessThanOrEqual(100);
    expect(body.busPage.items.every((item) => item.depotId === sample.depotId)).toBe(true);
    expect(body.depotScope.depot.every((line) => line.depotId === sample.depotId)).toBe(true);
    const buses = new Set(body.busPage.items.map((item) => item.registrationNumber)).size;

    await openPage(page, `/project/depots/d/${sample.depotId}`, 'Depot cockpit');
    // The cockpit lists each bus once and the depot's own exceptions.
    await expect(page.getByTestId('depot-exceptions').first()).toBeVisible();
    const cockpitTotal = firstCount(
      await page
        .locator('#depot-exceptions, [data-testid="depot-exceptions"] h2')
        .first()
        .innerText(),
    );
    expect(cockpitTotal).toBe(buses + body.depotScope.depot.length);

    await openPage(page, `/project/depots/exceptions?depot=${sample.depotId}`, 'Exceptions');
    await expect(page.getByTestId('depot-exception-scope')).toContainText(
      `Exceptions at ${sample.depotName} only.`,
    );
    await expect(page.getByTestId('bus-depot-chip')).toContainText(sample.depotName);
    await expect(page.getByTestId('depot-exception-counts')).toContainText(
      `${body.busPage.total} bus exception`,
    );
    await expect(
      page.getByRole('heading', {
        name: new RegExp(`Bus exceptions · ${body.busPage.total}$`, 'i'),
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', {
        name: new RegExp(`Depot exceptions · ${body.depotScope.depot.length}$`, 'i'),
      }),
    ).toBeVisible();
    await expect(page.getByTestId('depot-exception-list')).toContainText(sample.depotName);
  });
});

test.describe('7. keyboard: open a row, close it, focus returns', () => {
  test.skip(!E2E_PIN, `SKIPPED: ${PIN_MISSING}`);

  test('roster: Enter on a bus opens its drawer and Escape returns to the row', async ({
    page,
    sample,
  }) => {
    await openPage(page, `/project/depots/d/${sample.depotId}/roster`, 'Roster');
    const opener = page.getByTestId('depot-table').locator('tbody tr button').first();
    await opener.focus();
    await expect(opener).toBeFocused();

    await page.keyboard.press('Enter');
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await expect(page.locator('#bus-drawer-title')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('exceptions: Enter on a depot group closes and reopens it in place', async ({
    page,
    sample,
  }) => {
    await openPage(page, `/project/depots/exceptions?depot=${sample.depotId}`, 'Exceptions');
    // The bus rows open nothing; the depot exceptions are grouped in disclosures.
    const summary = page.getByTestId('depot-exception-list').locator('summary').first();
    const group = summary.locator('xpath=..');
    const wasOpen = await group.evaluate((el) => (el as HTMLDetailsElement).open);
    await summary.focus();

    await page.keyboard.press('Enter');
    await expect.poll(() => group.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(!wasOpen);
    await page.keyboard.press('Enter');
    await expect.poll(() => group.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(wasOpen);
    await expect(summary).toBeFocused();
  });

  test('league: Enter opens a score breakdown and Enter again returns to the row', async ({
    page,
    sample,
  }) => {
    expect(sample.depotId).toBeTruthy();
    await openPage(page, '/project/depots/league', 'League table');
    const row = page.locator('tr[data-league-row]').first();
    await row.focus();

    await page.keyboard.press('Enter');
    await expect(page.getByTestId('depot-score-breakdown')).toBeVisible();
    await expect(page.locator('#score-breakdown-title')).toBeFocused();

    await row.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('depot-score-breakdown')).toBeHidden();
    await expect(row).toBeFocused();
  });

  test('league: Escape closes the score breakdown and returns focus to its row', async ({
    page,
    sample,
  }) => {
    expect(sample.depotId).toBeTruthy();
    await openPage(page, '/project/depots/league', 'League table');
    const row = page.locator('tr[data-league-row]').first();
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('depot-score-breakdown')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('depot-score-breakdown')).toBeHidden();
    await expect(row).toBeFocused();
  });
});

const SUPPORTED_QUESTION = 'Give me a summary of the network.';
const PERSON_QUESTION = 'Who is the best driver at this depot?';
const DECLINE_HEADLINE = 'That question is outside what can be answered here';
const COPILOT_LIMIT_PROBES = 15;

async function ask(page: DepotPage, question: string): Promise<void> {
  await page.getByLabel('Your question').fill(question);
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
}

// The copilot is rate limited per session, so these few tests run in order, the cooldown last.
test.describe('8. the copilot on its scripted writer', () => {
  test.skip(!E2E_PIN, `SKIPPED: ${PIN_MISSING}`);
  test.describe.configure({ mode: 'serial' });

  test('a supported question gets an answer signed by the scripted writer', async ({
    page,
    sample,
  }) => {
    expect(sample.depotId).toBeTruthy();
    await openPage(page, '/project/depots/ask', 'Ask');
    await ask(page, SUPPORTED_QUESTION);

    const answer = page.getByTestId('ask-answer').first();
    await expect(answer).toBeVisible();
    await expect(answer.getByTestId('copilot-provider')).toHaveText(/^scripted$/i);
    await expect(answer.getByTestId('copilot-footer-line')).toContainText(/written \d{2}:\d{2}/);
    await expect(answer.getByTestId('copilot-data-source')).toContainText('sample data');
    await expect(answer.getByTestId('copilot-footer')).not.toContainText(/claude/i);
  });

  test('a question about a person gets the fixed decline', async ({ page, sample }) => {
    expect(sample.depotId).toBeTruthy();
    await openPage(page, '/project/depots/ask', 'Ask');
    await ask(page, PERSON_QUESTION);

    const answer = page.getByTestId('ask-answer').first();
    await expect(answer).toContainText(DECLINE_HEADLINE);
    await expect(answer).toContainText('Questions about people are outside that scope.');
    await expect(answer.getByTestId('copilot-footer')).not.toContainText(/claude/i);
  });

  test('the decline does not call the sample the live data', async ({ page, sample }) => {
    expect(sample.depotId).toBeTruthy();
    await openPage(page, '/project/depots/ask', 'Ask');
    await ask(page, PERSON_QUESTION);
    const answer = page.getByTestId('ask-answer').first();
    await expect(answer).toContainText(DECLINE_HEADLINE);
    await expect(answer).toContainText('would be answered from sample data.');
    // The server's own sample sentence says "not the live feed", as the feed chip does.
    const words = (await answer.innerText()).replace(/not the live feed/gi, '');
    expect(words).not.toMatch(/\blive\b/i);
  });

  test('past the limit the page shows the cooldown', async ({ page, sample, baseURL }) => {
    expect(sample.depotId).toBeTruthy();
    await openPage(page, '/project/depots/ask', 'Ask');
    let limited = false;
    for (let i = 0; i < COPILOT_LIMIT_PROBES && !limited; i += 1) {
      const res = await page.request.post('/api/upsrtc/depot/copilot', {
        headers: { Origin: String(baseURL) },
        data: { task: 'ask', question: SUPPORTED_QUESTION, scope: { kind: 'network' } },
      });
      limited = res.status() === 429;
      if (!limited) expect(res.status()).toBe(200);
    }
    expect(limited).toBe(true);

    await ask(page, SUPPORTED_QUESTION);
    await expect(page.getByText('Too many requests. Please wait.')).toBeVisible();
    await expect(page.getByTestId('ask-countdown')).toHaveText(/^Try again in \d+ seconds?\.$/);
  });
});

test.describe('9. the route drawer on the sample', () => {
  test.skip(!E2E_PIN, `SKIPPED: ${PIN_MISSING}`);

  test('a route opens to the honest unavailable state, and Escape returns focus', async ({
    page,
    sample,
  }) => {
    // Only on the sample: there the server refuses the lookup without an outside call.
    expect(sample.depotId).toBeTruthy();
    await openPage(page, '/project/depots/routes', 'Routes');
    const opener = page.getByTestId('route-table-frame').locator('tbody tr button').first();
    await opener.focus();
    await page.keyboard.press('Enter');

    const drawer = page.getByTestId('route-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('heading', { level: 2, name: /^Route / })).toBeVisible();
    await expect(page.getByTestId('route-drawer-empty')).toContainText(
      'Its profile is unavailable',
    );
    await expect(drawer).not.toContainText(/\blive\b/i);

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(opener).toBeFocused();
  });
});

/**
 * Every sentence on the page, in its text, titles and labels, that uses the word live, except
 * inside the feed chip (which says the sample is not the live feed), the footer disclaimer
 * (checked on its own below) and the data-source registry (which names each source's kind).
 */
async function liveClaims(page: DepotPage): Promise<string[]> {
  return page.evaluate(() => {
    const excluded = Array.from(
      document.querySelectorAll(
        '[data-testid="depot-feed-status"], [data-testid="footer-disclaimer"], [data-testid="depot-feed-registry"]',
      ),
    );
    const inExcluded = (el: Element): boolean => excluded.some((box) => box.contains(el));
    let text = document.body.innerText;
    for (const box of excluded) text = text.split((box as HTMLElement).innerText).join('\n');
    const attributes = Array.from(document.querySelectorAll('[title], [aria-label]'))
      .filter((el) => !inExcluded(el))
      .flatMap((el) => [el.getAttribute('title') ?? '', el.getAttribute('aria-label') ?? '']);
    return [...text.split('\n'), ...attributes].filter((line) => /\blive\b/i.test(line));
  });
}

test.describe('10. the sample is never presented as live', () => {
  test.skip(!E2E_PIN, `SKIPPED: ${PIN_MISSING}`);

  for (const template of PAGE_TEMPLATES) {
    test(`${template} says the data is the sample, not the live feed`, async ({ page, sample }) => {
      await openPage(page, pageUrl(template, sample), headingOf(template));

      const chip = page.getByTestId('depot-feed-status');
      // The chip names its source; its tone is the sample's own, or the stale tone when the
      // sample's feed time is old, never the live one.
      await expect(chip).toHaveAttribute('data-source', 'fixture');
      await expect(chip).toHaveAttribute('data-tone', /^(fixture|stale)$/);
      await expect(chip).toHaveAttribute('title', 'Sample data, not the live feed');
      await expect(chip).toContainText(/fixture/i);
      await expect(page.getByTestId('depot-provenance-line')).toContainText(
        template === '/project/depots/sources' ? 'not from the feed' : 'sample data',
      );
    });

    test(`${template} never calls the sample live`, async ({ page, sample }) => {
      await openPage(page, pageUrl(template, sample), headingOf(template));

      expect(await liveClaims(page)).toEqual([]);
    });
  }

  test('the footer disclaimer does not call the sample live', async ({ page, sample }) => {
    expect(sample.depotId).toBeTruthy();
    await openPage(page, '/project/depots', 'Network overview');
    await expect(page.getByTestId('footer-disclaimer')).not.toContainText(/\blive\b/i);
  });
});
