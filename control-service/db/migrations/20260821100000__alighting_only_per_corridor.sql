-- route_policies: per-corridor enablement for alighting-only, with a refusal
-- tripwire that bounds what one corridor can be turned on to do.
--
-- Idempotent: every statement is safe to re-run.
--
-- ============================================================================
-- WHAT IS BEING MADE POSSIBLE, AND WHAT IS DELIBERATELY NOT BEING DONE
-- ============================================================================
--
-- Alighting-only (src/mpc/boardingLimit.ts, "let people off, take nobody on")
-- is the one lever here that fixes spacing by REMOVING delay. It has been
-- measured three times, most recently over 16 paired phase-seeds on the urban
-- preset, and the measurement is consistent: excess wait 3.6 points WORSE
-- (16/16 seeds), total passenger time 0.24 points worse (14/16), and 1,295
-- MORE refused boardings (16/16). That matches Delgado, Munoz & Giesen (2012)
-- almost exactly. On suburban and inter-city it costs passenger time outright.
--
-- So these columns exist to make switching it on for ONE corridor cheap, safe
-- and reversible. They do not switch it on. `alighting_only_enabled` defaults
-- to FALSE on every corridor including urban, and nothing in this migration or
-- in the seed sets it true anywhere.
--
-- The reason it stays off is not the measurement. It is that this action is
-- VISIBLE TO THE PEOPLE IT COSTS - somebody stands at a stop and watches a bus
-- with room on it decline them - and `objectiveCost` for this law is a
-- sentinel 0 meaning "neither side of this trade is priced", not "this breaks
-- even". Whether that trade is acceptable is a service-policy decision about
-- real riders. It is not a simulation result and this migration does not make
-- it.
--
-- ============================================================================
-- WHY PER-CORRIDOR AND NOT A GLOBAL SWITCH
-- ============================================================================
--
-- The evidence points opposite ways on different corridor shapes, and
-- AGENTS.md names shipping one corridor's fitted value to all of them as the
-- single commonest error in this area. A global env flag could only express
-- "everywhere" or "nowhere", and "everywhere" is known to be wrong for
-- suburban and inter-city. `control_settings` was the other near-miss and is
-- also wrong here for the same reason it was RIGHT for `weigh_occupancy`: that
-- switch changes what the objective contains, network-wide, and must not be
-- allowed to differ per corridor. This one must.
--
-- ============================================================================
-- WHY THE TRIPWIRE IS NOT NULLABLE
-- ============================================================================
--
-- `alighting_only_max_refusals` has no "unbounded" value on purpose. A
-- nullable bound would make the safety control optional exactly where it
-- matters - the first corridor somebody switches on - and the failure mode of
-- this law is not a crash, it is refusals quietly accumulating on the people
-- least able to complain. There is no configuration of these three columns
-- that enables the law without a bound on it.
--
-- The default of 6 per hour is NOT fitted, and it is recorded here as
-- unfitted: no measurement supports any particular number of refusals as
-- acceptable, because nobody counts the people refused (see
-- src/headway/deniedBoarding.ts, which returns "cannot say" on every visit
-- today for want of an occupancy feed and a fitted dwell model). It is set low
-- so that the first corridor to be switched on TRIPS the wire and comes back
-- for a decision, rather than running a season on a number nobody chose.
-- Raising it is a service-policy decision with evidence attached, and is a
-- one-row UPDATE.

begin;

alter table route_policies
  add column if not exists alighting_only_enabled boolean not null default false;

alter table route_policies
  add column if not exists alighting_only_max_refusals integer not null default 6
    check (alighting_only_max_refusals >= 1 and alighting_only_max_refusals <= 500);

alter table route_policies
  add column if not exists alighting_only_refusal_window_seconds integer not null default 3600
    check (alighting_only_refusal_window_seconds >= 60
           and alighting_only_refusal_window_seconds <= 86400);

comment on column route_policies.alighting_only_enabled is
  'Whether this corridor may be OFFERED alighting-only proposals (src/mpc/boardingLimit.ts). FALSE on every corridor, which is the shipped state: the law is measured to cost excess wait and passenger time, and its cost falls visibly on passengers left at a stop. The candidates are still computed and still counted in coverage when this is false - only the offer to an operator is withheld, so a corridor can be observed before it is switched on.';

comment on column route_policies.alighting_only_max_refusals is
  'Most alighting-only instructions this corridor may have ISSUED inside alighting_only_refusal_window_seconds before the law stops offering more (src/mpc/boardingLimit.ts#boardingLimitAvailability). Counted from `commands`, so it counts instructions issued to drivers, not proposals shown and not people refused - nobody counts people. Not nullable: there is no way to enable this law without a bound on it. The default is deliberately unfitted and low.';

comment on column route_policies.alighting_only_refusal_window_seconds is
  'Rolling window the refusal tripwire counts over, seconds. Rolling rather than cumulative so the wire stays armed after it trips and a corridor recovers on its own once refusals stop, instead of being latched off until somebody notices.';

-- The tripwire's meter (src/db/commands.ts#countBoardingLimitCommands) runs on
-- the solver's hot path for any corridor that is enabled. `boarding_limit` is
-- a rare action type, so a partial index keeps the whole population of them in
-- a small structure and the count is over that rather than over every command
-- the network has ever issued. Zero corridors are enabled today, so this index
-- is written for the day one is, not for the current load.
create index if not exists commands_boarding_limit_created_at_idx
  on commands (created_at)
  where action_type = 'boarding_limit';

commit;
