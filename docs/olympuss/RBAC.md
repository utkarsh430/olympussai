# Ops RBAC Authentication & Audit Trail

Per-person, admin-invited accounts for five operational roles — driver,
dispatcher, depot, control-room, planner — plus an internal admin role that
can only invite/manage accounts.

## Status: this is being collapsed onto Supabase Auth

The two auth systems this document describes as deliberately separate are
being merged into one front door. Supabase Auth becomes the single sign-in;
`ops_users` survives as the role and profile table, linked forward by a new
nullable `ops_users.supabase_user_id`
(`db/migrations/20260812094500__ops_users_supabase_link.sql`). `ops_users.id`
is never re-keyed: it is the FK target of 14 columns across 8 tables,
including two append-only, trigger-protected audit tables.

Both front doors are accepted at once while the cutover is proven. A request
may carry a Supabase session whose access token names an ops role
(`app_metadata.ops_role`), or the legacy `olympuss_ops_session` cookie, and
both are resolved to the same `ops_users` row and subjected to the same
checks. Nothing in the credential path has been removed, so rollback is a
configuration change rather than a data restore.

What changed underneath, and it is not cosmetic: **the token is no longer the
authority on anything.** It used to be. `getOpsSession()` verified a cookie
and returned its claims, and no request path ever read `ops_users`, so
`ops_users.status` was checked only at login and a disabled operator kept full
dispatch authority until their 4-hour token happened to expire. The role and
status are now re-read from the database on every guarded request. See the
"Defence in depth" section below and `src/lib/auth/rbac/server.ts`.

## Why this was originally a second auth system

The reasoning below is retained because it explains the shape of what is being
merged, not because the separation still holds.

`AUTH.md`'s Supabase login authorizes access to the UPSRTC _project_
(`/project/upsrtc`, `/project/bunching`) as a single undifferentiated surface
— every signed-in account sees the same dashboard, with no role or
operational identity attached. This feature needs per-action attribution
("who approved this") across five distinct operational roles, so it is a new
system rather than a role field bolted onto the project login:

- Separate cookie (`olympuss_ops_session`, own signing secret) — a
  token from one system can never verify against the other.
- Separate signing secret (`OPS_SESSION_SECRET`) — this system still signs
  its own HS256 session tokens rather than delegating to Supabase Auth.
- Separate datastore (`db/migrations/`, this app's own Postgres — Supabase
  Auth owns its users table for the other system, this one owns `ops_users`).
- Separate route surface (`/ops/*`, `/api/ops/*` vs `/project/*`,
  `/api/upsrtc/*`), gated by a separate branch in `src/middleware.ts` that
  never touches the Supabase auth branch's code path.

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

  There is one further, deliberately narrow exception:
  `scripts/seed-ops-user.mjs` (`pnpm seed-ops-user`) writes a single
  non-admin account directly, for automation that has no mailbox to receive
  an invite in and no admin session to issue one from — specifically the
  `pilot_driver` account `.github/workflows/ci-web.yml` seeds so
  `tests/e2e/pilot-driver-command.spec.ts` can log in. It **refuses to create
  an `admin`**, so it cannot be used to escalate: minting an admin still goes
  through `seed-ops-admin.mjs` (first admin only) or an existing admin's
  invite. Its password comes from `OPS_SEED_PASSWORD` or a hidden TTY prompt,
  never argv.
- **Session:** a signed JWT (jose, HS256) in an **HttpOnly**
  `olympuss_ops_session` cookie (`SameSite=lax`, `Secure` in production,
  `Path=/`, 4-hour max lifetime — deliberately short, since operational
  accounts carry dispatch/command authority and should re-auth more often
  than the project surface's Supabase session). Claims: `sub` (user id),
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

**Which of those is the authority.** Check 1 runs on the Edge runtime, which
cannot reach `pg`, so it reads a role out of a verified _token_
(`src/lib/auth/rbac/edgeSession.ts`: a Supabase access token's
`app_metadata.ops_role`, verified locally against the project's published
signing keys, or the legacy ops cookie). That role is baked in when the token
is minted, so it is stale after a role change and says nothing at all about
whether the account has since been disabled. It is a **ceiling**, exactly like
`OPS_API_ROLE_OVERRIDES` (`src/lib/auth/rbac/roles.ts`) is a ceiling over each
route's own `requireOpsRole` allowlist.

Checks 2 and 3 run on the Node runtime and re-read `ops_users` on every call
(`src/lib/auth/rbac/server.ts`). That read is the **authority**, and three
things it decides cannot be decided anywhere else:

- an identity with **no linked `ops_users` row** gets no ops access (the
  normal state for an ordinary project viewer, and a state that could not
  exist before the merge);
- a **disabled** profile is refused on its very next request, rather than when
  its token expires;
- a token whose role **disagrees** with the database is refused outright, in
  both directions, rather than either value being guessed at. Signing in again
  mints a correct claim, so this is self-healing. It surfaces as `401` with
  code `SESSION_STALE` on the API, and as a redirect to sign in (never to
  `/ops/forbidden`, which would be a dead end) on a page.

Do not "optimize away" that per-request read by trusting an `ops_users.id` or
role embedded in the token. Doing so restores the four-hour window in which a
disabled account kept working.

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
- `OPS_SESSION_SECRET` — long random string, ≥32 chars, distinct from any
  other signing secret in this app.
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
