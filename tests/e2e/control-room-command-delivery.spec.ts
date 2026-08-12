import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { seedGatedRouteDirection, insertVehicle } from './fixtures/controlServiceFixtures';
import { assignVehicleToPilotDriver } from './fixtures/opsFixtures';

/**
 * Live, authenticated end-to-end coverage for the REAL product path a
 * control-room command takes to reach a driver — the path
 * tests/e2e/pilot-driver-command.spec.ts never exercised, because that
 * spec's own `createAndDeliverCommand` helper called
 * `POST /v1/commands/:id/deliver` directly against control-service. No
 * production code path ever called that endpoint (control-service's
 * `createCommand` inserted a command as `authorized` and nothing turned it
 * `delivered`), so that spec stayed green while the flagship "issue a
 * command" action silently did nothing for a real operator.
 *
 * This spec exercises the actual chain instead:
 *
 *   dispatcher creates an approval (POST /api/ops/dispatcher/approvals)
 *   -> control-room issues the command (POST /api/ops/control-room/commands)
 *   -> control-service delivers it inline, same request
 *      (control-service/src/commands/deliverAndNotify.ts)
 *   -> the pilot-driver console picks it up on its own poll
 *      (POLL_INTERVAL_MS = 4s, src/components/ops/pilot-driver/CommandConsole.tsx)
 *
 * STRUCTURAL REQUIREMENT, not a convention: this file must never construct
 * or call a control-service REST client (no fetch/http call to
 * E2E_CONTROL_SERVICE_URL, no import of anything under
 * src/lib/controlService). That is what makes it *incapable* of reaching
 * for `/deliver` itself and accidentally passing regardless of whether the
 * product path works — precisely the hole the existing spec fell through.
 * Every assertion against control-service's own state below reads it
 * directly over `pg` via E2E_CONTROL_SERVICE_DATABASE_URL instead.
 *
 * Requires infrastructure this repo's sandbox does not carry by default —
 * see tests/e2e/pilot-driver-command.spec.ts's file header for the general
 * shape (this suite needs the same two running processes and two
 * datastores). In addition to a seeded `pilot_driver` account, this suite
 * needs a `dispatcher` and a `control_room` ops account (both provisioned
 * the same way — scripts/seed-ops-user.mjs --role dispatcher / --role
 * control_room), because issuing a command for real requires a human
 * approval AND a human dispatch decision, not just a driver who can view
 * one.
 *
 * Every one of the below is optional at the process-env level LOCALLY; the
 * whole suite is skipped (not failed) when any is unset. IN CI IT IS NOT
 * OPTIONAL — CI=true turns an unset variable into a hard failure so this
 * can never silently regress back to skipping, same as the sibling spec.
 *
 *   E2E_DISPATCHER_EMAIL=dispatcher.qa@example.com \
 *   E2E_DISPATCHER_PASSWORD=... \
 *   E2E_CONTROL_ROOM_EMAIL=control-room.qa@example.com \
 *   E2E_CONTROL_ROOM_PASSWORD=... \
 *   E2E_PILOT_DRIVER_EMAIL=pilot.driver.qa@example.com \
 *   E2E_PILOT_DRIVER_PASSWORD=... \
 *   E2E_CONTROL_SERVICE_DATABASE_URL=postgres://... \
 *   E2E_OPS_DATABASE_URL=postgres://... \
 *   npm run test:e2e -- control-room-command-delivery
 */

const E2E_ORIGIN = process.env.E2E_ORIGIN ?? 'http://127.0.0.1:3000';
const DISPATCHER_EMAIL = process.env.E2E_DISPATCHER_EMAIL;
const DISPATCHER_PASSWORD = process.env.E2E_DISPATCHER_PASSWORD;
const CONTROL_ROOM_EMAIL = process.env.E2E_CONTROL_ROOM_EMAIL;
const CONTROL_ROOM_PASSWORD = process.env.E2E_CONTROL_ROOM_PASSWORD;
const PILOT_DRIVER_EMAIL = process.env.E2E_PILOT_DRIVER_EMAIL;
const PILOT_DRIVER_PASSWORD = process.env.E2E_PILOT_DRIVER_PASSWORD;
const CONTROL_SERVICE_DATABASE_URL = process.env.E2E_CONTROL_SERVICE_DATABASE_URL;
const OPS_DATABASE_URL = process.env.E2E_OPS_DATABASE_URL;

const REQUIRED_ENV = {
  E2E_DISPATCHER_EMAIL: DISPATCHER_EMAIL,
  E2E_DISPATCHER_PASSWORD: DISPATCHER_PASSWORD,
  E2E_CONTROL_ROOM_EMAIL: CONTROL_ROOM_EMAIL,
  E2E_CONTROL_ROOM_PASSWORD: CONTROL_ROOM_PASSWORD,
  E2E_PILOT_DRIVER_EMAIL: PILOT_DRIVER_EMAIL,
  E2E_PILOT_DRIVER_PASSWORD: PILOT_DRIVER_PASSWORD,
  E2E_CONTROL_SERVICE_DATABASE_URL: CONTROL_SERVICE_DATABASE_URL,
  E2E_OPS_DATABASE_URL: OPS_DATABASE_URL,
};
const missingEnv = Object.entries(REQUIRED_ENV)
  .filter(([, value]) => !value)
  .map(([key]) => key);

/** CI-ONLY hard failure on a missing variable — see the sibling spec's file header for why this throws at module scope instead of skipping. */
if (process.env.CI === 'true' && missingEnv.length > 0) {
  throw new Error(
    `CI=true but ${missingEnv.join(', ')} ${missingEnv.length === 1 ? 'is' : 'are'} unset. ` +
      'In CI this suite must RUN, never skip. (Locally, leave CI unset and the suite skips as before.)',
  );
}

/** parameters.reason makes the exact action label irrelevant beyond matching the driver console's copy for it. */
const ACTION_TYPE = 'speed_guidance';

/**
 * Logs in and returns the session `Cookie` header to attach to subsequent
 * `request.*` calls on the SAME context explicitly.
 *
 * Not redundant with the context's own cookie jar: the login response sets
 * the ops session cookie `Secure` (`src/lib/auth/rbac/server.ts`, correctly,
 * for real HTTPS deployments), and a real Chromium PAGE navigation to
 * `http://127.0.0.1` still sends it back (Chrome trusts localhost as a
 * secure context) — but Playwright's `APIRequestContext` (`context.request`
 * / `page.request`, a plain Node HTTP client, not the browser's own network
 * stack) does not carry that exception and silently drops `Secure` cookies
 * over a plain-HTTP origin. E2E_ORIGIN is `http://127.0.0.1:...` both
 * locally and in CI (`.github/workflows/ci-web.yml`), so every dispatcher/
 * control-room call below — API-only, unlike the pilot-driver flow's real
 * page navigation — would 401 "Authentication required" on every run
 * without this: confirmed by driving the real login against a live server,
 * which returns 200 and a Set-Cookie, immediately followed by a real
 * `context.request` call that comes back unauthenticated.
 *
 * Reads every `Set-Cookie` on the response, not just the first. Login sets
 * exactly one today, so taking one worked - but `headers()` collapses
 * repeated `Set-Cookie` values into ONE newline-joined string, and
 * `.split(';', 1)[0]` cuts at the first attribute delimiter, i.e. before
 * that newline. So the moment login sets a second cookie (a CSRF token, a
 * tenant hint) the old code would have kept cookie one and silently dropped
 * every later one - a 401 with nothing in this file pointing at why.
 * Verified against a live two-cookie response: `headers()` yields
 * `"a=1; Path=/\nb=2; Path=/"` and the old expression yields `"a=1"`, while
 * `headersArray()` keeps each value separate and yields `"a=1; b=2"`.
 */
async function login(request: APIRequestContext, email: string, password: string): Promise<string> {
  const res = await request.post('/api/ops/auth/login', {
    headers: { 'Content-Type': 'application/json', Origin: E2E_ORIGIN },
    data: { email, password },
  });
  if (!res.ok()) throw new Error(`login failed for ${email} (${res.status()}): ${await res.text()}`);
  const cookiePairs = res
    .headersArray()
    .filter((header) => header.name.toLowerCase() === 'set-cookie')
    // Everything after the first `;` is attributes (Path/HttpOnly/Secure/...),
    // which belong on a Set-Cookie response header and never on a Cookie
    // request header.
    .map((header) => header.value.split(';', 1)[0]!.trim())
    .filter((pair) => pair.length > 0);
  if (cookiePairs.length === 0) {
    throw new Error(`login for ${email} succeeded but set no session cookie`);
  }
  return cookiePairs.join('; ');
}

interface CreateCommandResponseBody {
  ok: boolean;
  commandId: string;
  expiresAt: string;
  status: string;
  deliveredAt: string | null;
  auditEventId: string;
}

test.describe('Control-room command delivery — the real create-to-driver path', () => {
  test.skip(
    missingEnv.length > 0,
    `Set ${missingEnv.join(', ')} to run the live control-room command delivery e2e suite ` +
      '(needs a running control-service + Postgres and seeded dispatcher/control_room/pilot_driver accounts — see file header).',
  );

  let controlServicePool: Pool;
  let opsPool: Pool;
  let routeDirectionId: string;

  test.beforeAll(async () => {
    controlServicePool = new Pool({ connectionString: CONTROL_SERVICE_DATABASE_URL });
    opsPool = new Pool({ connectionString: OPS_DATABASE_URL });
    routeDirectionId = await seedGatedRouteDirection(controlServicePool);
  });

  test.afterAll(async () => {
    await controlServicePool.end();
    await opsPool.end();
  });

  test('dispatcher approval -> control-room issue -> delivered and visible on the driver console within one poll', async ({
    page,
    browser,
  }) => {
    const suffix = randomUUID().slice(0, 8);
    const vehicleId = `qa-e2e-delivery-${suffix}`;
    await insertVehicle(controlServicePool, vehicleId, suffix);

    // The driver console is opened and confirmed idle BEFORE the command
    // exists, so the assertion below proves the console's own 4s poll
    // picked the command up — not that a fresh page load's initial fetch
    // happened to see it.
    await login(page.context().request, PILOT_DRIVER_EMAIL!, PILOT_DRIVER_PASSWORD!);
    await assignVehicleToPilotDriver(opsPool, PILOT_DRIVER_EMAIL!, vehicleId);
    await page.goto('/ops/pilot-driver');
    await expect(page.getByText(vehicleId, { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('No active command right now.')).toBeVisible({ timeout: 15_000 });

    // The dispatcher's human approval — a separate ops session/role from
    // both control-room and the driver, exactly as a real dispatch requires.
    const dispatcherContext = await browser.newContext();
    const reason = `QA e2e: merging traffic ahead near ${vehicleId} — reduce speed for driver safety.`;
    let dispatcherActionId: string;
    try {
      const dispatcherCookie = await login(dispatcherContext.request, DISPATCHER_EMAIL!, DISPATCHER_PASSWORD!);
      const approvalRes = await dispatcherContext.request.post('/api/ops/dispatcher/approvals', {
        headers: { 'Content-Type': 'application/json', Origin: E2E_ORIGIN, Cookie: dispatcherCookie },
        data: { actionType: ACTION_TYPE, reason, routeDirectionId, vehicleId },
      });
      if (!approvalRes.ok()) {
        throw new Error(`approval creation failed (${approvalRes.status()}): ${await approvalRes.text()}`);
      }
      ({ dispatcherActionId } = (await approvalRes.json()) as { dispatcherActionId: string });
    } finally {
      await dispatcherContext.close();
    }

    // Control-room issues the command through the real bridge endpoint —
    // POST /api/ops/control-room/commands, never control-service directly.
    const controlRoomContext = await browser.newContext();
    let commandBody: CreateCommandResponseBody;
    try {
      const controlRoomCookie = await login(controlRoomContext.request, CONTROL_ROOM_EMAIL!, CONTROL_ROOM_PASSWORD!);
      const commandRes = await controlRoomContext.request.post('/api/ops/control-room/commands', {
        headers: { 'Content-Type': 'application/json', Origin: E2E_ORIGIN, Cookie: controlRoomCookie },
        data: {
          dispatcherActionId,
          actionType: ACTION_TYPE,
          vehicleId,
          routeDirectionId,
          parameters: { reason },
          ttlSeconds: 300,
          summary: `QA e2e delivery-path command for ${vehicleId}`,
        },
      });
      if (!commandRes.ok()) {
        throw new Error(`command issuance failed (${commandRes.status()}): ${await commandRes.text()}`);
      }
      commandBody = (await commandRes.json()) as CreateCommandResponseBody;
    } finally {
      await controlRoomContext.close();
    }

    // This is the "console lies" bug, caught at the API boundary: the 201
    // body must report what actually happened, not an unconditional success.
    expect(commandBody.status).toBe('delivered');
    expect(commandBody.deliveredAt).not.toBeNull();

    // The actual product surface: the driver's own poll (not a reload, not
    // a manual /deliver call — there is none in this file) must show it
    // inside roughly one POLL_INTERVAL_MS (4s) cycle.
    await expect(page.getByText('Adjust your speed')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(reason)).toBeVisible();

    // control-service's own authoritative state, read only over `pg` per
    // this file's structural requirement — never a REST client.
    const { rows: commandRows } = await controlServicePool.query<{ status: string; delivered_at: string | null }>(
      `select status, delivered_at from commands where id = $1`,
      [commandBody.commandId],
    );
    expect(commandRows).toHaveLength(1);
    expect(commandRows[0]?.status).toBe('delivered');
    expect(commandRows[0]?.delivered_at).not.toBeNull();

    const { rows: auditRows } = await controlServicePool.query<{ event_type: string; to_status: string }>(
      `select event_type, to_status from command_audit_log where command_id = $1 order by occurred_at asc`,
      [commandBody.commandId],
    );
    const createdIndex = auditRows.findIndex((r) => r.event_type === 'created');
    const deliveredIndex = auditRows.findIndex((r) => r.event_type === 'delivered');
    expect(createdIndex).toBeGreaterThanOrEqual(0);
    expect(deliveredIndex).toBeGreaterThan(createdIndex);
    expect(auditRows[createdIndex]?.to_status).toBe('authorized');
    expect(auditRows[deliveredIndex]?.to_status).toBe('delivered');
  });
});
