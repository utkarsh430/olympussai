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
- **Invite tokens:** a fresh 256-bit token is generated per invite. It is
  emailed to the invitee through the Resend adapter
  (`src/lib/email/resend.ts`), using a branded HTML/text template
  (`src/lib/email/inviteEmailTemplate.ts`) that states the accept link and
  its expiry. Only the token's SHA-256 digest is stored
  (`ops_invites.token_hash`) — a database read alone can never be used to
  accept someone else's invite, and the raw token/accept URL is never
  logged. The `POST /api/ops/admin/invites` response omits the raw
  `acceptUrl` by default; it is included only when the admin explicitly
  opts in with `revealAcceptUrl: true` on the request. If Resend delivery
  fails, the invite row is still created (never silently dropped) and the
  response reports `delivered: false` with an actionable message; the admin
  can retry via `POST /api/ops/admin/invites/:id/resend`, which rotates the
  token (the original raw token was never persisted, so a resend cannot
  reuse it) and re-sends the email.

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

| Action                                                      | Endpoint                                 | Note                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dispatcher.approval.create` / `dispatcher.override.create` | `POST /api/ops/dispatcher/approvals`     | Also creates one `ops_dispatcher_actions` row — this app's own record of a human approval, correlated by convention (not a shared FK) with control-service's `dispatcher_actions` table for a future REST integration (`docs/CONTROL_SERVICE_INTEGRATION.md` §1). |
| `control_room.command.create`                               | `POST /api/ops/control-room/commands`    | Refuses (`409`) unless `dispatcherActionId` names an existing, unconsumed `ops_dispatcher_actions` row; consumes it atomically.                                                                                                                                   |
| `admin.invite.create`                                       | `POST /api/ops/admin/invites`            | Metadata includes `emailDelivered` (whether the Resend send succeeded).                                                                                                                                                                                           |
| `admin.invite.resend`                                       | `POST /api/ops/admin/invites/:id/resend` | Rotates the invite's token/expiry, then re-sends the email. Refuses (`409`) once accepted or revoked.                                                                                                                                                             |
| `admin.user.disable`                                        | `POST /api/ops/admin/users/:id/disable`  | Refuses (`409`) to disable the last active admin.                                                                                                                                                                                                                 |
| `ops_user.invite.accept`                                    | `POST /api/ops/auth/accept-invite`       | Self-attributed by the newly created user.                                                                                                                                                                                                                        |

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
- `SITE_URL` — reused from the existing config; used to build the invite
  accept link, both the one sent by email and the one optionally returned
  in the API response.
- `RESEND_API_KEY` — API key for the [Resend](https://resend.com) email
  vendor (`src/lib/email/resend.ts`). Required for invite emails to send;
  if unset, `POST /api/ops/admin/invites` and the resend endpoint still
  create/rotate the invite record but report `delivered: false` with an
  actionable error, per the fail-gracefully rule above.
- `RESEND_FROM_EMAIL` — optional; the `From` address/display name used for
  invite emails (defaults to `Olympuss Ops <ops@olympuss.us>`). Must be a
  verified sending domain in the Resend account.

## Known gaps (explicit, not silently deferred)

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
