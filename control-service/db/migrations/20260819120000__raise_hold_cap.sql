-- route_policies.max_hold_seconds: raise the default hold cap from 90s to 600s.
--
-- Idempotent: every statement is safe to re-run.
--
-- ============================================================================
-- WHY
-- ============================================================================
--
-- The cap bounds every hold the controller may propose: mpc/safety.ts rejects
-- any candidate above it, and terminalDispatch/twoWayHold/selfEqualizing all
-- clamp to it before the candidate is even scored. At 90 seconds it was not
-- bounding an over-eager controller, it was disabling one.
--
-- MEASURED against this database at the time of writing: the median active
-- route_policies.target_headway_seconds is 1800 (30 minutes), and all 1,442
-- policy rows sat at max_hold_seconds = 90 -- the schema default, untouched,
-- so no corridor had ever been deliberately tuned to it. 90s is 5% of the
-- planned gap. A pair is flagged `bunched` at 25% of target, i.e. a gap that
-- has collapsed to ~450s and needs ~900s of correction; the largest hold the
-- solver was permitted to propose could close a fifth of that. The controller
-- was structurally incapable of solving the problem it was detecting, and
-- every hold it did propose was clamped to the same 90 regardless of how far
-- out the pair actually was.
--
-- ============================================================================
-- WHY 600 AND NOT "NO CAP"
-- ============================================================================
--
-- A hold is human-approved before it reaches a driver, so the approver is the
-- real backstop and can always shorten one. That argues for a generous cap; it
-- does not argue for removing it. The cap is what makes mpc/safety.ts a filter
-- at all -- drop it and the only remaining bound is the column's own
-- `>= 0` check, so a bad solve could put "hold this bus 4 hours" in front of a
-- dispatcher as a normal-looking row. 600s is a third of the median planned
-- gap: real control authority, still a number a human reads as sane.
--
-- This is config, not code. Any single corridor can be raised or lowered
-- further with an UPDATE and no deploy, and route_direction_stops.max_hold_seconds
-- still overrides it per control point.

begin;

alter table route_policies alter column max_hold_seconds set default 600;

-- Only rows still sitting at the old default are moved. A corridor somebody
-- deliberately tuned to another value is left exactly as they set it -- this
-- migration raises a ceiling nobody chose, it does not overwrite a decision.
update route_policies set max_hold_seconds = 600 where max_hold_seconds = 90;

comment on column route_policies.max_hold_seconds is
  'Hard upper bound on a proposed hold, in seconds, enforced by mpc/safety.ts. Config, not code. Default 600 (raised from 90, which was ~5% of the median 1800s planned gap and could not correct a bunched pair). route_direction_stops.max_hold_seconds overrides this per control point.';

commit;
