-- control_settings: network-wide switches that change how the controller decides.
--
-- Idempotent: every statement is safe to re-run.
--
-- ============================================================================
-- WHY THIS IS NOT route_policies, AND NOT THE WEB APP'S ops_kill_switches
-- ============================================================================
--
-- `route_policies` is per-corridor tuning: the target headway, the gains, the
-- caps. A switch that changes WHICH TERMS the objective contains is not tuning
-- one corridor, it is changing what the controller is optimising, everywhere.
-- Putting it in route_policies would mean N rows that must agree, and the
-- first time they disagreed the network would be running two different
-- controllers with no single place to read which.
--
-- The web app's `ops_kill_switches` is the other near-miss. That table is
-- enforced at the web app's own command endpoint and deliberately does NOT
-- reach into this service's automatic loop (see its table comment). This
-- setting must reach exactly that loop - the decision cycle runs on a timer in
-- this process, with no web request anywhere near it - so it has to live here.
--
-- ============================================================================
-- ONE ROW, FOREVER
-- ============================================================================
--
-- Enforced by a primary key on a constant. A settings table that can hold two
-- rows will eventually hold two rows, and then every reader needs a rule for
-- which one wins.
--
-- ============================================================================
-- WHY weigh_occupancy DEFAULTS TO FALSE
-- ============================================================================
--
-- The objective's in-vehicle term is `w_v x L x d` - the delay a hold imposes
-- on the L people already aboard. Its exchange rate against the people waiting
-- is lambda, the passenger arrival rate, and lambda is currently PROXIED as
-- 1/H* (src/mpc/objective.ts#arrivalRatePaxPerSecond). Under that proxy the
-- load penalty in the closed-form optimum works out at H*/2 seconds PER
-- PASSENGER - 900 s on this network's 1800 s median headway - so a single
-- person aboard cancels any hold the controller would otherwise ask for.
--
-- Switching occupancy weighting on before lambda is calibrated therefore does
-- not make the controller more considerate of passengers. It makes it stop
-- proposing anything, silently, in a way that looks exactly like a network
-- with no problems. Off is the correct default until boardings are being
-- measured; `test/costOptimalAndSelection.test.ts` pins the arithmetic.
--
-- With it OFF the controller optimises exactly the two things the operator
-- named as priorities: even spacing, and the delay to the timetable that
-- bunching causes.

begin;

create table if not exists control_settings (
  -- A constant primary key is the singleton. `id` is always 'global'.
  id                  text primary key default 'global'
                      check (id = 'global'),

  weigh_occupancy     boolean not null default false,

  -- Attribution, following the precedent ops_kill_switches sets: a switch
  -- that changes how the controller decides across the whole network is
  -- always a logged human decision, never a silent default drift.
  updated_at          timestamptz not null default now(),
  updated_by          text,
  update_reason       text
);

comment on table control_settings is
  'Network-wide switches that change what the decision engine optimises, as opposed to route_policies which tunes how hard it optimises on one corridor. Exactly one row, id = ''global''.';

comment on column control_settings.weigh_occupancy is
  'Whether the passenger-occupancy term participates in the objective. FALSE (the default) means the controller weighs only even spacing and schedule delay - the two operator priorities - and mpc/objective.ts#liveOnboardCount reports no load regardless of what vehicle_states holds. TRUE requires a calibrated lambda: under the current 1/H* proxy the in-vehicle term costs H*/2 seconds of hold per onboard passenger, which silences the controller entirely. See the migration header.';

-- Seed the singleton so every reader finds a row rather than having to treat
-- "no row" as a fourth state alongside on/off/unreadable.
insert into control_settings (id) values ('global')
  on conflict (id) do nothing;

commit;
