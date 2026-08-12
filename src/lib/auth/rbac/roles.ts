/**
 * Ops RBAC role model.
 *
 * Edge-safe: no imports beyond plain TypeScript, so this is usable from
 * middleware as well as Node route handlers/pages — the same rule
 * src/middleware.ts imposes on everything it imports (see
 * src/lib/auth/rbac/config.ts and session.ts, its other two imports here).
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

/**
 * One API route's role allowlist, wider than (or equal to) the role its URL
 * segment alone would imply. Matched on the request's exact pathname, never
 * a prefix — a prefix match would let a `[id]` sub-route silently inherit a
 * wider allowlist meant only for its parent collection route.
 */
export interface OpsApiRoleOverride {
  readonly path: string;
  readonly methods: readonly string[];
  readonly roles: readonly OpsRole[];
}

/**
 * Declarative, method-scoped, exact-pathname overrides for /api/ops/* routes
 * whose real role requirement (`requireOpsRole` in the route handler itself)
 * is wider than — or, for `fleet`, entirely undeterminable from — the URL's
 * first path segment. This map is a CEILING on middleware's edge-runtime
 * check; the route handler's `requireOpsRole` call remains the sole
 * authoritative, narrow decision (see src/lib/auth/rbac/guard.ts's doc
 * comment for the other half of this ordering). A path with no matching
 * override (and no bare segment role) fails closed — that is today's
 * behaviour for any non-role segment, not a new risk.
 *
 * Every entry here must only WIDEN its segment's role, never re-home an
 * endpoint under an unrelated role (guarded by a test in rbac.test.ts).
 */
export const OPS_API_ROLE_OVERRIDES: readonly OpsApiRoleOverride[] = [
  // GET /api/ops/dispatcher/approvals — mirrors
  // src/app/api/ops/dispatcher/approvals/route.ts's
  // requireOpsRole(['dispatcher', 'control_room']). The bare `dispatcher`
  // segment role alone 403s a control_room session before that broader
  // guard ever runs.
  { path: '/api/ops/dispatcher/approvals', methods: ['GET'], roles: ['dispatcher', 'control_room'] },
  // GET /api/ops/control-room/kill-switches — mirrors
  // src/app/api/ops/control-room/kill-switches/route.ts's
  // requireOpsRole(['dispatcher', 'depot', 'control_room']).
  { path: '/api/ops/control-room/kill-switches', methods: ['GET'], roles: ['dispatcher', 'depot', 'control_room'] },
  // GET /api/ops/fleet/schedule — mirrors
  // src/app/api/ops/fleet/schedule/route.ts's requireOpsRole(OPERATIONAL_ROLES).
  // `fleet` has no OPS_ROLE_SEGMENT entry, so roleForSegment('fleet') is
  // null and this path previously passed through middleware with no check
  // at all — not even authentication. This entry closes that fail-open gap.
  { path: '/api/ops/fleet/schedule', methods: ['GET'], roles: OPERATIONAL_ROLES },
  // GET /api/ops/fleet/breakdown-reports — mirrors
  // src/app/api/ops/fleet/breakdown-reports/route.ts's
  // requireOpsRole(['control_room', 'dispatcher', 'depot']). Same `fleet`
  // fail-open gap as above; this route ships with real middleware defence
  // from the start.
  { path: '/api/ops/fleet/breakdown-reports', methods: ['GET'], roles: ['control_room', 'dispatcher', 'depot'] },
] as const;

/**
 * The role(s) allowed to call an /api/ops/* path with the given HTTP
 * method: the override's roles if one matches exactly (path + method), else
 * the single role implied by the URL's first segment, else null (not a
 * role-gated path at all — see roleForSegment).
 */
export function rolesForOpsApiPath(pathname: string, method: string): readonly OpsRole[] | null {
  const override = OPS_API_ROLE_OVERRIDES.find(
    (entry) => entry.path === pathname && entry.methods.includes(method),
  );
  if (override) return override.roles;

  const segment = pathname.startsWith('/api/ops/') ? (pathname.slice('/api/ops/'.length).split('/')[0] ?? '') : '';
  const segmentRole = roleForSegment(segment);
  return segmentRole ? [segmentRole] : null;
}
