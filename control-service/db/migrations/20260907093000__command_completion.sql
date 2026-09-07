-- Control service -- the terminal SUCCESS state the command lifecycle never had
--
-- Additive follow-up to 20260806120000__command_lifecycle.sql (per the standing
-- rule against hand-editing a shipped migration).
--
-- ─── THE DEFECT ──────────────────────────────────────────────────────────
--
-- `commands_one_active_per_vehicle_idx` includes 'executing'. A driver who
-- ACCEPTS an instruction moves it there (`acknowledgeCommand`,
-- src/db/commands.ts). `control_service_expire_commands()` deliberately
-- EXCLUDES 'executing' -- correctly, on its own terms: a command being carried
-- out should not be retroactively expired mid-action, "it runs to
-- completed/failed".
--
-- But nothing in control-service/src ever wrote 'completed'. So "runs to
-- completed/failed" was only ever true for a driver REFUSAL ('failed'). An
-- ACCEPTED command had no exit from 'executing' at all, and therefore held its
-- vehicle's slot on that unique index permanently -- not for the TTL, forever.
--
-- MEASURED on the seeded/live control database on 2026-09-06: four commands in
-- 'executing', every one with ack_outcome = 'accept', aged 24 to 26 days and
-- past their own expires_at by that same margin. They were the ONLY
-- non-terminal rows in the database past their TTL: the sweep had cleared
-- every other status and structurally could not clear these. One of the four
-- (UP78HT4567) is a real fleet vehicle, blocked from receiving any further
-- command since 2026-08-13.
--
-- ─── WHAT "FINISHED" MEANS, WHICH IS THE WHOLE FIX ───────────────────────
--
-- A command in 'executing' is finished when the ACTION IT ASKED FOR IS OVER.
-- Two cases, and the distinction is the point:
--
--   The action states its own duration. Engine-issued holds carry
--   `parameters.holdSeconds` (src/components/ops/control-room/console/
--   EngineRecommendationPanel.tsx). Finished at
--   `acknowledged_at + holdSeconds`, capped at `expires_at`, because the TTL
--   takes the instruction off the driver's screen whether or not they were
--   still serving it -- so it can shorten an action, never extend one.
--
--   The action states no duration. `speed_guidance`, and every command created
--   through the manual control-room form, carry no holdSeconds. Nothing in this
--   system measures when such an instruction ends, so the only bound it has is
--   its own shelf-life: finished at `expires_at`. Inventing a duration here
--   would put a made-up number under a guardrail this migration exists to make
--   honest.
--
-- Deliberately NOT part of the definition:
--
--   Driver acknowledgement. Ack is when the action STARTS, not when it ends --
--   it is the 'delivered' -> 'executing' edge. Freeing the slot on ack would
--   remove the conflicting-command guarantee entirely, which is the one thing
--   this index exists for.
--
--   Expiry alone. 'expired' is already reachable and means "the driver never
--   did it". Labelling a served, accepted 20 s hold 'expired' at t+120 s would
--   record a delivered instruction as undelivered and corrupt every count
--   taken off command status. An accepted command that ran its action ends at
--   'completed'; that is what the status is for.
--
-- ─── WHY NOT JUST SHORTEN THE TTL ────────────────────────────────────────
--
-- Because the TTL answers a different question -- how long an UNACKED
-- instruction stays on a driver's screen -- and shortening it would truncate
-- long holds on the corridors whose hold caps already exceed it (240 s
-- suburban, 600 s inter-city against 120 s). That is a separate decision with
-- separate consequences. This migration does not touch expiry at all.
--
-- Nothing here CALLS these functions. The behaviour change is the scheduler
-- job that does, which is gated by COMMAND_COMPLETION_SWEEP_ENABLED (default
-- false, src/config/env.ts). Applying this migration alone changes no
-- behaviour whatsoever.
--
-- Idempotent: every statement is safe to re-run.

begin;

-- ============================================================================
-- When a command in `executing` has finished the action it asked for
-- ============================================================================

create or replace function control_service_command_finished_at(
  p_acknowledged_at timestamptz,
  p_expires_at      timestamptz,
  p_parameters      jsonb
)
returns timestamptz
language sql
immutable
as $$
  select case
    -- No ack timestamp means we cannot date the start of the action. Fall back
    -- to the instruction's own shelf-life rather than guessing.
    when p_acknowledged_at is null then p_expires_at
    -- `jsonb_typeof(...) = 'number'` is the cast guard: a parameters blob is
    -- caller-supplied jsonb, and a bare ::numeric on a non-numeric value would
    -- abort the whole sweep transaction and strand every other row in it.
    when jsonb_typeof(p_parameters -> 'holdSeconds') = 'number'
      then least(
        p_acknowledged_at
          + make_interval(secs => greatest((p_parameters ->> 'holdSeconds')::double precision, 0)),
        p_expires_at
      )
    else p_expires_at
  end;
$$;

comment on function control_service_command_finished_at(timestamptz, timestamptz, jsonb) is
  'When an accepted command has finished the action it asked for: acknowledged_at + parameters.holdSeconds capped at expires_at when the action states a duration, and expires_at alone when it does not. IMMUTABLE and total -- it never raises on a malformed parameters blob, because it is evaluated across every executing row in one sweep transaction and one bad cast would strand all of them.';

-- ============================================================================
-- The sweep: `executing` -> `completed`, freeing the vehicle's slot
-- ============================================================================

create or replace function control_service_complete_finished_commands()
returns setof commands
language plpgsql
as $$
begin
  return query
    update commands
       set status = 'completed'
     where status = 'executing'
       and control_service_command_finished_at(acknowledged_at, expires_at, parameters) <= now()
    returning *;
end;
$$;

comment on function control_service_complete_finished_commands() is
  'Flips every `executing` command whose action has finished (control_service_command_finished_at) to `completed` and returns the affected rows. `completed` is terminal and outside commands_one_active_per_vehicle_idx, so this is what releases the vehicle''s slot -- the transition nothing in control-service/src ever performed, which is why an accepted command previously occupied its vehicle indefinitely. The mirror of control_service_expire_commands(): that one handles every non-terminal status EXCEPT executing, this one handles executing and nothing else, so the two candidate sets are disjoint by construction and neither can race the other for a row.';

commit;
