# Ops RBAC Authentication & Audit Trail

Per-person, admin-invited accounts for five operational roles — driver,
dispatcher, depot, control-room, planner — plus an internal admin role that
can only invite/manage accounts. Entirely separate from the pitch-demo PIN
auth described in `AUTH.md`, which is unchanged by this feature.

## Why a second auth system, not an extension of the PIN one

The PIN system authorizes one shared secret per _project_
(`/project/upsrtc`, `/project/bunching`) — there is no concept of an
individual person, so it cannot answer "who approved this." This feature
needs exactly that, per-action, so it is a new system rather than a role
field bolted onto the PIN session:

- Separate cookie (`olympuss_ops_session` vs `olympuss_session`).
- Separate signing secret (`OPS_SESSION_SECRET` vs `SESSION_SECRET`) — a
  token from one system can never verify against the other.
- Separate datastore (`db/migrations/`, this app's own Postgres — the PIN
  system needs no database at all).
- Separate route surface (`/ops/*`, `/api/ops/*` vs `/project/*`,
  `/api/upsrtc/*`), gated by a separate branch in `src/middleware.ts` that
  never touches the PIN branch's code path.

## Model

- **Roles:** `driver`, `dispatcher`, `depot`, `control_room`, `planner`,
  `admin` (`src/lib/auth/rbac/roles.ts`). The first five each get their own
  screen at `/ops/<role-segment>` (control_room's segment is `control-room`).
  `admin` has no operational screen — its only surface is
  `/ops/admin/invites`.
- **Admin-invite only:** there is no self-service signup. An admin creates an
  `ops_invites` row (`POST /api/ops/admin/invites`); the invitee accepts it
  once (`POST /api/ops/auth/accept-invite`) to create their `ops_users` row
  and choose a password. The very first admin, who by definition has no
  inviter, is seeded directly via `scripts/seed-ops-admin.mjs` (see
  `../../db/README.md`).
- **Session:** a signed JWT (jose, HS256) in an **HttpOnly**
  `olympuss_ops_session` cookie (`SameSite=lax`, `Secure` in production,
  `Path=/`, 4-hour max lifetime — shorter than the PIN session's 8h, since
  operational accounts should re-auth more often). Claims: `sub` (user id),
  `email`, `role`, `iat`, `exp`.
- **Passwords:** bcrypt, cost factor 12, minimum 12 characters
  (`src/lib/auth/rbac/passwords.ts`).
- **Invite tokens:** a fresh 256-bit token is generated per invite and
  returned exactly once, in the `POST /api/ops/admin/invites` response, to
  the admin who created it. Only its SHA-256 digest is stored
  (`ops_invites.token_hash`) — a database read alone can never be used to
  accept someone else's invite. **Email delivery is not wired up** (no
  vendor dependency configured in this repo yet); the admin shares the
  returned `acceptUrl` out of band until that follow-up ticket lands.

## Defence in depth (three independent checks, per surface)

1. **Middleware** (`src/middleware.ts`, `handleOpsRequest`, Edge) — derives
   the required role from the first path segment under `/ops/` or
   `/api/ops/` (`roleForSegment()`); unauthenticated → redirect to
   `/ops/login?next=…` (pages) or `401` (API); authenticated but wrong role →
   redirect to `/ops/forbidden` (pages, never back to login — the person _is_
   signed in) or `403` (API).
2. **Per-role layout** (`src/app/(ops)/ops/<role>/layout.tsx`, via
   `requireOpsRolePage()`) — re-verifies server-side, does not trust
   middleware.
3. **Every ops API route** calls `requireOpsRole([...])` or
   `requireOpsSession()` itself (`src/lib/auth/rbac/guard.ts`).

## Audit trail

`ops_audit_log` (`db/migrations/20260805210000__ops_rbac.sql`) is
append-only — a database trigger rejects `UPDATE`/`DELETE` outright, since
this app has one connection role and no per-role Postgres grants yet. Every
privileged action writes one row here, attributed to `actor_user_id`:

| Action                                                      | Endpoint                                | Note                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dispatcher.approval.create` / `dispatcher.override.create` | `POST /api/ops/dispatcher/approvals`    | Also creates one `ops_dispatcher_actions` row — this app's own record of a human approval, correlated by convention (not a shared FK) with control-service's `dispatcher_actions` table for a future REST integration (`docs/CONTROL_SERVICE_INTEGRATION.md` §1). |
| `control_room.command.create`                               | `POST /api/ops/control-room/commands`   | Refuses (`409`) unless `dispatcherActionId` names an existing, unconsumed `ops_dispatcher_actions` row; consumes it atomically.                                                                                                                                   |
| `admin.invite.create`                                       | `POST /api/ops/admin/invites`           |                                                                                                                                                                                                                                                                   |
| `admin.user.disable`                                        | `POST /api/ops/admin/users/:id/disable` | Refuses (`409`) to disable the last active admin.                                                                                                                                                                                                                 |
| `ops_user.invite.accept`                                    | `POST /api/ops/auth/accept-invite`      | Self-attributed by the newly created user.                                                                                                                                                                                                                        |

Every write path records the audit event **before** returning success and
propagates a failure (500) if the audit write itself fails — an action that
happened but was not recorded is treated as not having happened, per the
acceptance criterion that every privileged action must be attributable.

This is a separate, server-side record from the pitch-demo's browser-local
audit log (`src/lib/audit/auditLog.ts`, `AuditDrawer.tsx`), which is
unchanged and still backs the command-centre UI only.

## Environment variables

- `OPS_DATABASE_URL` — this app's own Postgres connection string (see
  `../../db/README.md`). Every ops route fails closed with `503` if unset;
  there is no in-memory fallback.
- `OPS_SESSION_SECRET` — long random string, ≥32 chars, distinct from
  `SESSION_SECRET`.
- `SITE_URL` — reused from the existing config; used to build the
  `acceptUrl` returned by the invite-creation endpoint.

## Known gaps (explicit, not silently deferred)

- **Invite delivery is manual.** No email vendor is wired into this repo;
  the accept link is returned to the admin, not emailed. Tracked as a
  follow-up ticket.
- **Per-role dashboards are placeholders.** This ticket's scope is the
  auth/guard/audit layer; the real driver/dispatcher/depot/control-room/
  planner screens are a separate frontend ticket. Each placeholder page
  proves the role gate (`OpsShell`) and, for dispatcher/control-room, links
  to the concrete audited-action endpoints above.
- **No Postgres role-level grants.** `OPS_DATABASE_URL` is a single
  connection role; `ops_audit_log`'s immutability is enforced by a trigger,
  not by revoking `UPDATE`/`DELETE` grants at the role level. A schema
  ownership/grants matrix is out of scope here, same open item as
  `docs/CONTROL_SERVICE_INTEGRATION.md` §5 for the control service's own
  datastore.
