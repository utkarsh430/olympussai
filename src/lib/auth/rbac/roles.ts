/**
 * Ops RBAC role model.
 *
 * Edge-safe: no imports beyond plain TypeScript, so this is usable from
 * middleware as well as Node route handlers/pages — same rule as
 * src/lib/auth/config.ts for the PIN system.
 */

/**
 * The five operational roles named in the parent RBAC ticket, plus the
 * internal admin role, plus `pilot_driver` — a restricted cohort added by
 * the "Driver PWA: single-instruction command interface" ticket
 * (db/migrations/20260806170000__ops_pilot_driver_role.sql). `pilot_driver`
 * is deliberately distinct from `driver`: the command interface must be
 * "delivered only to the pilot driver pool", not to every driver account.
 */
export const OPS_ROLES = [
  'driver',
  'pilot_driver',
  'dispatcher',
  'depot',
  'control_room',
  'planner',
  'admin',
] as const;

export type OpsRole = (typeof OPS_ROLES)[number];

/**
 * Roles with an operational screen of their own. `admin` is deliberately
 * excluded — it can only invite/manage accounts (POST /api/ops/admin/*), it
 * has no driver/dispatcher/depot/control-room/planner-style dashboard.
 */
export const OPERATIONAL_ROLES = OPS_ROLES.filter((role) => role !== 'admin') as ReadonlyArray<
  Exclude<OpsRole, 'admin'>
>;

export function isOpsRole(value: unknown): value is OpsRole {
  return typeof value === 'string' && (OPS_ROLES as readonly string[]).includes(value);
}

/**
 * URL path segment (under /ops/<segment> and /api/ops/<segment>) that each
 * role's own surface lives at. `control_room` uses a hyphen in the URL
 * (`control-room`) to match this repo's existing route-naming convention
 * (kebab-case paths, snake_case-free) even though the role value itself is
 * `control_room` (matches control-service's persisted vocabulary).
 */
export const OPS_ROLE_SEGMENT: Record<OpsRole, string> = {
  driver: 'driver',
  pilot_driver: 'pilot-driver',
  dispatcher: 'dispatcher',
  depot: 'depot',
  control_room: 'control-room',
  planner: 'planner',
  admin: 'admin',
};

const SEGMENT_TO_ROLE: Record<string, OpsRole> = Object.fromEntries(
  Object.entries(OPS_ROLE_SEGMENT).map(([role, segment]) => [segment, role as OpsRole]),
);

/**
 * Given a role's own URL segment (e.g. "control-room"), return the role it
 * belongs to, or null if the segment is not a role surface at all (e.g.
 * "login", "forbidden", "auth" — those are not role-gated by this lookup;
 * each such route enforces whatever check it individually needs).
 */
export function roleForSegment(segment: string): OpsRole | null {
  return SEGMENT_TO_ROLE[segment] ?? null;
}
