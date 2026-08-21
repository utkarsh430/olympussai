-- commands.action_type gains 'cost_optimal_hold'.
--
-- Idempotent: every statement is safe to re-run.
--
-- ============================================================================
-- WHY, AND WHY IT IS A LATENT BUG UNTIL IT LANDS
-- ============================================================================
--
-- src/mpc/costOptimalHold.ts adds a fourth control law whose candidates carry
-- `actionType: 'cost_optimal_hold'`. That value was not in this constraint,
-- and the failure mode is the worst shape a failure can take:
--
--   The candidate is generated, scored, safety-filtered, ranked, shown to a
--   control-room operator, sent to a dispatcher, APPROVED by them, and only
--   THEN rejected - by a CHECK constraint, at the insert, after two humans
--   have already committed to it.
--
-- It is dormant today only because COST_OPTIMAL_SELECTION_ENABLED defaults to
-- false, so the candidate can never be the selected action. That makes it a
-- trap rather than a bug: everything works until somebody turns on the flag
-- the code invites them to turn on.
--
-- ============================================================================
-- WHY A FOURTH HOLD TYPE RATHER THAN REUSING two_way_hold
-- ============================================================================
--
-- To a driver all four holds are the same instruction: stand still at this
-- stop for N seconds. The action type is not what the driver is told - it is
-- WHICH LAW decided, and that belongs in the audit trail. An outcome review
-- asking "did the closed-form holds do better than the tuned-gain holds?" can
-- only be answered if the two are distinguishable on the commands table, and
-- collapsing them here would destroy exactly the comparison the fourth law
-- was added to make possible.

begin;

alter table commands
  drop constraint if exists commands_action_type_check;

alter table commands
  add constraint commands_action_type_check
  check (action_type in (
    'terminal_dispatch_hold', 'two_way_hold', 'self_equalizing_hold',
    'cost_optimal_hold',
    'speed_guidance', 'stop_skip', 'short_turn', 'deadhead',
    'boarding_limit', 'standby_injection'
  ));

comment on column commands.action_type is
  'The instruction, and for holds also which control law decided it: terminal_dispatch_hold / two_way_hold / self_equalizing_hold / cost_optimal_hold are all "hold at this stop" to the driver and differ only in provenance, which is kept so outcome reviews can compare the laws against each other. The remaining six are human-originated - nothing in this system generates them.';

commit;
