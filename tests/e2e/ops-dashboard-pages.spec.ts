import { test, expect, type APIRequestContext } from '@playwright/test';
import { Pool } from 'pg';

/**
 * Every ops dashboard page, actually opened — and the mid-render race that
 * made all twelve of them return HTTP 500.
 *
 * ─── WHY THIS SUITE EXISTS ───────────────────────────────────────────────
 *
 * Until now the only ops screen with ANY end-to-end coverage was
 * /ops/pilot-driver. The other eleven had none, so a defect that lived in
 * the shared page/guard shape — which is to say, in all twelve at once —
 * could ship with a green suite. It did:
 *
 *     const session = (await getOpsSession())!;
 *
 * That assertion was safe while the session was a pure token decode, and
 * stopped being safe when it became a read of `ops_users`, because the App
 * Router renders a layout guard and its page body CONCURRENTLY. Disable an
 * operator (or change their role) while they are loading a dashboard and the
 * two reads land on opposite sides of that write: the guard redirects, the
 * body dereferences null, and the operator gets a 500. Under a concurrent
 * load with the account being toggled it reproduced on every page tried.
 *
 * So this suite holds two things a per-page smoke test would not:
 *
 *   1. COVERAGE OF ALL TWELVE. Driven from a table, and cross-checked
 *      against the App Router directory, so adding a thirteenth dashboard
 *      without covering it fails here rather than silently.
 *   2. THE RACE ITSELF. Concurrent requests against a page while an admin
 *      toggles that very account's status in `ops_users`. The pass condition
 *      is not "200": mid-flight requests legitimately redirect to sign-in.
 *      It is that NOTHING is a 5xx. A refusal is a product decision; a 500 is
 *      the product breaking.
 *
 * ─── WHAT IT NEEDS ───────────────────────────────────────────────────────
 *
 * This app running against its own ops Postgres, plus a seeded account for
 * each of the seven roles, and direct `pg` access so the suite can perform
 * the disable/enable an admin would (there is no API to disable your own
 * account, and using one would only prove a different thing). Same
 * convention as the sibling specs: optional locally (the suite skips), a
 * hard failure in CI, where .github/workflows/ci-web.yml provisions all of
 * it — because a suite that only ever skips is worth nothing.
 *
 *   E2E_OPS_DATABASE_URL=postgres://... \
 *   E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... \
 *   E2E_DRIVER_EMAIL=... E2E_DRIVER_PASSWORD=... \
 *   ... (one pair per role) \
 *   npm run test:e2e -- ops-dashboard-pages
 *
 * It signs in through POST /api/ops/auth/login, the legacy ops door, which
 * is deliberately still live through the cutover and is what CI already
 * provisions accounts for. The defect under test is in the per-request
 * authority check that BOTH front doors pass through
 * (src/lib/auth/rbac/server.ts), so exercising it through either one
 * exercises it for both.
 */

const E2E_ORIGIN = process.env.E2E_ORIGIN ?? 'http://127.0.0.1:3000';
const OPS_DATABASE_URL = process.env.E2E_OPS_DATABASE_URL;

/** One seeded account per role. Every ops page belongs to exactly one of these. */
const ROLE_ACCOUNTS = {
  admin: { email: process.env.E2E_ADMIN_EMAIL, password: process.env.E2E_ADMIN_PASSWORD },
  driver: { email: process.env.E2E_DRIVER_EMAIL, password: process.env.E2E_DRIVER_PASSWORD },
  pilot_driver: {
    email: process.env.E2E_PILOT_DRIVER_EMAIL,
    password: process.env.E2E_PILOT_DRIVER_PASSWORD,
  },
  dispatcher: {
    email: process.env.E2E_DISPATCHER_EMAIL,
    password: process.env.E2E_DISPATCHER_PASSWORD,
  },
  depot: { email: process.env.E2E_DEPOT_EMAIL, password: process.env.E2E_DEPOT_PASSWORD },
  control_room: {
    email: process.env.E2E_CONTROL_ROOM_EMAIL,
    password: process.env.E2E_CONTROL_ROOM_PASSWORD,
  },
  planner: { email: process.env.E2E_PLANNER_EMAIL, password: process.env.E2E_PLANNER_PASSWORD },
} as const;

type OpsRoleName = keyof typeof ROLE_ACCOUNTS;

/**
 * All twelve guarded ops pages, with the role that owns each and the heading
 * its shell renders. `expectedTitle` is what makes this an "it opened" check
 * rather than an "it answered 200" one: a redirect chain that lands on the
 * sign-in page is also a 200.
 */
const OPS_PAGES: ReadonlyArray<{ path: string; role: OpsRoleName; title: string }> = [
  { path: '/ops/driver', role: 'driver', title: 'Driver' },
  { path: '/ops/pilot-driver', role: 'pilot_driver', title: 'Pilot Driver' },
  { path: '/ops/dispatcher', role: 'dispatcher', title: 'Dispatcher' },
  { path: '/ops/depot', role: 'depot', title: 'Depot' },
  { path: '/ops/planner', role: 'planner', title: 'Planner' },
  { path: '/ops/control-room', role: 'control_room', title: 'Control Room' },
  { path: '/ops/control-room/copilot', role: 'control_room', title: 'Copilot' },
  // Nothing seeded for this id on purpose: the timeline must still render its
  // shell (the point here is the guard, not the incident data).
  { path: '/ops/control-room/observability', role: 'control_room', title: 'Live Observability' },
  { path: '/ops/control-room/pilot', role: 'control_room', title: 'Pilot Staging' },
  {
    path: '/ops/control-room/incidents/e2e-nonexistent-incident',
    role: 'control_room',
    title: 'Incident Timeline',
  },
  { path: '/ops/admin/invites', role: 'admin', title: 'Admin · Invites' },
  { path: '/ops/admin/rollout-stages', role: 'admin', title: 'Admin · Rollout stages' },
];

const REQUIRED_ENV: Record<string, string | undefined> = {
  E2E_OPS_DATABASE_URL: OPS_DATABASE_URL,
};
for (const [role, account] of Object.entries(ROLE_ACCOUNTS)) {
  const key = role.toUpperCase();
  REQUIRED_ENV[`E2E_${key}_EMAIL`] = account.email;
  REQUIRED_ENV[`E2E_${key}_PASSWORD`] = account.password;
}

const missingEnv = Object.entries(REQUIRED_ENV)
  .filter(([, value]) => !value)
  .map(([key]) => key);

/**
 * CI-ONLY: an unset variable is a broken workflow, not a reason to skip.
 * Thrown at module scope for the same reason the sibling specs do it — a
 * `test.skip` reports as a green pass, which is how the only ops e2e coverage
 * this repo had spent its whole life never executing.
 */
if (process.env.CI === 'true' && missingEnv.length > 0) {
  throw new Error(
    `CI=true but ${missingEnv.join(', ')} ${missingEnv.length === 1 ? 'is' : 'are'} unset. ` +
      'In CI this suite must RUN, never skip — .github/workflows/ci-web.yml seeds one ops ' +
      'account per role and provisions the ops database before calling it. A missing variable ' +
      'here means that setup regressed. (Locally, leave CI unset and the suite skips.)',
  );
}

let pool: Pool | undefined;

test.beforeAll(() => {
  if (missingEnv.length === 0) pool = new Pool({ connectionString: OPS_DATABASE_URL });
});

test.afterAll(async () => {
  // The race tests disable an account on purpose and re-enable it in their
  // own `finally`. This is the backstop for the case that cannot reach a
  // `finally` — a crashed worker — because these accounts are shared with the
  // sibling specs, and leaving one disabled would fail a suite that has
  // nothing to do with this one.
  if (pool) {
    await pool.query('update ops_users set status = $1 where email = any($2::text[])', [
      'active',
      Object.values(ROLE_ACCOUNTS).map((account) => account.email),
    ]);
  }
  await pool?.end();
});

async function signIn(request: APIRequestContext, role: OpsRoleName): Promise<void> {
  const account = ROLE_ACCOUNTS[role];
  const res = await request.post('/api/ops/auth/login', {
    headers: { 'Content-Type': 'application/json', Origin: E2E_ORIGIN },
    data: { email: account.email, password: account.password },
  });
  if (!res.ok()) throw new Error(`${role} login failed (${res.status()}): ${await res.text()}`);
}

async function setStatus(role: OpsRoleName, status: 'active' | 'disabled'): Promise<void> {
  if (!pool) throw new Error('no ops database pool');
  await pool.query('update ops_users set status = $1 where email = $2', [
    status,
    ROLE_ACCOUNTS[role].email,
  ]);
}

test.describe('every ops dashboard opens', () => {
  test.skip(missingEnv.length > 0, `ops dashboard suite needs ${missingEnv.join(', ')}`);

  for (const { path, role, title } of OPS_PAGES) {
    test(`${path} renders for its ${role}`, async ({ page }) => {
      await signIn(page.request, role);

      const response = await page.goto(path);

      expect(response?.status(), `${path} did not answer 200`).toBe(200);
      // Landing on the sign-in page is also a 200, so the shell heading is
      // what proves the dashboard itself rendered.
      expect(new URL(page.url()).pathname).toBe(path);
      await expect(page.getByRole('heading', { name: title, level: 1 }).first()).toBeVisible();
    });
  }

  test('this table still covers every guarded ops page', async () => {
    // A thirteenth dashboard added without a row here would otherwise inherit
    // the same untested shape the first twelve had.
    const { readdirSync } = await import('node:fs');
    const { join, sep } = await import('node:path');

    function pageDirs(dir: string): string[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) return pageDirs(full);
        return entry.name === 'page.tsx' ? [full] : [];
      });
    }

    const PUBLIC_PAGES = ['login', 'forbidden', 'accept-invite', 'unavailable'];
    const guarded = pageDirs(join(process.cwd(), 'src/app/(ops)/ops')).filter(
      (file) => !PUBLIC_PAGES.some((name) => file.includes(`${sep}${name}${sep}`)),
    );

    expect(guarded.length).toBe(OPS_PAGES.length);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// THE RACE
// ───────────────────────────────────────────────────────────────────────────

test.describe('a dashboard survives its account changing mid-render', () => {
  test.skip(missingEnv.length > 0, `ops dashboard suite needs ${missingEnv.join(', ')}`);

  /**
   * How many requests to have in flight. The window is narrow — the guard and
   * the page body resolve milliseconds apart — so the defect showed up on
   * roughly 1-6% of requests at this concurrency. A handful of requests would
   * miss it and report green, which is the whole reason the defect survived
   * this long.
   */
  const CONCURRENT_REQUESTS = 250;

  /**
   * The reproduction, as a test. Concurrent requests for one operator's own
   * dashboard while their `ops_users.status` is flipped underneath them —
   * the shape of an admin disabling somebody who is mid-shift, and of any
   * transient failure of the profile read.
   *
   * Issued with plain `fetch` from the test process rather than through
   * Playwright's request context, which drops the ops cookie: `next start`
   * runs in production mode, so that cookie is `Secure`, and the API context
   * will not put a Secure cookie on a plaintext localhost request the way a
   * browser does. The cookie is still obtained the product's way — through
   * POST /api/ops/auth/login — and read back out of the browser context.
   *
   * The assertion is deliberately NOT "everything is 200". A request whose
   * guard resolves after the disable SHOULD be refused, and a redirect to
   * sign-in is the correct refusal. What must never happen is a 5xx: that is
   * the product falling over, and it is what asserting the session non-null
   * produced.
   */
  for (const role of ['driver', 'control_room', 'admin'] as const) {
    const target = OPS_PAGES.find((page) => page.role === role);

    test(`${target?.path} never 500s while ${role} is toggled`, async ({ page }) => {
      const path = target?.path;
      if (!path) throw new Error(`no page for ${role}`);
      await signIn(page.request, role);

      const cookies = await page.context().cookies();
      const cookieHeader = cookies.map(({ name, value }) => `${name}=${value}`).join('; ');
      expect(cookieHeader, 'sign-in left no session cookie to load with').toContain(
        'olympuss_ops_session=',
      );

      let toggling = true;
      const toggler = (async () => {
        let active = true;
        while (toggling) {
          active = !active;
          await setStatus(role, active ? 'active' : 'disabled');
          await new Promise((resolve) => setTimeout(resolve, 3));
        }
      })();

      let statuses: number[] = [];
      try {
        statuses = await Promise.all(
          Array.from({ length: CONCURRENT_REQUESTS }, async () => {
            const response = await fetch(new URL(path, E2E_ORIGIN), {
              headers: { cookie: cookieHeader },
              redirect: 'manual',
            });
            // Drained so the connection is released rather than left open.
            await response.text();
            return response.status;
          }),
        );
      } finally {
        toggling = false;
        await toggler;
        await setStatus(role, 'active');
      }

      const serverErrors = statuses.filter((status) => status >= 500);
      expect(
        serverErrors,
        `${path} answered ${serverErrors.length}/${statuses.length} requests with a server error ` +
          `while ${role} was being enabled and disabled; a refusal is fine, a crash is not`,
      ).toEqual([]);
      // Sanity: the load actually reached the page rather than being refused
      // wholesale by something upstream, which would make the check vacuous.
      expect(statuses.some((status) => status === 200 || status === 307 || status === 302)).toBe(
        true,
      );
    });
  }
});
