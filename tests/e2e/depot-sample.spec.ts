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

/** Query strings the routes that require one need for a valid request. */
const VALID_QUERY: Readonly<Record<string, string>> = {
  '/api/upsrtc/depot/trends': '?metric=onRoadShare',
  '/api/upsrtc/depot/forecast': '?metric=onRoadShare&scope=network',
  '/api/upsrtc/depot/history': '?metric=onRoadShare&scope=network',
};

function fill(template: string, depotId: string): string {
  return (
    template.replace(DEPOT_SEGMENT, depotId).replace(ROUTE_SEGMENT, SAMPLE_ROUTE_NAME) +
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
        const url = fill(route.template, sample.depotId);
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
        const res = await request.get(fill(route.template, sample.depotId));

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
const CONSOLE_DEFECTS: Readonly<Record<string, string>> = {
  // About one load in four logs React error #418: the server HTML differs from the client's.
  '/project/depots/d/[depotId]/roster': 'the roster page intermittently fails hydration (#418)',
};

/** Pages whose wording check fails today because of a product defect, each with what is wrong. */
const WORDING_DEFECTS: Readonly<Record<string, string>> = {
  // The suggested roster prints duty ids such as "49-2026-10-06-009": a raw date, cell and title.
  '/project/depots/d/[depotId]/crew': 'duty ids carry a raw YYYY-MM-DD date',
};

test.describe('2. every depot page renders honestly on the sample', () => {
  test.skip(!E2E_PIN, `SKIPPED: ${PIN_MISSING}`);

  test('every page the file system declares has a heading in this table', () => {
    expect([...PAGE_TEMPLATES].sort()).toEqual(Object.keys(PAGE_HEADING).sort());
  });

  for (const template of PAGE_TEMPLATES) {
    test(`${template} shows its heading and provenance`, async ({ page, sample }) => {
      await openPage(page, template.replace(DEPOT_SEGMENT, sample.depotId), PAGE_HEADING[template]);

      const provenance = page.getByTestId('depot-provenance-line');
      await expect(provenance).toBeVisible();
      await expect(provenance).toContainText(/DERIVED|MODELLED|MIXED|LIVE|REFERENCE/);
    });

    test(`${template} loads with no console error`, async ({ page, sample }) => {
      test.fixme(template in CONSOLE_DEFECTS, CONSOLE_DEFECTS[template]);
      const errors = collectConsoleErrors(page);
      await openPage(page, template.replace(DEPOT_SEGMENT, sample.depotId), PAGE_HEADING[template]);
      await page.waitForLoadState('networkidle');

      expect(errors).toEqual([]);
    });

    test(`${template} never says "simulated" or prints a raw date`, async ({ page, sample }) => {
      test.fixme(template in WORDING_DEFECTS, WORDING_DEFECTS[template]);
      await openPage(page, template.replace(DEPOT_SEGMENT, sample.depotId), PAGE_HEADING[template]);

      const texts = await allPageText(page);
      expect(texts.filter((text) => /simulated/i.test(text))).toEqual([]);
      expect(texts.filter((text) => ISO_DATE.test(text))).toEqual([]);
    });
  }
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
      const url = template.replace(DEPOT_SEGMENT, sample.depotId);
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await openPage(page, url, PAGE_HEADING[template]);
        await expect.poll(() => sidewaysScroll(page), { message: `${width} px` }).toBe(0);
      }
    });
  }

  test('the transfers table fits its box at 1280 px', async ({ page, sample }) => {
    test.fixme(
      true,
      'the transfers table is wider than its scroll box at 1280 px',
    );
    expect(sample.depotId).toBeTruthy();
    await page.setViewportSize({ width: 1280, height: 900 });
    await openPage(page, '/project/depots/rebalance', 'Fleet distribution');
    const box = page.getByTestId('rebalance-transfers');
    await expect(box).toBeVisible();
    const overflow = await box.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBe(0);
  });
});
