import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

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
 *     20260806160000__ops_pilot_driver_role.sql) whose credentials are
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
 * Every one of the above is optional at the process-env level; the whole
 * suite is skipped (not failed) when any is unset, mirroring
 * tests/e2e/command-centre.spec.ts's E2E_PROJECT_PIN convention. Run it with,
 * e.g.:
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

/** Command action types this suite is free to use — parameters.reason makes the exact label irrelevant. */
const ACTION_TYPE = 'speed_guidance';

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
async function seedFixture(pool: Pool, label: string): Promise<Fixture> {
  const suffix = randomUUID().slice(0, 8);
  const vehicleId = `qa-e2e-${label}-${suffix}`;
  const dispatcherActionId = randomUUID();
  await pool.query(
    `insert into vehicles (id, registration_number, vehicle_type, is_active) values ($1, $2, 'bus', true)`,
    [vehicleId, `E2E${suffix.toUpperCase()}`],
  );
  await pool.query(
    `insert into dispatcher_actions (id, dispatcher_id, action_type, vehicle_id, reason)
     values ($1, 'qa-e2e-suite', $2, $3, $4)`,
    [dispatcherActionId, ACTION_TYPE, vehicleId, `QA e2e fixture for ${label}`],
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
    throw new Error(`control-service ${init.method ?? 'GET'} ${path} failed (${response.status}): ${body}`);
  }
  return response;
}

/** Creates an authorized command against `fixture` and immediately delivers it, returning the command id. */
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
  const { command } = (await createRes.json()) as { command: { id: string } };
  await controlServiceFetch(`/v1/commands/${command.id}/deliver`, { method: 'POST' });
  return command.id;
}

async function getControlServiceCommand(commandId: string): Promise<{ status: string; ackOutcome: string | null }> {
  const res = await controlServiceFetch(`/v1/commands/${commandId}`);
  const { command } = (await res.json()) as { command: { status: string; ackOutcome: string | null } };
  return command;
}

async function loginAsPilotDriver(page: Page): Promise<void> {
  const res = await page.context().request.post('/api/ops/auth/login', {
    headers: { 'Content-Type': 'application/json', Origin: E2E_ORIGIN },
    data: { email: PILOT_DRIVER_EMAIL, password: PILOT_DRIVER_PASSWORD },
  });
  if (!res.ok()) throw new Error(`pilot_driver login failed (${res.status()}): ${await res.text()}`);
}

/**
 * Assigns `vehicleId` to the seeded E2E pilot_driver's OWN ops_users row,
 * the same write POST /api/ops/admin/users/:id/vehicle performs, and the
 * only way this app lets a vehicle become "assigned" to a driver
 * (db/migrations/20260806180000__ops_users_vehicle_assignment.sql). This
 * spec writes directly to `opsPool` rather than calling that admin route
 * because there is no seeded admin session available to this suite — see
 * the file header for what infra this spec assumes.
 *
 * This replaces a since-removed step that filled a "Vehicle registration"
 * textbox in the console itself: that field only ever existed because the
 * pre-fix console let a pilot_driver self-report any vehicleId, which was
 * exactly the A01 gap this ticket closed. CommandConsole.tsx now derives
 * the vehicle from GET /api/ops/auth/session (never client input), so this
 * suite must arrange that server-side assignment itself to reach the same
 * "driver sees their vehicle's command" state, not simulate the old
 * client-controlled path.
 */
async function assignVehicleToPilotDriver(pool: Pool, vehicleId: string): Promise<void> {
  const { rowCount } = await pool.query(`update ops_users set vehicle_id = $1 where lower(email) = lower($2)`, [
    vehicleId,
    PILOT_DRIVER_EMAIL,
  ]);
  if (rowCount === 0) {
    throw new Error(`no ops_users row found for E2E_PILOT_DRIVER_EMAIL=${PILOT_DRIVER_EMAIL}`);
  }
}

async function openConsoleForVehicle(page: Page, pool: Pool, vehicleId: string): Promise<void> {
  await assignVehicleToPilotDriver(pool, vehicleId);
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

  test.beforeAll(() => {
    controlServicePool = new Pool({ connectionString: CONTROL_SERVICE_DATABASE_URL });
    opsPool = new Pool({ connectionString: OPS_DATABASE_URL });
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
    const fixture = await seedFixture(controlServicePool, 'ack');
    const reason = `QA e2e: merging traffic ahead near ${fixture.vehicleId} — reduce speed for driver safety.`;
    const commandId = await createAndDeliverCommand(fixture, { ttlSeconds: 300, reason });

    await openConsoleForVehicle(page, opsPool, fixture.vehicleId);

    // The driver sees the plain-language action, the dispatcher's reason,
    // a live countdown, and the three response buttons (AC1).
    await expect(page.getByText('Adjust your speed')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(reason)).toBeVisible();
    await expect(page.getByLabel('Time remaining to respond')).toHaveText(/^\d+:\d{2}$/);
    const ackButton = page.getByRole('button', { name: 'Ack', exact: true });
    await expect(ackButton).toBeEnabled();

    await ackButton.click();
    await expect(page.getByText('Response sent.')).toBeVisible();

    // The next poll cycle (POLL_INTERVAL_MS = 4s) confirms control-service
    // no longer reports this as the vehicle's active command.
    await expect(page.getByText('No active command right now.')).toBeVisible({ timeout: 15_000 });

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
    expect(auditRows.rows[0].metadata).toMatchObject({ outcome: 'accept', vehicleId: fixture.vehicleId });
  });

  test('2. queues an ack in IndexedDB when the network drops mid-ack, and flushes it once back online (AC3)', async ({
    page,
  }) => {
    const fixture = await seedFixture(controlServicePool, 'offline');
    const reason = `QA e2e offline-queue scenario for ${fixture.vehicleId}.`;
    const commandId = await createAndDeliverCommand(fixture, { ttlSeconds: 300, reason });

    await openConsoleForVehicle(page, opsPool, fixture.vehicleId);
    await expect(page.getByText(reason)).toBeVisible({ timeout: 15_000 });

    await page.context().setOffline(true);
    await expect(
      page.getByText('Offline — showing the last known command. Any response you send will be queued'),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Unable', exact: true }).click();

    // Written to the durable outbox before the (failing) network call, and
    // shown as queued rather than sent, per CommandConsole.handleAck.
    await expect(
      page.getByText("Response saved on this device — it will be sent automatically once you're back online."),
    ).toBeVisible();
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
    expect(auditRows.rows[0].metadata).toMatchObject({ outcome: 'unable', vehicleId: fixture.vehicleId });

    const csCommand = await getControlServiceCommand(commandId);
    expect(csCommand.ackOutcome).toBe('unable');
  });

  test('3. auto-expires locally on TTL lapse, and control-service marks it expired via its own periodic sweep', async ({
    page,
  }) => {
    const fixture = await seedFixture(controlServicePool, 'ttl');
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
    await expect(page.getByText('No active command right now.')).toBeVisible({ timeout: (ttlSeconds + 8) * 1_000 });

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

  test('4. control-service\'s periodic backstop sweep expires a delivered command that nobody ever polls', async () => {
    // Deliberately never opened in a driver console and never re-read via
    // this test itself before asserting — isolates the *periodic* sweep
    // (control-service/src/index.ts, sweepExpiredCommands running every
    // COMMAND_TTL_SWEEP_INTERVAL_MS) from the lazy-expire-on-read path test
    // 3 above exercises, so this test can only pass if that backstop timer
    // is genuinely running server-side.
    const fixture = await seedFixture(controlServicePool, 'sweep-only');
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
          reject(new Error(`command ${commandId} was not swept to expired within 30s (status: ${rows[0]?.status})`));
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
