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

### Invites and role assignment have already collapsed

Accepting an invite now creates a **Supabase Auth account** and links it
(`ops_users.supabase_user_id`) instead of writing a bcrypt hash. The password
goes to Supabase; the profile row keeps a sentinel in `password_hash`
(`SUPABASE_MANAGED_PASSWORD_HASH`) that `verifyPassword` refuses outright, so
the legacy login can never become a second, weaker door into an account whose
credential now lives elsewhere. Everything that made the invite flow safe is
unchanged: hash-only tokens, expiry, revocation, single-use under a row lock,
one live invite per email, and the audit event.

Provisioning happens **inside** the acceptance transaction and is undone if
the database half fails, because both ways this can half-succeed are
unrecoverable by the person clicking the link — a spent invite with no account
to sign into, or an account with no profile behind it.

An address that already has a Supabase account is **refused**
(`409 IDENTITY_ALREADY_EXISTS`), not adopted. Adopting it would mean resetting
a stranger's password to whatever was typed into the invite form. Linking an
existing identity is an explicit admin action, not something an invite may do
implicitly. The invite survives the refusal.

Role assignment is a **dual write** (`POST /api/ops/admin/users/:id/role`,
new). `ops_users.role` is the authority; `app_metadata.ops_role` is the
ceiling the Edge checks. Because a session whose claim disagrees with the
database is refused in both directions, a half-applied assignment is a
lockout — so the claim write runs inside the transaction and its failure rolls
the database change back. The attempt is still recorded
(`admin.user.role_assign_failed`), since the rollback undoes the change, not
the fact that an admin tried. Re-assigning the role an account already has is
deliberately not a no-op: it re-pushes the claim, and is the repair action for
anything `GET /api/ops/admin/role-drift` reports.

Disabling reaches **three** things, in the **opposite** order from role
assignment and for a reason: `ops_users.status` alone already revokes this
product on the very next request, so that write commits first and the identity
revocation is best effort, with its outcome in the audit record. Failing the
disable because the second write did not land would leave a fully live account
for the sake of an all-or-nothing write.

`ops_users.status` is the revocation **for this product, both surfaces**.
Every guarded request re-reads it, and since the project surface was gated on
the same row (`src/lib/auth/authorize.ts`) that now covers `/project/*` and
`/api/upsrtc/*` as well as `/ops/*`. A disabled account is refused on its very
next request whatever token it is holding, through either front door.

The identity revocation (`revokeOpsIdentity`, one `updateUserById`) clears
`app_metadata.ops_role` **and** bans the Supabase account with
`ban_duration: '876000h'`. It closes what the status write cannot reach: a
Supabase identity is a credential against the **Supabase project**, which this
app does not exclusively own, so an unbanned account keeps a working sign-in
and keeps renewing itself by refresh forever. It is also the standing backstop
for the profile gate on the enterprise surface — the check that surface was
missing entirely until recently. Measured against this project's Supabase
instance, a ban makes GoTrue answer `403 user_banned` to `GET /user` with the
token the account already holds, `400 user_banned` to a refresh, and
`400 user_banned` to a fresh sign-in.

**The residual, stated so nobody has to rediscover it.** A ban does not
invalidate an access token's signature. This project signs with ES256 and both
surfaces verify locally, so a token already issued keeps verifying until it
expires — 3600s here, measured. Inside this app that grants nothing: the only
local verifier is the Edge ceiling, and the Node guard behind it re-reads
`ops_users` and refuses. At the Supabase project level the worst case is up to
one token lifetime of RLS-scoped access with a token already in hand, and this
app stores nothing there (its own Postgres is reached with `pg`). Closing even
that would mean **deleting** the identity, destroying the account and its
history for the sake of a one-hour window; a ban is reversible.

`@supabase/auth-js` 2.112.2 still offers no way to end another user's session
by session id (`admin.signOut` needs that user's own JWT). It does not need
one, for the reasons above. This is also why the per-request `ops_users` read
is the disable mechanism and not an optimisation anyone may remove.

Nothing re-activates a disabled ops account today. Whoever builds that path
must lift the ban with `ban_duration: 'none'` as part of it, or the re-enabled
operator will hold an ops profile they cannot sign in to.

### Signing out ends both sessions

`POST /api/ops/auth/logout` clears the legacy `olympuss_ops_session` cookie
**and** revokes the Supabase session (`signOut()`, global scope — the
operator's other devices go too), then expires the `sb-*-auth-token` cookies
unconditionally so an unreachable Supabase degrades a sign-out to "ended on
this device", never to "did nothing" (`src/lib/auth/rbac/signOut.ts`). It
re-reads the cookie store afterwards and answers `500 SIGN_OUT_INCOMPLETE` if
any credential survived; the ops shell's button then stays on the page with an
error instead of showing a login screen over a live session. That mattered
most on a shared depot tablet, where an operator hands the device over because
the screen told them they were signed out.

### The sign-in page has already collapsed

`/login` is now the single front door for both surfaces.
It routes each of the seven roles to its own dashboard on sign-in, and sends a
signed-in account with no usable ops profile to a plain "no operations access
configured" state rather than into `/ops/*`.
The landing-page footer and the ops shell's sign-out both point at it.

`/ops/login` still exists and **must not be deleted yet**.
It forwards to `/login`, carrying a sanitized `next`, because three things
still point at it that are out of that change's scope to move: middleware's
own bounce URL, `requireOpsRolePage()`'s redirect, and operator bookmarks.
Deleting the page turns all three into a 404, which is a lockout.
`/ops/login?legacy=1` is the deliberate exception: it renders the old password
form, so that a Supabase outage during the cutover still leaves one reachable
door. That escape hatch and the page itself both retire at the cutover, once
those callers point at `/login` directly.

Two rules keep this from looping, and a loop is what actually locks people
out.
`/login` never issues an automatic redirect — it renders, so every bounce
chain terminates on a page with a visible way out.
And the landing decision (`src/lib/auth/landing.ts`) never nominates an
`/ops/*` destination for an account that cannot open one.
Both are load-bearing during the cutover specifically: until the role-claim
push writes `app_metadata.ops_role`, *every* Supabase session reaches the edge
with no role claim, so middleware bounces even a fully provisioned operator.
That push is a **separate step** from linking accounts - the account backfill
(`pnpm backfill-ops-links`) populates `ops_users.supabase_user_id` and
deliberately writes no `app_metadata` at all, so running it alone does not
clear this. See [`AUTH_CUTOVER_RUNBOOK.md`](./AUTH_CUTOVER_RUNBOOK.md) for the
order.
See `src/tests/unit/loginFrontDoor.test.tsx`, which walks the real pages hop
by hop and fails on any repeated URL.

What changed underneath, and it is not cosmetic: **the token is no longer the
authority on anything.** It used to be. `getOpsSession()` verified a cookie
and returned its claims, and no request path ever read `ops_users`, so
`ops_users.status` was checked only at login and a disabled operator kept full
dispatch authority until their 4-hour token happened to expire. The role and
status are now re-read from the database on every guarded request. See the
"Defence in depth" section below and `src/lib/auth/rbac/server.ts`.

The operator procedure for actually performing the cutover - the order that
keeps a working login at every step, what to do for your own account so you
are never locked out, and the rollback sequence - is
[`AUTH_CUTOVER_RUNBOOK.md`](./AUTH_CUTOVER_RUNBOOK.md).

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
  `admin` has no operational screen — it does not drive the fleet, it decides
  who may. Its surface is the administrator console at `/ops/admin`
  (overview), with `/ops/admin/invites` (people, roles and assignments),
  `/ops/admin/rollout-stages` and `/ops/admin/network` under it. `/ops/admin`
  itself was a 404 until that console was built, and `src/lib/auth/landing.ts`
  carried a hard-coded detour around it.
- **Admin-invite only:** there is no self-service signup, and an invite only
  ever creates a NEW account — `POST /api/ops/admin/invites` refuses (`409`
  `USER_ALREADY_EXISTS`) an address that already has an `ops_users` row, and
  names the existing role so the admin can change it or disable the account
  instead. Nothing used to refuse it: `ops_invites` constrains only live
  invites per email and has no relationship to `ops_users`, so the invite was
  created and emailed and the collision surfaced to the INVITEE, as an
  unhandled `ops_users_email_key` violation and an HTTP 500. That pre-check is
  a read before a write and therefore races, so the accept path now reports the
  genuine collision as a `409 ACCOUNT_ALREADY_EXISTS` too. An admin creates an
  `ops_invites` row (`POST /api/ops/admin/invites`); the invitee accepts it
  once (`POST /api/ops/auth/accept-invite`), which provisions their Supabase
  Auth account with the password they choose, creates the `ops_users` row
  linked to it, and **signs them in with a Supabase session** before landing
  them on their own dashboard. That last part is not incidental: the route
  used to finish by minting a legacy `olympuss_ops_session` cookie for an
  account whose only credential lives in Supabase Auth, so the one path that
  creates new operators was the one path that never produced a session on the
  new front door. If Supabase Auth cannot be reached at that moment the legacy
  cookie is issued as a fallback rather than failing an acceptance that has
  already consumed the single-use invite. The very first admin, who by
  definition has no inviter, is seeded directly via
  `scripts/seed-ops-admin.mjs` (see `../../db/README.md`).

  There is one further, deliberately narrow exception:
  `scripts/seed-ops-user.mjs` (`pnpm seed-ops-user`) writes a single
  non-admin account directly, for automation that has no mailbox to receive
  an invite in and no admin session to issue one from — the seven role
  accounts `.github/workflows/ci-web.yml` provisions for the three ops e2e
  suites. It **refuses to create an `admin`**, so it cannot be used to
  escalate: minting an admin still goes through `seed-ops-admin.mjs` (first
  admin only) or an existing admin's invite. Its password comes from
  `OPS_SEED_PASSWORD` or a hidden TTY prompt, never argv.

  When `SUPABASE_SERVICE_ROLE_KEY` is present it also provisions the Supabase
  Auth identity the row signs in with, stamps `app_metadata.ops_role`, and
  links it — which is what lets CI drive `/login` rather than the legacy
  password endpoint, and therefore what makes that endpoint deletable at all.
  **That path is confined to `*.qa@example.test` and refuses everything else**
  (`scripts/lib/qa-identity.mjs`). CI runs against the project's real Supabase
  directory, which holds real people's logins, and the ops e2e suite disables
  accounts on purpose; the namespace is enforced in code rather than by
  convention so no pull request can point either at a real account. `.test` is
  RFC 2606 reserved, so nothing in that namespace can be a real mailbox.
  `scripts/qa-identity-teardown.mjs` removes those identities after each run
  and verifies they are gone; it accepts no address, listing and filtering the
  directory itself.
- **Session:** a signed JWT (jose, HS256) in an **HttpOnly**
  `olympuss_ops_session` cookie (`SameSite=lax`, `Secure` in production,
  `Path=/`, 4-hour max lifetime — deliberately short, since operational
  accounts carry dispatch/command authority and should re-auth more often
  than the project surface's Supabase session). Claims: `sub` (user id),
  `email`, `role`, `iat`, `exp`.
- **Passwords:** minimum 12 characters (`src/lib/auth/rbac/passwords.ts`).
  Accounts predating the collapse hold a bcrypt hash here (cost factor 12) and
  still sign in through `POST /api/ops/auth/login`. Accounts created by
  accepting an invite since then hold their password in Supabase Auth and
  carry `SUPABASE_MANAGED_PASSWORD_HASH` in the `not null` column, which
  `verifyPassword` refuses explicitly. Rollback consequence, stated plainly:
  a Supabase-managed account has **no** local password to fall back on, so
  rolling the cutover back strands it until an admin re-invites it or seeds a
  password.
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
   `/ops/login?next=…` (pages, which now forwards to `/login`) or `401` (API);
   authenticated but wrong role →
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
| `admin.invite.revoke`                                       | `POST /api/ops/admin/invites/:id/revoke` | Stamps `revoked_at`, which the accept path refuses on and the one-live-invite-per-email index excludes — so revoking is also what frees the address for a corrected invite. Refuses (`409`) once accepted, including when an acceptance wins the race. The row is never deleted. |
| `admin.user.disable`                                        | `POST /api/ops/admin/users/:id/disable`  | Refuses (`409`) to disable the last active admin. Metadata carries `identityRevoked`: `true`/`false` for a linked account, `null` when there was no identity to revoke — "nothing to revoke" and "tried and failed" are different facts. `false` means the enterprise surface is **still open** and the response says so. Rows written before the ban landed carry the older `claimCleared` key. |
| `admin.user.role_assign`                                    | `POST /api/ops/admin/users/:id/role`     | One event for both writes. Metadata carries `previousRole`, `role`, and `claimWritten` (`false` for an account with no Supabase identity yet). Refuses (`409`) to move the last active admin off `admin`.                                                         |
| `admin.user.role_assign_failed`                             | `POST /api/ops/admin/users/:id/role`     | The claim write failed and the role change was rolled back. Metadata names the `failure` and records `rolledBack: true`. Written after the rollback, so retries leave one record each.                                                                            |
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
- `SUPABASE_SERVICE_ROLE_KEY` — **now required in the running app**, not only
  by `scripts/create-project-user.mjs`. It is the only credential that can
  create an account on someone's behalf or write another user's
  `app_metadata`, so invite acceptance, role assignment and the disable-side
  claim clear all need it. Server-only and never bundled: it is reached
  exclusively through `src/lib/supabase/admin.ts`, which is marked
  `server-only`, and `src/tests/unit/middlewareEdgeSafety.test.ts` fails if
  anything reachable from middleware imports it. Without it, invite
  acceptance returns `503` and role assignment refuses rather than applying
  half of itself.
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
