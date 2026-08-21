-- route_policies.max_concurrent_actions: how many holds one corridor may be
-- asked to run at once.
--
-- Idempotent: every statement is safe to re-run.
--
-- ============================================================================
-- WHY
-- ============================================================================
--
-- The solver returned exactly one action per corridor per decision cycle. On a
-- corridor with one problem that is right. On one with three bunched pairs it
-- means two of them wait a full cycle each for their turn - and bunching is an
-- unstable process, so the deviation each waiting pair carries GROWS while it
-- queues. The cheap early correction is precisely what the queue spends.
--
-- ============================================================================
-- WHY IT IS POLICY AND NOT A CONSTANT
-- ============================================================================
--
-- The right number is a fact about the control room, not about the algorithm:
-- how many simultaneous instructions its staff can actually route to drivers
-- and follow up on. A depot running one dispatcher on nights and four at peak
-- has two different right answers on the same corridor, and a constant in the
-- solver could express neither.
--
-- It also has to be bounded rather than left open. An unbounded solver on a
-- bad morning would return a dozen simultaneous holds, which in practice is
-- the same as returning none: nobody triages twelve instructions, they go
-- unactioned, and the cost of unactioned instructions is paid by the NEXT one
-- that mattered - driver compliance is the dominant failure mode for this
-- whole class of system, and it is spent by asking for things that do not
-- happen.
--
-- Default 3 matches src/mpc/solver.ts#DEFAULT_MAX_CONCURRENT_ACTIONS, which
-- applies when a policy row predates this column.

begin;

alter table route_policies
  add column if not exists max_concurrent_actions integer not null default 3
    check (max_concurrent_actions >= 1 and max_concurrent_actions <= 20);

comment on column route_policies.max_concurrent_actions is
  'Most simultaneous holds the solver may propose for this corridor in one decision cycle (src/mpc/solver.ts#selectActions). An operational limit on what a control room can absorb, not an algorithmic one. Selection is always de-duplicated to one action per vehicle before this cap applies, so the cap counts distinct buses. 1 restores the original single-action behaviour.';

commit;
