-- Ops RBAC — per-person accounts, admin invites, immutable audit trail
--
-- This is THIS APP'S OWN datastore (the Next.js app under src/), not the
-- control service's Postgres/PostGIS store. The two are never shared, per
-- docs/CONTROL_SERVICE_INTEGRATION.md §1 and §3 and control-service/README.md.
-- See ../README.md for how this fits together and how to apply this file.
--
-- Replaces nothing: the shared-PIN auth for /project/upsrtc and
-- /project/bunching (src/lib/auth/*, docs/olympuss/AUTH.md) is untouched and
-- reads none of these tables. This schema backs a *separate* login surface
-- for five operational roles (driver, dispatcher, depot, control_room,
-- planner) plus an internal admin role that can only invite/manage accounts
-- (it has no operational screen of its own).
--
-- Idempotent: every statement is safe to re-run. This is the first migration
-- for this datastore — do not edit it once applied anywhere; add a new file
-- for any follow-up change.
--
-- Tables created by this file: ops_users, ops_invites, ops_audit_log,
-- ops_dispatcher_actions.

begin;

create extension if not exists pgcrypto; -- gen_random_uuid()

-- ============================================================================
-- ops_users — per-person accounts, admin-invited only
-- ============================================================================

create table if not exists ops_users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  name          text not null,
  role          text not null check (role in ('driver', 'dispatcher', 'depot', 'control_room', 'planner', 'admin')),
  password_hash text not null,
  status        text not null default 'active' check (status in ('active', 'disabled')),
  invite_id     uuid, -- fk added below, after ops_invites exists
  created_by    uuid references ops_users (id) on delete set null, -- admin who issued the invite
  disabled_at   timestamptz,
  disabled_by   uuid references ops_users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table ops_users is
  'One row per person with operational access (driver/dispatcher/depot/control_room/planner) or the admin role that manages invites. Created only by accepting an ops_invites row — there is no self-service signup. The very first admin has no inviter and is seeded out-of-band via scripts/seed-ops-admin.mjs (documented in ../README.md), same pattern as any bootstrap-problem first-account.';

create index if not exists ops_users_role_active_idx on ops_users (role) where status = 'active';

create or replace function ops_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_updated_at on ops_users;
create trigger set_updated_at before update on ops_users
  for each row execute function ops_set_updated_at();

-- ============================================================================
-- ops_invites — admin-issued, single-use, expiring
-- ============================================================================

create table if not exists ops_invites (
  id           uuid primary key default gen_random_uuid(),
  email        text not null,
  role         text not null check (role in ('driver', 'dispatcher', 'depot', 'control_room', 'planner', 'admin')),
  -- sha256 hex digest of the raw invite token. The raw token is emailed/shared
  -- once and never stored — mirrors the bcrypt-hash-only rule for the PIN
  -- (docs/olympuss/AUTH.md), applied here to a one-time invite secret instead.
  token_hash   text not null unique,
  invited_by   uuid not null references ops_users (id) on delete restrict,
  expires_at   timestamptz not null,
  accepted_at  timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);

comment on table ops_invites is
  'One row per admin-issued invite. Consumed exactly once by POST /api/ops/auth/accept-invite, which creates the matching ops_users row and stamps accepted_at. Never updated after that except revoked_at for an admin-cancelled invite.';

-- At most one live (unaccepted, unrevoked, unexpired-by-app-check) invite per
-- email, so an admin cannot silently create duplicate pending invites for the
-- same person.
create unique index if not exists ops_invites_pending_email_idx
  on ops_invites (lower(email))
  where accepted_at is null and revoked_at is null;

create index if not exists ops_invites_token_hash_idx on ops_invites (token_hash);

alter table ops_users
  add constraint ops_users_invite_id_fkey foreign key (invite_id) references ops_invites (id) on delete set null;

-- ============================================================================
-- ops_audit_log — append-only, every privileged action attributable to a user
-- ============================================================================

create table if not exists ops_audit_log (
  id            uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references ops_users (id) on delete restrict,
  actor_role    text not null,
  action        text not null, -- e.g. 'dispatcher.approval.create', 'control_room.command.create', 'admin.invite.create', 'admin.user.disable'
  resource_type text,
  resource_id   text,
  metadata      jsonb not null default '{}'::jsonb,
  ip            text,
  created_at    timestamptz not null default now()
);

comment on table ops_audit_log is
  'Server-side, append-only record of every privileged action (approval, override, command, admin user-management action) taken through the ops surface, attributable to the acting ops_users row. Replaces the browser-local audit log (src/lib/audit/auditLog.ts) as the operational record for this surface only — the browser-local one is unchanged and still used by the pitch-demo command centre.';

create index if not exists ops_audit_log_actor_idx on ops_audit_log (actor_user_id, created_at desc);
create index if not exists ops_audit_log_action_idx on ops_audit_log (action, created_at desc);

-- Immutability at the database level: this app has a single connection role
-- (no per-role Postgres grants are wired up yet — see ../README.md), so
-- UPDATE/DELETE are blocked with a trigger rather than relying solely on
-- application code never issuing them.
create or replace function ops_audit_log_prevent_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'ops_audit_log is append-only; % is not permitted', tg_op;
end;
$$;

drop trigger if exists prevent_update on ops_audit_log;
create trigger prevent_update before update on ops_audit_log
  for each row execute function ops_audit_log_prevent_mutation();

drop trigger if exists prevent_delete on ops_audit_log;
create trigger prevent_delete before delete on ops_audit_log
  for each row execute function ops_audit_log_prevent_mutation();

-- ============================================================================
-- ops_dispatcher_actions — logged human approval, ahead of any command
-- ============================================================================

create table if not exists ops_dispatcher_actions (
  id                  uuid primary key default gen_random_uuid(),
  dispatcher_user_id  uuid not null references ops_users (id) on delete restrict,
  action_type         text not null check (action_type in (
                        'terminal_dispatch_hold', 'two_way_hold', 'self_equalizing_hold',
                        'speed_guidance', 'stop_skip', 'short_turn', 'deadhead',
                        'boarding_limit', 'standby_injection', 'override'
                      )),
  route_direction_id  text,
  vehicle_id          text,
  incident_id         text,
  reason              text not null,
  consumed_at         timestamptz,
  created_at          timestamptz not null default now()
);

comment on table ops_dispatcher_actions is
  'This app''s own record of a human dispatcher approval/override, keyed to ops_users.id (this ticket''s RBAC identity), created by POST /api/ops/dispatcher/approvals. action_type mirrors control-service''s commands.action_type vocabulary (control-service/db/migrations/20260805190000__core_data_model.sql) by convention so a future control-service REST client ticket can pass this row''s id as the dispatcherActionId and the dispatcher''s identity as control-service''s dispatcher_actions.dispatcher_id text column. The two tables are correlated only across the REST boundary, never by a shared foreign key or shared database — see docs/CONTROL_SERVICE_INTEGRATION.md §1, §3.';

create index if not exists ops_dispatcher_actions_dispatcher_idx on ops_dispatcher_actions (dispatcher_user_id, created_at desc);
create index if not exists ops_dispatcher_actions_unconsumed_idx on ops_dispatcher_actions (id) where consumed_at is null;

commit;
