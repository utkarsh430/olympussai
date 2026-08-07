-- Ops approval queue decisions + route/network kill switches
--
-- Additive follow-up to 20260805210000__ops_rbac.sql (per the standing rule
-- against hand-editing a shipped migration). Backs this ticket's dispatcher
-- approval-queue and control-room kill-switch consoles:
--
--   ops_dispatcher_actions.rejected_at/rejected_by/rejection_reason -- a
--     pending action (consumed_at is null and rejected_at is null) now has
--     a second terminal outcome besides being consumed into a command:
--     control-room can reject it outright, with a reason, attributable to
--     the rejecting ops_users row. "Approved" is unchanged and still means
--     "consumed by POST /api/ops/control-room/commands" -- that consumption
--     *is* the approval decision (actor + reason already logged there via
--     ops_audit_log); this migration only adds the missing reject path so
--     the queue has both terminal decisions.
--
--   ops_kill_switches -- route-level or network-wide halt on new automatic
--     commands (this ticket's AC: "immediately halt new automatic commands
--     ... both logged"). Enforced by POST /api/ops/control-room/commands
--     (src/app/api/ops/control-room/commands/route.ts), which refuses to
--     record a new command-audit intent while a matching kill switch is
--     engaged. A partial unique index guarantees at most one *active*
--     kill switch per scope key at the database level, not just as an
--     app-level convention.
--
-- Idempotent: every statement is safe to re-run.

begin;

-- ============================================================================
-- ops_dispatcher_actions: reject path
-- ============================================================================

alter table ops_dispatcher_actions add column if not exists rejected_at timestamptz;
alter table ops_dispatcher_actions add column if not exists rejected_by uuid references ops_users (id) on delete set null;
alter table ops_dispatcher_actions add column if not exists rejection_reason text;

comment on column ops_dispatcher_actions.rejected_at is
  'Set exactly once, atomically (UPDATE ... WHERE consumed_at IS NULL AND rejected_at IS NULL), when control-room rejects a queued action instead of consuming it into a command. Mutually exclusive with consumed_at in practice (both guarded the same way) though not enforced by a CHECK, since a legacy row could in theory predate this column.';

create index if not exists ops_dispatcher_actions_pending_idx
  on ops_dispatcher_actions (created_at desc)
  where consumed_at is null and rejected_at is null;

-- ============================================================================
-- ops_kill_switches -- route-level or network-wide command halt
-- ============================================================================

create table if not exists ops_kill_switches (
  id                uuid primary key default gen_random_uuid(),
  scope             text not null check (scope in ('network', 'route')),
  -- required iff scope = 'route'; null for a network-wide switch. Free-text
  -- (not a foreign key) for the same reason ops_dispatcher_actions.route_direction_id
  -- is free-text: this app has no local copy of control-service's route_directions.
  route_direction_id text,
  engaged_at        timestamptz not null default now(),
  engaged_by        uuid not null references ops_users (id) on delete restrict,
  reason            text not null,
  disengaged_at     timestamptz,
  disengaged_by     uuid references ops_users (id) on delete set null,
  disengage_reason  text,
  constraint ops_kill_switches_route_scope_ck check (
    (scope = 'network' and route_direction_id is null) or
    (scope = 'route' and route_direction_id is not null)
  )
);

comment on table ops_kill_switches is
  'Route-level or network-wide halt on new automatic commands (this ticket''s AC). Engaging/disengaging is always a logged, attributed human decision (engaged_by/reason, disengaged_by/disengage_reason) -- there is no silent auto-expiry. POST /api/ops/control-room/commands checks getActiveKillSwitches() before recording a new command-audit intent and refuses with 409 KILL_SWITCH_ENGAGED while one applies; that endpoint is this app''s only real command-creation gate today (see docs/CONTROL_SERVICE_INTEGRATION.md -- no control-service REST client that actually dispatches a command exists yet), so this is the enforcement point rather than a mechanism reaching into control-service''s own automatic-command loop.';

-- At most one ACTIVE (not yet disengaged) network-wide switch at a time.
create unique index if not exists ops_kill_switches_active_network_uq
  on ops_kill_switches ((scope))
  where scope = 'network' and disengaged_at is null;

-- At most one ACTIVE switch per route-direction at a time.
create unique index if not exists ops_kill_switches_active_route_uq
  on ops_kill_switches (route_direction_id)
  where scope = 'route' and disengaged_at is null;

create index if not exists ops_kill_switches_active_idx
  on ops_kill_switches (engaged_at desc)
  where disengaged_at is null;

commit;
