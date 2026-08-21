// Network-wide controller settings, and the cache in front of them.
//
// ─── WHY THERE IS A CACHE AT ALL ─────────────────────────────────────────
//
// `weighOccupancy` is read on the hot path: once per candidate-generating law
// per solve, and the decision cycle solves every eligible corridor on a timer.
// A database round trip per read would put a query on a path that currently
// does none, to answer a question whose answer changes about twice a year.
//
// ─── AND WHY THE TTL IS SHORT ANYWAY ─────────────────────────────────────
//
// This is a switch a human flips in the control room, and the person who
// flipped it will immediately look to see whether it worked. A minute of "did
// that do anything?" is how an operator learns not to trust a control. Ten
// seconds is long enough to collapse a whole decision cycle's reads into one
// query and short enough that the answer arrives while they are still looking
// at the screen.
import type { Pool } from 'pg';
import { getPool } from './pool.js';
import { logger } from '../lib/logger.js';

export interface ControlSettings {
  weighOccupancy: boolean;
  updatedAt: string;
  updatedBy: string | null;
  updateReason: string | null;
}

/**
 * What the controller does when the settings row cannot be read.
 *
 * Occupancy weighting OFF, matching the column default. This is the
 * fail-safe direction and not merely the conservative-looking one: with the
 * term on and lambda still proxied, the in-vehicle cost silences the
 * controller entirely (see the migration header). A settings outage must not
 * be able to turn the controller off.
 */
export const SETTINGS_FALLBACK: ControlSettings = {
  weighOccupancy: false,
  updatedAt: new Date(0).toISOString(),
  updatedBy: null,
  updateReason: null,
};

const CACHE_TTL_MS = 10_000;

let cached: { value: ControlSettings; readAt: number } | null = null;

/** Drop the cache so the next read goes to the database. Called after a write. */
export function invalidateSettingsCache(): void {
  cached = null;
}

/** Test-only alias, named for what tests are doing with it. */
export const _resetSettingsCacheForTests = invalidateSettingsCache;

/**
 * The current settings, or the fail-safe default if they cannot be read.
 *
 * ─── WHY THIS NEVER THROWS ───────────────────────────────────────────────
 *
 * This sits on the solver's hot path, which had NO database read before it
 * and therefore no failure mode from one. Letting a settings query propagate
 * would mean a hiccup on this one small table could stop the controller
 * proposing anything on every corridor at once - turning a config read into a
 * network-wide outage of the thing the config configures.
 *
 * The fallback direction is the safe one in both senses: it matches the
 * column default, and occupancy-OFF is the state in which the controller
 * still works. (Occupancy-ON with an uncalibrated lambda is what silences it
 * - see the migration header.) So a failed read degrades to "optimise spacing
 * and punctuality", which is the operator's stated priority set anyway.
 *
 * The failure is logged at warn on every occurrence rather than once: this is
 * a cheap indexed single-row read, so a sustained stream of these means the
 * pool is in trouble, and that is worth being loud about.
 */
export async function readControlSettings(pool: Pool = getPool()): Promise<ControlSettings> {
  if (cached && Date.now() - cached.readAt < CACHE_TTL_MS) return cached.value;

  let rows: {
    weigh_occupancy: boolean;
    updated_at: string;
    updated_by: string | null;
    update_reason: string | null;
  }[];

  try {
    ({ rows } = await pool.query<{
      weigh_occupancy: boolean;
      updated_at: string;
      updated_by: string | null;
      update_reason: string | null;
    }>(
      `select weigh_occupancy, updated_at, updated_by, update_reason
         from control_settings
        where id = 'global'`,
    ));
  } catch (error) {
    logger.warn(
      { err: error },
      'control_settings could not be read; falling back to occupancy weighting OFF',
    );
    // NOT cached. A cached failure would hold the fallback for the full TTL
    // and hide a setting the operator had already turned on, so every solve
    // retries until the read succeeds.
    return SETTINGS_FALLBACK;
  }

  const row = rows[0];
  // No row is treated as the default rather than as an error. The migration
  // seeds one, so this is only reachable if somebody deleted it - and a
  // missing switch should read as "off", not take the controller down.
  const value: ControlSettings = row
    ? {
        weighOccupancy: row.weigh_occupancy,
        updatedAt: new Date(row.updated_at).toISOString(),
        updatedBy: row.updated_by,
        updateReason: row.update_reason,
      }
    : SETTINGS_FALLBACK;

  cached = { value, readAt: Date.now() };
  return value;
}

/**
 * Flip a switch, with attribution.
 *
 * `updatedBy` and `updateReason` are required by the caller rather than
 * optional here, following the precedent `ops_kill_switches` sets: a change to
 * what the controller optimises across the whole network is always a logged
 * human decision. An unattributed change to this row is indistinguishable
 * afterwards from a deployment bug.
 */
export async function writeControlSettings(
  input: { weighOccupancy: boolean; updatedBy: string; updateReason: string },
  pool: Pool = getPool(),
): Promise<ControlSettings> {
  const { rows } = await pool.query<{
    weigh_occupancy: boolean;
    updated_at: string;
    updated_by: string | null;
    update_reason: string | null;
  }>(
    `insert into control_settings (id, weigh_occupancy, updated_at, updated_by, update_reason)
     values ('global', $1, now(), $2, $3)
     on conflict (id) do update
       set weigh_occupancy = excluded.weigh_occupancy,
           updated_at = now(),
           updated_by = excluded.updated_by,
           update_reason = excluded.update_reason
     returning weigh_occupancy, updated_at, updated_by, update_reason`,
    [input.weighOccupancy, input.updatedBy, input.updateReason],
  );

  const row = rows[0];
  if (!row) throw new Error('control_settings upsert returned no row');

  invalidateSettingsCache();

  return {
    weighOccupancy: row.weigh_occupancy,
    updatedAt: new Date(row.updated_at).toISOString(),
    updatedBy: row.updated_by,
    updateReason: row.update_reason,
  };
}
