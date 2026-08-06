-- Control service -- command lifecycle and delivery
--
-- Additive follow-up to 20260805190000__core_data_model.sql (per the
-- standing rule against hand-editing a shipped migration). The core
-- migration already gives commands a unique id, a ttl_seconds/expires_at
-- pair, a status enum and the dispatcher_action_id approval gate. What
-- this file adds, for the "command lifecycle and delivery service"
-- ticket:
--
--   commands.version, commands.supersedes_command_id -- every command
--     carries an explicit version; re-issuing a command for the same
--     vehicle (POST /v1/commands/:id/supersede) cancels the prior one and
--     inserts version+1 in the same transaction, so "no conflicting
--     commands per vehicle" is never just an app-level convention.
--
--   commands_one_active_per_vehicle_idx -- replaces the old non-unique
--     commands_active_idx with a UNIQUE partial index, so "at most one
--     active command per vehicle" is a database guarantee, not just the
--     advisory pre-check applyHardSafetyFilter() already did at
--     recommendation time (src/mpc/safety.ts). Insert-time enforcement
--     closes the race the advisory check alone leaves open.
--
--   control_service_expire_commands() -- flips any non-terminal command
--     whose expires_at has passed to 'expired'. Called lazily by the
--     deliver/ack handlers (src/db/commands.ts) and on a periodic sweep
--     (src/index.ts), so an expired command can never be delivered or
--     acknowledged/executed regardless of which path notices first.
--
--   command_audit_log -- append-only (trigger-enforced: no UPDATE/DELETE
--     ever succeeds), one row per state transition, written automatically
--     by a trigger on commands so the audit trail can never drift from
--     reality by a forgotten application-level write. Actor/reason context
--     that isn't a commands column (who authorized, why a driver marked a
--     command unsafe, ...) rides in via transaction-local settings
--     (control_service.audit_actor_type / _actor_id / _reason) that the
--     application sets immediately before the status-changing statement;
--     the trigger reads them with current_setting(..., true) (missing ->
--     null, never an error). This makes "full lifecycle reconstructable
--     from audit log alone" true even for a direct SQL fix-up, not just
--     for writes that went through the application.
--
-- Idempotent: every statement is safe to re-run.

begin;

-- ============================================================================
-- commands: version + supersession
-- ============================================================================

alter table commands add column if not exists version integer not null default 1;
alter table commands add column if not exists supersedes_command_id uuid references commands (id) on delete set null;

comment on column commands.version is
  'Monotonic per-vehicle-command-chain version, starting at 1. Bumped by POST /v1/commands/:id/supersede when a command is re-issued (e.g. updated parameters) before the original was ever executed.';
comment on column commands.supersedes_command_id is
  'The prior-version command this one replaces, if any. Forms a chain back to version 1 for a given vehicle/action; the audit log plus this column reconstructs the full amendment history.';

alter table commands add column if not exists ack_outcome text check (ack_outcome in ('accept', 'unable', 'unsafe'));

comment on column commands.ack_outcome is
  'Driver ack outcome recorded by POST /v1/commands/:id/ack (blueprint 9.2). unable/unsafe are recorded exactly like accept -- timestamp + reason, both stamped into acknowledged_at/acknowledgement_reason -- and never trigger a penalty; there is no scoring/penalty subsystem in this service for this path to invoke.';

-- ============================================================================
-- commands: hard "no conflicting commands per vehicle" guarantee
-- ============================================================================

drop index if exists commands_active_idx;
create unique index if not exists commands_one_active_per_vehicle_idx
  on commands (vehicle_id)
  where status in ('proposed', 'awaiting_approval', 'authorized', 'delivered', 'acknowledged', 'executing');

comment on index commands_one_active_per_vehicle_idx is
  'At most one non-terminal command per vehicle, enforced by Postgres itself (not just the advisory listActiveVehicleIds() pre-check in src/mpc/safety.ts). A second INSERT while one is already active fails with 23505, which src/db/commands.ts maps to a 409 vehicle_has_active_command. Superseding a command must cancel the old row in the same transaction as inserting the new one to stay inside this constraint.';

-- ============================================================================
-- TTL enforcement: expire commands whose expires_at has passed
-- ============================================================================

create or replace function control_service_expire_commands()
returns setof commands
language plpgsql
as $$
begin
  return query
    update commands
       set status = 'expired'
     where status in ('proposed', 'awaiting_approval', 'authorized', 'delivered', 'acknowledged')
       and expires_at <= now()
    returning *;
end;
$$;

comment on function control_service_expire_commands() is
  'Flips every non-terminal, non-executing command past its TTL to expired and returns the affected rows. "executing" is deliberately excluded -- a command already being carried out is not retroactively expired mid-execution, it runs to completed/failed. Called lazily before deliver/ack (src/db/commands.ts) and on a periodic sweep (src/index.ts) so an expired command is never delivered or acknowledged/executed no matter which path notices first.';

-- ============================================================================
-- Append-only command audit log
-- ============================================================================

create table if not exists command_audit_log (
  id           uuid primary key default gen_random_uuid(),
  command_id   uuid not null references commands (id) on delete cascade,
  -- Mirrors commands.status's own check constraint (core migration) plus
  -- 'created' for the initial INSERT and 'delivery_failed'/'superseded'
  -- for events that aren't a commands.status value at all - kept in sync
  -- with the auto-audit trigger below, which sets event_type := new.status
  -- for every UPDATE, so any status this table's status check allows must
  -- also be allowed here or the UPDATE itself would be rejected.
  event_type   text not null
               check (event_type in (
                 'created', 'proposed', 'awaiting_approval', 'authorized',
                 'delivered', 'delivery_failed', 'acknowledged', 'executing',
                 'completed', 'expired', 'cancelled', 'failed', 'superseded'
               )),
  from_status  text,
  to_status    text not null,
  actor_type   text not null default 'system' check (actor_type in ('dispatcher', 'driver', 'system')),
  actor_id     text,
  reason       text,
  metadata     jsonb not null default '{}'::jsonb,
  occurred_at  timestamptz not null default now()
);

comment on table command_audit_log is
  'Immutable, append-only record of every command state transition (blueprint 9.3 command lifecycle; ticket "command lifecycle and delivery service" AC: full lifecycle reconstructable from audit log alone). One row per transition, written by the control_service_command_audit_log trigger below -- never written to directly by application code, so it cannot drift from the commands table it describes.';

create index if not exists command_audit_log_command_id_idx on command_audit_log (command_id, occurred_at);

create or replace function control_service_command_audit_log_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'command_audit_log is append-only: % on command_audit_log is not permitted', tg_op;
end;
$$;

comment on function control_service_command_audit_log_immutable() is
  'Rejects UPDATE/DELETE on command_audit_log outright, so the audit trail cannot be edited or backdated after the fact even by a bug or a manual fix-up.';

drop trigger if exists command_audit_log_no_update on command_audit_log;
create trigger command_audit_log_no_update before update on command_audit_log
  for each row execute function control_service_command_audit_log_immutable();

drop trigger if exists command_audit_log_no_delete on command_audit_log;
create trigger command_audit_log_no_delete before delete on command_audit_log
  for each row execute function control_service_command_audit_log_immutable();

-- Auto-audit trigger: fires on every INSERT and every UPDATE OF status on
-- commands, so a transition is recorded exactly once, automatically,
-- regardless of which code path (or raw SQL) performed it. Actor/reason
-- context rides in via transaction-local settings the application sets
-- immediately before the statement; current_setting(..., true) returns
-- null (never raises) when unset, e.g. for the initial core-migration
-- default status write path or a manual fix-up.
create or replace function control_service_command_audit_log()
returns trigger
language plpgsql
as $$
declare
  v_event_type text;
begin
  v_event_type := case
    when tg_op = 'INSERT' then 'created'
    else new.status
  end;

  insert into command_audit_log (command_id, event_type, from_status, to_status, actor_type, actor_id, reason, metadata)
  values (
    new.id,
    v_event_type,
    case when tg_op = 'INSERT' then null else old.status end,
    new.status,
    coalesce(current_setting('control_service.audit_actor_type', true), 'system'),
    current_setting('control_service.audit_actor_id', true),
    current_setting('control_service.audit_reason', true),
    jsonb_build_object(
      'version', new.version,
      'dispatcherActionId', new.dispatcher_action_id,
      'ackOutcome', new.ack_outcome
    )
  );

  return new;
end;
$$;

comment on function control_service_command_audit_log() is
  'Writes one command_audit_log row per commands INSERT / status UPDATE. See command_audit_log table comment -- this is the sole writer of that table.';

drop trigger if exists command_audit_log_insert on commands;
create trigger command_audit_log_insert after insert on commands
  for each row execute function control_service_command_audit_log();

drop trigger if exists command_audit_log_status_update on commands;
create trigger command_audit_log_status_update after update of status on commands
  for each row
  when (old.status is distinct from new.status)
  execute function control_service_command_audit_log();

commit;
