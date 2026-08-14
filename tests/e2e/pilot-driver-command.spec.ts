import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { seedGatedRouteDirection, insertVehicle } from './fixtures/controlServiceFixtures';
import {
  assertDisposableControlServiceDatabase,
  assertDisposableOpsDatabase,
} from './fixtures/dbSafety';
import { assignVehicleToPilotDriver } from './fixtures/opsFixtures';
import { assertQaRoster, signInThroughFrontDoor } from './fixtures/opsSignIn';

/**
 * Live, authenticated end-to-end coverage for the driver PWA's
 * single-instruction command interface (ticket 60485890, covered so far
 * only by unit tests plus a manual unauthenticated-redirect / static-asset
 * check — this spec is the full authenticated loop that manual check
 * couldn't reach: control-service creates and delivers a command, the
 * pilot-driver console polls and shows it, the driver taps a response, and
 * the ack lands in BOTH control-service's own audit log and this app's
 * ops_audit_log. Also covers the offline ack queue (IndexedDB outbox +
 * `online`-event flush) and TTL auto-expiry (client-side countdown lapse
 * *and* control-service's own periodic sweep).
 *
 * Requires infrastructure this repo's sandbox does not carry by default:
 *   - control-service running against its own Postgres/PostGIS database
 *     (control-service/db/migrations applied), reachable at
 *     E2E_CONTROL_SERVICE_URL and authenticated with E2E_CONTROL_SERVICE_TOKEN
 *     (control-service's SERVICE_TOKEN_SECRET).
 *   - this app running against its own ops Postgres database
 *     (db/migrations applied), with OPS_DATABASE_URL / CONTROL_SERVICE_BASE_URL
 *     / CONTROL_SERVICE_SERVICE_TOKEN configured to match the control-service
 *     instance above.
 *   - a seeded `pilot_driver` ops_users row (scripts/seed-ops-admin.mjs seeds
 *     an admin; a pilot_driver account is provisioned the same way this repo's
 *     admin-invite flow provisions any ops account — see db/migrations/
 *     20260806170000__ops_pilot_driver_role.sql) whose credentials are
 *     E2E_PILOT_DRIVER_EMAIL / E2E_PILOT_DRIVER_PASSWORD.
 *   - direct read/write Postgres access to BOTH datastores for this spec's
 *     OWN fixture setup and audit-trail assertions: E2E_CONTROL_SERVICE_DATABASE_URL
 *     and E2E_OPS_DATABASE_URL. There is no REST endpoint anywhere in this
 *     repo that creates a `dispatcher_actions` approval or a `vehicles` row
 *     (control-service's own README / docs/CONTROL_SERVICE_INTEGRATION.md
 *     §6 — no control-service REST client for command *creation* exists in
 *     the web app yet), so seeding one directly is the only way to exercise
 *     "create a command via control-service" at all, exactly as a human
 *     verifying this by hand would have to.
 *
 * Every one of the above is optional at the process-env level LOCALLY; the
 * whole suite is skipped (not failed) when any is unset, mirroring
 * tests/e2e/command-centre.spec.ts's E2E_PROJECT_PIN convention.
 *
 * IN CI IT IS NOT OPTIONAL. `.github/workflows/ci-web.yml` stands the whole
 * thing up — a `postgis/postgis:16-3.4` service for control-service, a
 * `postgres:16` service for the ops datastore, both migration runners, a
 * seeded pilot_driver, and both processes — and a missing variable there
 * means that setup broke, not that the suite is unwanted. A suite that only
 * ever skips is worth nothing, so `CI=true` turns an unset variable into a
 * hard failure (see the guard below the env block). Run it with, e.g.:
 *
 *   E2E_PILOT_DRIVER_EMAIL=pilot.driver.qa@example.com \
 *   E2E_PILOT_DRIVER_PASSWORD=... \
 *   E2E_CONTROL_SERVICE_URL=http://127.0.0.1:8081 \
 *   E2E_CONTROL_SERVICE_TOKEN=... \
 *   E2E_CONTROL_SERVICE_DATABASE_URL=postgres://... \
 *   E2E_OPS_DATABASE_URL=postgres://... \
 *   npm run test:e2e -- pilot-driver-command
 */

const E2E_ORIGIN = process.env.E2E_ORIGIN ?? 'http://127.0.0.1:3000';
const PILOT_DRIVER_EMAIL = process.env.E2E_PILOT_DRIVER_EMAIL;
const PILOT_DRIVER_PASSWORD = process.env.E2E_PILOT_DRIVER_PASSWORD;
const CONTROL_SERVICE_URL = process.env.E2E_CONTROL_SERVICE_URL;
const CONTROL_SERVICE_TOKEN = process.env.E2E_CONTROL_SERVICE_TOKEN;
const CONTROL_SERVICE_DATABASE_URL = process.env.E2E_CONTROL_SERVICE_DATABASE_URL;
const OPS_DATABASE_URL = process.env.E2E_OPS_DATABASE_URL;

const REQUIRED_ENV = {
  E2E_PILOT_DRIVER_EMAIL: PILOT_DRIVER_EMAIL,
  E2E_PILOT_DRIVER_PASSWORD: PILOT_DRIVER_PASSWORD,
  E2E_CONTROL_SERVICE_URL: CONTROL_SERVICE_URL,
  E2E_CONTROL_SERVICE_TOKEN: CONTROL_SERVICE_TOKEN,
  E2E_CONTROL_SERVICE_DATABASE_URL: CONTROL_SERVICE_DATABASE_URL,
  E2E_OPS_DATABASE_URL: OPS_DATABASE_URL,
};
const missingEnv = Object.entries(REQUIRED_ENV)
  .filter(([, value]) => !value)
  .map(([key]) => key);

/**
 * CI-ONLY: an unset variable is a broken workflow, not a reason to skip.
 *
 * Thrown at module scope on purpose. `test.skip(condition, reason)` inside
 * the describe (still used below, for local runs) reports as a PASS with
 * skipped tests, which is indistinguishable in a green check from the suite
 * actually running — exactly how this file spent its whole life never
 * executing once. Throwing here fails collection, so the job goes red the
 * moment the fixtures/services stop being wired up correctly.
 */
if (process.env.CI === 'true' && missingEnv.length > 0) {
  throw new Error(
    `CI=true but ${missingEnv.join(', ')} ${missingEnv.length === 1 ? 'is' : 'are'} unset. ` +
      'In CI this suite must RUN, never skip — .github/workflows/ci-web.yml provisions the ' +
      'Postgres services, applies both migration runners, seeds the pilot_driver and boots ' +
      'both processes before calling it. A missing variable here means that setup regressed. ' +
      '(Locally, leave CI unset and the suite skips as before.)',
  );
}

/** Command action types this suite is free to use — parameters.reason makes the exact label irrelevant. */
const ACTION_TYPE = 'speed_guidance';

/**
 * ─── WHY THIS SUITE NOW ADDRESSES THE CONSOLE BY TEST ID ─────────────────
 *
 * The driver console was redesigned (bilingual English/Hindi buttons, a
 * reworked instruction card, plainer wording throughout — the captain
 * authorised the copy change explicitly). This suite used to find its
 * controls by their visible English text: `name: 'Ack'`, `'Response sent.'`,
 * `'No active command right now.'`.
 *
 * Every one of those strings changed. That left two options, and only one of
 * them is honest:
 *
 *   • Re-pin the assertions to the NEW strings. Rejected: it would leave the
 *     four safety guarantees in this file coupled to copy that is expected to
 *     keep changing — the language work on this product is explicitly ongoing,
 *     and a Hindi review is still owed on these very buttons. The next copy
 *     tweak would turn a green safety suite red for no safety reason, and the
 *     pressure then is to weaken the suite.
 *
 *   • Address the controls by a stable id, and test the copy where copy
 *     belongs. Taken.
 *
 * WHAT DID NOT CHANGE: not one assertion in this file. Every `expect` still
 * proves exactly what it proved before — the ack lands in both audit trails,
 * the outbox holds an answer given offline and empties once online, the
 * command expires client-side and is swept server-side, and the countdown
 * renders. Only the way a control is LOCATED changed. The countdown is still
 * found by its accessible name (`Time remaining to respond`), which the
 * redesign deliberately preserved, and the dispatcher's reason text is still
 * matched verbatim, because that string is data flowing through the system
 * rather than product copy.
 *
 * The copy itself is now pinned by src/tests/unit/driverCopy.test.ts, which
 * asserts the exact English AND Hindi of every button and state message, that
 * both languages are always present, and that no answer carries a word
 * implying blame. That is a stronger guarantee about the wording than a text
 * selector ever gave, and it fails in milliseconds instead of needing a
 * two-database stack to notice.
 */
const ID = {
  accept: 'driver-answer-accept',
  unable: 'driver-answer-unable',
  unsafe: 'driver-answer-unsafe',
  answerSent: 'driver-answer-sent',
  answerQueued: 'driver-answer-queued',
  noInstruction: 'driver-no-instruction',
  offline: 'driver-offline',
} as const;

interface Fixture {
  vehicleId: string;
  dispatcherActionId: string;
}

/**
 * Seeds a fresh, isolated vehicle + unconsumed dispatcher_actions approval
 * directly against control-service's own database — the only way to obtain
 * a valid dispatcherActionId (see file header). A unique vehicleId per test
 * sidesteps `commands_one_active_per_vehicle_idx`: an acked-`accept`
 * command moves to `executing`, which is still "active" for that constraint,
 * so reusing a vehicle across tests would spuriously 409.
 */
async function seedFixture(pool: Pool, label: string, routeDirectionId: string): Promise<Fixture> {
  const suffix = randomUUID().slice(0, 8);
  const vehicleId = `qa-e2e-${label}-${suffix}`;
  const dispatcherActionId = randomUUID();
  await insertVehicle(pool, vehicleId, suffix);
  await pool.query(
    `insert into dispatcher_actions (id, dispatcher_id, action_type, vehicle_id, reason, route_direction_id)
     values ($1, 'qa-e2e-suite', $2, $3, $4, $5)`,
    [dispatcherActionId, ACTION_TYPE, vehicleId, `QA e2e fixture for ${label}`, routeDirectionId],
  );
  return { vehicleId, dispatcherActionId };
}

async function controlServiceFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${CONTROL_SERVICE_URL}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${CONTROL_SERVICE_TOKEN}`,
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `control-service ${init.method ?? 'GET'} ${path} failed (${response.status}): ${body}`,
    );
  }
  return response;
}

/**
 * Creates an authorized command against `fixture` and returns its id, once
 * it has actually reached `delivered`.
 *
 * Delivery is no longer a separate step this suite drives itself: POST
 * /v1/commands now attempts delivery inline, right after its own commit
 * (control-service/src/commands/deliverAndNotify.ts) — see AGENTS.md's
 * "control-service is the only thing that delivers a command". This helper
 * used to POST
 * `/v1/commands/:id/deliver` immediately afterward, which is exactly the
 * production path that inline delivery replaced: by the time that second
 * call landed the command was already `delivered`, so it hit
 * `command_not_authorized` (control-service/src/db/commands.ts#deliverCommand
 * refuses anything not in `authorized`) and controlServiceFetch's
 * throw-on-non-ok turned that into a hard failure for all four tests here.
 * Asserting the response's own status rather than re-deriving delivery
 * ourselves keeps this a genuine proof that the inline path worked, not an
 * assumption.
 */
async function createAndDeliverCommand(
  fixture: Fixture,
  options: { ttlSeconds: number; reason: string },
): Promise<string> {
  const createRes = await controlServiceFetch('/v1/commands', {
    method: 'POST',
    body: JSON.stringify({
      vehicleId: fixture.vehicleId,
      actionType: ACTION_TYPE,
      dispatcherActionId: fixture.dispatcherActionId,
      ttlSeconds: options.ttlSeconds,
      parameters: { reason: options.reason },
    }),
  });
  const { command } = (await createRes.json()) as { command: { id: string; status: string } };
  if (command.status !== 'delivered') {
    throw new Error(
      `expected command ${command.id} to be delivered inline on create, but its status was "${command.status}"`,
    );
  }
  return command.id;
}

async function getControlServiceCommand(
  commandId: string,
): Promise<{ status: string; ackOutcome: string | null }> {
  const res = await controlServiceFetch(`/v1/commands/${commandId}`);
  const { command } = (await res.json()) as {
    command: { status: string; ackOutcome: string | null };
  };
  return command;
}

/**
 * Signs in at `/login`, the single front door, rather than at the legacy ops
 * password endpoint this suite used to call. The console this drives is
 * reached by a real page navigation, so the browser context's own cookie jar
 * carries the session from here on.
 */
async function loginAsPilotDriver(page: Page): Promise<void> {
  await signInThroughFrontDoor(page.context().request, {
    email: PILOT_DRIVER_EMAIL!,
    password: PILOT_DRIVER_PASSWORD!,
    origin: E2E_ORIGIN,
  });
}

/**
 * This replaces a since-removed step that filled a "Vehicle registration"
 * textbox in the console itself: that field only ever existed because the
 * pre-fix console let a pilot_driver self-report any vehicleId, which was
 * exactly the A01 gap this ticket closed. CommandConsole.tsx now derives
 * the vehicle from GET /api/ops/auth/session (never client input), so this
 * suite must arrange that server-side assignment itself (assignVehicleToPilotDriver,
 * tests/e2e/fixtures/opsFixtures.ts) to reach the same "driver sees their
 * vehicle's command" state, not simulate the old client-controlled path.
 */
async function openConsoleForVehicle(page: Page, pool: Pool, vehicleId: string): Promise<void> {
  await assignVehicleToPilotDriver(pool, PILOT_DRIVER_EMAIL!, vehicleId);
  await page.goto('/ops/pilot-driver');
  // Confirms the console actually picked up the server-assigned vehicle
  // (GET /api/ops/auth/session) before any test proceeds to assert on
  // command state — a stale/failed assignment would otherwise leave the
  // console stuck on "No vehicle is assigned to your account yet" and every
  // downstream assertion would time out with a confusing failure instead.
  await expect(page.getByText(vehicleId, { exact: true })).toBeVisible({ timeout: 15_000 });
}

/** Reads the IndexedDB ack outbox (src/lib/pilotDriver/ackQueue.ts) from inside the page. */
async function readAckOutbox(page: Page): Promise<Array<{ commandId: string; outcome: string }>> {
  return page.evaluate(
    () =>
      new Promise<Array<{ commandId: string; outcome: string }>>((resolve, reject) => {
        const request = indexedDB.open('pilot-driver-command-queue');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('ack-outbox', 'readonly');
          const getAll = tx.objectStore('ack-outbox').getAll();
          getAll.onsuccess = () => resolve(getAll.result);
          getAll.onerror = () => reject(getAll.error);
        };
      }),
  );
}

test.describe('Pilot driver command console — live authenticated flow', () => {
  test.skip(
    missingEnv.length > 0,
    `Set ${missingEnv.join(', ')} to run the live pilot-driver command e2e suite ` +
      '(needs a running control-service + Postgres and a seeded pilot_driver account — see file header).',
  );

  let controlServicePool: Pool;
  let opsPool: Pool;
  let routeDirectionId: string;

  test.beforeAll(async () => {
    // Before anything connects. This suite writes to `ops_users` by email and
    // signs in against the real Supabase directory, so a stray address here
    // must stop the run rather than reach either.
    assertQaRoster({ pilot_driver: { email: PILOT_DRIVER_EMAIL } });
    // Before either database gets a fixture write: a stray env var pointing
    // these at a real, already-seeded database must stop the run rather
    // than write test rows (or, per ops-dashboard-pages.spec.ts, disable
    // real accounts) into it. See tests/e2e/fixtures/dbSafety.ts.
    await assertDisposableControlServiceDatabase(CONTROL_SERVICE_DATABASE_URL!);
    await assertDisposableOpsDatabase(OPS_DATABASE_URL!);
    controlServicePool = new Pool({ connectionString: CONTROL_SERVICE_DATABASE_URL });
    opsPool = new Pool({ connectionString: OPS_DATABASE_URL });
    routeDirectionId = await seedGatedRouteDirection(controlServicePool);
  });

  test.afterAll(async () => {
    await controlServicePool.end();
    await opsPool.end();
  });

  test.beforeEach(async ({ page }) => {
    await loginAsPilotDriver(page);
  });

  test('1. create -> deliver -> poll shows countdown/reason -> ACK -> clears console -> audited in both systems', async ({
    page,
  }) => {
    const fixture = await seedFixture(controlServicePool, 'ack', routeDirectionId);
    const reason = `QA e2e: merging traffic ahead near ${fixture.vehicleId} — reduce speed for driver safety.`;
    const commandId = await createAndDeliverCommand(fixture, { ttlSeconds: 300, reason });

    await openConsoleForVehicle(page, opsPool, fixture.vehicleId);

    // The driver sees the plain-language action, the dispatcher's reason,
    // a live countdown, and the three response buttons (AC1).
    await expect(page.getByText('Adjust your speed')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(reason)).toBeVisible();
    await expect(page.getByLabel('Time remaining to respond')).toHaveText(/^\d+:\d{2}$/);
    const ackButton = page.getByTestId(ID.accept);
    await expect(ackButton).toBeEnabled();

    await ackButton.click();
    await expect(page.getByTestId(ID.answerSent)).toBeVisible();

    // The next poll cycle (POLL_INTERVAL_MS = 4s) confirms control-service
    // no longer reports this as the vehicle's active command.
    await expect(page.getByTestId(ID.noInstruction)).toBeVisible({ timeout: 15_000 });

    // Control-service's own record: acknowledged with no penalty parameter
    // anywhere in the call (AC2).
    await expect
      .poll(async () => (await getControlServiceCommand(commandId)).status, { timeout: 10_000 })
      .not.toBe('delivered');
    const csCommand = await getControlServiceCommand(commandId);
    expect(csCommand.ackOutcome).toBe('accept');

    // This app's own audit trail — the ack write in
    // src/app/api/ops/pilot-driver/commands/[id]/ack/route.ts.
    const auditRows = await opsPool.query(
      `select action, metadata from ops_audit_log where action = 'pilot_driver.command.ack' and resource_id = $1`,
      [commandId],
    );
    expect(auditRows.rows).toHaveLength(1);
    expect(auditRows.rows[0].metadata).toMatchObject({
      outcome: 'accept',
      vehicleId: fixture.vehicleId,
    });
  });

  test('2. queues an ack in IndexedDB when the network drops mid-ack, and flushes it once back online (AC3)', async ({
    page,
  }) => {
    const fixture = await seedFixture(controlServicePool, 'offline', routeDirectionId);
    const reason = `QA e2e offline-queue scenario for ${fixture.vehicleId}.`;
    const commandId = await createAndDeliverCommand(fixture, { ttlSeconds: 300, reason });

    await openConsoleForVehicle(page, opsPool, fixture.vehicleId);
    await expect(page.getByText(reason)).toBeVisible({ timeout: 15_000 });

    await page.context().setOffline(true);
    await expect(page.getByTestId(ID.offline)).toBeVisible();

    await page.getByTestId(ID.unable).click();

    // Written to the durable outbox before the (failing) network call, and
    // shown as queued rather than sent, per CommandConsole.handleAck.
    await expect(page.getByTestId(ID.answerQueued)).toBeVisible();
    const queuedWhileOffline = await readAckOutbox(page);
    expect(queuedWhileOffline).toEqual([expect.objectContaining({ commandId, outcome: 'unable' })]);

    // Connectivity returns — the page's `online` listener flushes the
    // outbox (src/components/ops/pilot-driver/CommandConsole.tsx).
    await page.context().setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));

    await expect.poll(() => readAckOutbox(page), { timeout: 15_000 }).toEqual([]);

    const auditRows = await opsPool.query(
      `select metadata from ops_audit_log where action = 'pilot_driver.command.ack' and resource_id = $1`,
      [commandId],
    );
    expect(auditRows.rows).toHaveLength(1);
    expect(auditRows.rows[0].metadata).toMatchObject({
      outcome: 'unable',
      vehicleId: fixture.vehicleId,
    });

    const csCommand = await getControlServiceCommand(commandId);
    expect(csCommand.ackOutcome).toBe('unable');
  });

  test('3. auto-expires locally on TTL lapse, and control-service marks it expired via its own periodic sweep', async ({
    page,
  }) => {
    const fixture = await seedFixture(controlServicePool, 'ttl', routeDirectionId);
    const reason = `QA e2e TTL-expiry scenario for ${fixture.vehicleId}.`;
    // Long enough to reliably render before it lapses, short enough to
    // finish inside this test's own timeout budget.
    const ttlSeconds = 12;
    const commandId = await createAndDeliverCommand(fixture, { ttlSeconds, reason });

    await openConsoleForVehicle(page, opsPool, fixture.vehicleId);
    await expect(page.getByText(reason)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel('Time remaining to respond')).toHaveText(/^\d+:\d{2}$/);

    // Client-side auto-expiry: CommandConsole's own 1s countdown tick hides
    // the command locally the instant it lapses, without waiting for the
    // next poll (AC1's "auto-expiry on TTL lapse").
    await expect(page.getByTestId(ID.noInstruction)).toBeVisible({
      timeout: (ttlSeconds + 8) * 1_000,
    });

    // Control-service's own authoritative state: query a plain,
    // non-lazily-expiring read (GET /v1/commands/:id never calls
    // lockAndExpireIfDue itself) so this only reflects a transition
    // control-service already made server-side — never a side effect of
    // this assertion's own read. In practice that transition can come from
    // either of control-service's two expiry paths racing each other: the
    // console's own poll hits GET /v1/commands/active, which lazily expires
    // on read (control-service/src/db/commands.ts#lockAndExpireIfDue,
    // reason "ttl_exceeded"); independently, the backstop interval timer
    // (control-service/src/index.ts, sweepExpiredCommands) marks anything
    // still non-terminal past its TTL every COMMAND_TTL_SWEEP_INTERVAL_MS,
    // reason "periodic ttl sweep". Either is "control-service's own sweep"
    // doing its job — this test asserts the outcome (expired, audited),
    // not which of the two code paths won the race.
    await expect
      .poll(async () => (await getControlServiceCommand(commandId)).status, { timeout: 30_000 })
      .toBe('expired');

    const auditRows = await controlServicePool.query(
      `select event_type, reason from command_audit_log where command_id = $1 and event_type = 'expired'`,
      [commandId],
    );
    expect(auditRows.rows).toHaveLength(1);
    expect(auditRows.rows[0].reason).toMatch(/ttl_exceeded|periodic ttl sweep/);
  });

  test("4. control-service's periodic backstop sweep expires a delivered command that nobody ever polls", async () => {
    // Deliberately never opened in a driver console and never re-read via
    // this test itself before asserting — isolates the *periodic* sweep
    // (control-service/src/index.ts, sweepExpiredCommands running every
    // COMMAND_TTL_SWEEP_INTERVAL_MS) from the lazy-expire-on-read path test
    // 3 above exercises, so this test can only pass if that backstop timer
    // is genuinely running server-side.
    const fixture = await seedFixture(controlServicePool, 'sweep-only', routeDirectionId);
    const ttlSeconds = 5;
    const commandId = await createAndDeliverCommand(fixture, {
      ttlSeconds,
      reason: `QA e2e sweep-only scenario for ${fixture.vehicleId}.`,
    });

    const swept = await new Promise<{ status: string; reason: string }>((resolve, reject) => {
      const deadline = Date.now() + 30_000;
      const poll = async () => {
        const { rows } = await controlServicePool.query(
          `select status, (select reason from command_audit_log
             where command_id = $1 and event_type = 'expired' order by occurred_at desc limit 1) as reason
           from commands where id = $1`,
          [commandId],
        );
        if (rows[0]?.status === 'expired') {
          resolve(rows[0]);
          return;
        }
        if (Date.now() > deadline) {
          reject(
            new Error(
              `command ${commandId} was not swept to expired within 30s (status: ${rows[0]?.status})`,
            ),
          );
          return;
        }
        setTimeout(poll, 1_000);
      };
      poll();
    });

    expect(swept.status).toBe('expired');
    expect(swept.reason).toBe('periodic ttl sweep');
  });
});
