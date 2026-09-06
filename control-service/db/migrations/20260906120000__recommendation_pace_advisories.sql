-- recommendations gains `pace_advisories`.
--
-- Idempotent: every statement is safe to re-run.
--
-- ============================================================================
-- WHY A COLUMN OF ITS OWN AND NOT candidate_actions
-- ============================================================================
--
-- `mpc/paceGuidance.ts` is the only lever in this system that improves
-- spacing at negative time cost. Every hold buys even headways by making
-- somebody wait; pace guidance asks a bus that is running EARLY and closing
-- on its leader to ease off, which spends slack it already holds. The gap
-- reopens, the bus lands nearer its scheduled time, and nobody aboard waits
-- at a kerb. Both operator priorities move the same way at once, which no
-- hold can do.
--
-- It is not a hold and it must not be stored as one. `candidate_actions`
-- holds `CandidateAction` objects: things the selection rule RANKS in
-- passenger-seconds and that a dispatcher approval can turn into a command.
-- A pace advisory is none of that. It has no hold length, it is deliberately
-- not a `CandidateAction` in the solver, and keeping it off that list is what
-- makes dispatching one impossible rather than merely discouraged - the
-- ranking would otherwise happily pick a speed instruction that no delivery
-- path in this system can carry.
--
-- Writing it into `candidate_actions` would put it back in front of exactly
-- the machinery that exclusion exists to keep it away from, and
-- `findLatestRecommendation` reads `candidate_actions -> 0` as THE SELECTED
-- ACTION - so an advisory landing at index 0 would be read back as the hold
-- the controller chose. A separate column cannot be misread that way.
--
-- ============================================================================
-- WHY THE COLUMN CAN BE EMPTY ON EVERY EXISTING ROW
-- ============================================================================
--
-- Default '[]' rather than null: "this solve advised nobody to ease off" and
-- "this row predates the column" are both honestly an empty list to a reader,
-- and a not-null default means no consumer has to handle a third state. Rows
-- written before this migration carry '[]', which is what they meant.
--
-- Nothing here changes what a row AUTHORIZES. Every recommendation is still
-- `status = 'proposed'` and still reaches a bus only through a dispatcher
-- approval and POST /v1/commands.

begin;

alter table recommendations
  add column if not exists pace_advisories jsonb not null default '[]'::jsonb;

comment on column recommendations.pace_advisories is
  'Pace advice from mpc/paceGuidance.ts for this solve: buses that should ease off rather than be held, each {vehicleId, action: reduce_pace, currentSpeedKmph, targetSpeedKmph, scheduleSlackSeconds, rationale}. NOT candidate actions - never ranked against a hold, never selected, and with no driver-facing delivery path in this system; a dispatcher acts on one by radio. Empty on every row unless PACE_GUIDANCE_ON_DECISION_CYCLE_ENABLED is set.';

commit;
