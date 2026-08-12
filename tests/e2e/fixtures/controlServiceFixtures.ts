// Shared control-service fixture helpers for the E2E suites that need a
// real vehicle and a rollout-gated route-direction to issue a command
// against. Extracted out of tests/e2e/pilot-driver-command.spec.ts so
// tests/e2e/control-room-command-delivery.spec.ts (which drives the actual
// create -> deliver product path, not just deliver -> ack) can seed the
// same fixtures without duplicating them.
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

/**
 * Route-direction promoted to a rollout stage that permits commands,
 * created fresh per call so tests never share (or race on) one another's
 * route-direction state.
 *
 * Required because POST /v1/commands is gated on the rollout stage of the
 * route-direction its approval names (control-service/src/pilot/gate.ts),
 * and that gate FAILS CLOSED twice over: an approval with a null
 * `route_direction_id` is refused 422 `route_direction_required`, and a
 * route-direction with no `route_direction_rollout_stages` row defaults to
 * 'observation', which is refused 403 `rollout_stage_forbids_commands`. So
 * the fixture must supply both. 'advisory' is the weakest stage that allows
 * a command at all — deliberately not a higher one, so callers exercise the
 * same gate posture a real pilot corridor starts at rather than one that
 * happens to be permissive.
 */
export async function seedGatedRouteDirection(pool: Pool): Promise<string> {
  const suffix = randomUUID().slice(0, 8);
  const routeId = `qa-e2e-route-${suffix}`;
  await pool.query(`insert into routes (id, public_name) values ($1, $2)`, [
    routeId,
    `QA E2E Route ${suffix}`,
  ]);
  const { rows } = await pool.query<{ id: string }>(
    `insert into route_directions (route_id, direction_code, direction_name)
     values ($1, 'UP', 'QA E2E direction') returning id`,
    [routeId],
  );
  const routeDirectionId = rows[0].id;
  await pool.query(
    `insert into route_direction_rollout_stages (route_direction_id, stage, updated_by, reason)
     values ($1, 'advisory', 'qa-e2e-suite', 'e2e fixture')`,
    [routeDirectionId],
  );
  return routeDirectionId;
}

/**
 * Registers a fresh, active vehicle directly against control-service's own
 * database — the only way any of these suites can reference a `vehicleId`
 * that `commands.vehicle_id_fkey` will accept.
 */
export async function insertVehicle(pool: Pool, vehicleId: string, registrationSuffix: string): Promise<void> {
  await pool.query(
    `insert into vehicles (id, registration_number, vehicle_type, is_active) values ($1, $2, 'bus', true)`,
    [vehicleId, `E2E${registrationSuffix.toUpperCase()}`],
  );
}
