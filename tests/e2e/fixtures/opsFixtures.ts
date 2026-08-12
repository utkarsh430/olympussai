// Shared ops-datastore fixture helpers. Extracted out of
// tests/e2e/pilot-driver-command.spec.ts so
// tests/e2e/control-room-command-delivery.spec.ts can assign a vehicle to
// the seeded pilot_driver account without duplicating the write.
import type { Pool } from 'pg';

/**
 * Assigns `vehicleId` to the ops_users row for `email`, the same write
 * POST /api/ops/admin/users/:id/vehicle performs, and the only way this app
 * lets a vehicle become "assigned" to a driver
 * (db/migrations/20260806180000__ops_users_vehicle_assignment.sql). Called
 * directly against `pool` rather than through that admin route because
 * these suites have no seeded admin session available — see each spec's
 * file header for what infra it assumes.
 */
export async function assignVehicleToPilotDriver(pool: Pool, email: string, vehicleId: string): Promise<void> {
  const { rowCount } = await pool.query(`update ops_users set vehicle_id = $1 where lower(email) = lower($2)`, [
    vehicleId,
    email,
  ]);
  if (rowCount === 0) {
    throw new Error(`no ops_users row found for ${email}`);
  }
}
