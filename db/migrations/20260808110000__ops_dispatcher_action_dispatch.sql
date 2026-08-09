-- Ops dispatcher action -> control-service dispatch state
--
-- Additive follow-up to 20260805210000__ops_rbac.sql and
-- 20260806160000__ops_approval_queue_and_kill_switches.sql (per the standing
-- rule against hand-editing a shipped migration). Apply with `pnpm migrate:ops`
-- (scripts/migrate-ops.mjs).
--
-- WHY THIS EXISTS
-- ---------------
-- Until now a dispatcher approval could never actually authorize a real
-- command. This app recorded approvals in ops_dispatcher_actions; the control
-- service refuses to insert into its own `commands` table without a matching,
-- unconsumed row in ITS OWN `dispatcher_actions` table (dispatcher_action_id
-- NOT NULL UNIQUE plus the BEFORE INSERT `consume_dispatcher_action` trigger,
-- control-service/db/migrations/20260805190000__core_data_model.sql) — and no
-- control-service code path ever inserted such a row. The command path was
-- severed end to end.
--
-- The bridge: POST /api/ops/control-room/commands now MIRRORS this table's
-- own uuid into the control service's dispatcher_actions, inline on an
-- extended POST /v1/commands, inserted in the SAME transaction as the command
-- (`on conflict (id) do nothing`). The control-service trigger is untouched
-- and still fires; no constraint or safety invariant is weakened.
--
-- Mirroring OUR uuid (rather than letting control generate one) is what makes
-- dispatch exactly-once: control's commands.dispatcher_action_id is already
-- NOT NULL UNIQUE, so a retry of the same approval hits a 23505 that the
-- service already maps to a 409 `dispatcher_action_already_used`. This app
-- treats that 409 as "the first attempt actually landed", re-fetches the
-- command via GET /v1/commands/by-dispatcher-action/:id, and reports success.
-- A control-generated id would instead have created a SECOND command on any
-- retry-after-timeout — and src/lib/controlService/client.ts has an 8s timeout
-- and a circuit breaker, so timeouts are expected, not hypothetical. Two live
-- holds on one bus is an operational incident.
--
-- TWO-PHASE CLAIM (replaces the irreversible consume)
-- ---------------------------------------------------
-- The old flow called consumeDispatcherAction() BEFORE anything could be
-- dispatched, and there was no un-consume path: any failure permanently burned
-- a human approval. The columns below split that into claim -> dispatch:
--
--   pending  -> claimed     claimDispatcherAction() takes the row for one
--                           in-flight dispatch attempt (consumed_at stays NULL)
--   claimed  -> dispatched  markDispatcherActionDispatched() stamps
--                           consumed_at AND control_service_command_id
--   claimed  -> failed      releaseDispatcherActionClaim() records the reason
--                           and leaves consumed_at NULL, so it is retryable
--
-- consumed_at is still stamped on success and still means exactly what the
-- existing approval-queue UI thinks it means ("approved"), so
-- decisionStateOf()/listDispatcherActions()/ApprovalQueuePanel keep working
-- unchanged. dispatch_state is the finer-grained operational view layered on
-- top of it, never a replacement for it.
--
-- control_service_command_id is the ONLY durable link between this app's
-- approval and the control service's command. It is what lets an inbound
-- `command.*` webhook be attributed back to the ops user who authorized it,
-- and what makes the "control returned 201 but this app crashed before
-- recording it" case reconcilable. There is deliberately no separate
-- control_service_action_id column: under the mirroring design above the two
-- dispatcher-action ids are equal by construction, and a second column could
-- only ever drift out of agreement with the first.
--
-- Idempotent: every statement is safe to re-run.

begin;

alter table ops_dispatcher_actions
  -- 'rejected' is carried in the enum for completeness with rejected_at; the
  -- reject path (POST /api/ops/control-room/approvals/:id/reject) predates
  -- this column and still writes only rejected_at, which is what
  -- decisionStateOf() reads. Nothing depends on dispatch_state to decide
  -- rejection.
  add column if not exists dispatch_state text not null default 'pending'
    check (dispatch_state in ('pending', 'claimed', 'dispatched', 'failed', 'rejected')),
  add column if not exists claimed_at timestamptz,
  add column if not exists claimed_by uuid references ops_users (id) on delete set null,
  -- Free-text uuid, NOT a foreign key: the control service owns its own
  -- Postgres and this app never connects to it (docs/CONTROL_SERVICE_INTEGRATION.md
  -- §3), exactly as route_direction_id/vehicle_id here are already free-text.
  add column if not exists control_service_command_id uuid,
  add column if not exists control_service_error text,
  add column if not exists dispatch_attempts integer not null default 0;

comment on column ops_dispatcher_actions.dispatch_state is
  'Operational state of this approval''s journey to the control service: pending -> claimed -> dispatched, or claimed -> failed (retryable, consumed_at left NULL). Layered on top of consumed_at/rejected_at, never a replacement for them — the approval queue still derives approved/rejected/pending from those two columns alone.';

comment on column ops_dispatcher_actions.claimed_at is
  'When the current dispatch attempt took this row. A claim older than 2 minutes is reclaimable by claimDispatcherAction(), so a web process that crashes between claiming and dispatching recovers without a human. That is safe precisely because the mirrored uuid makes a re-dispatch a no-op if the first attempt actually landed (control returns 409 dispatcher_action_already_used and this app reconciles against the existing command).';

comment on column ops_dispatcher_actions.control_service_command_id is
  'The control service''s commands.id created against this approval. The only durable web<->control link: it attributes an inbound command.* webhook back to the authorizing ops user, and makes a lost 201 reconcilable. NULL for a recorded ''override'' (POST /api/ops/control-room/overrides), which by design never reaches the control service — an override is a human acting outside the automated control set, so the audit record IS the deliverable.';

comment on column ops_dispatcher_actions.control_service_error is
  'Why the last dispatch attempt failed (cleared on success). Diagnostic only — retry eligibility is decided by dispatch_state plus consumed_at/rejected_at.';

comment on column ops_dispatcher_actions.dispatch_attempts is
  'Incremented by every successful claim, including stale-claim reclaims. Lets an operator spot an approval that keeps failing rather than silently retrying forever.';

-- Supports the stale-claim reclaim predicate (claimed_at < now() - interval
-- '2 minutes') without scanning the whole table. Partial, because a claimed
-- row is by definition a rare, short-lived state.
create index if not exists ops_dispatcher_actions_stuck_claims_idx
  on ops_dispatcher_actions (claimed_at) where dispatch_state = 'claimed';

commit;
