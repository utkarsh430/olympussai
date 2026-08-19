-- daily_kpi_snapshots: the three numbers the operator's three priorities are
-- actually defined on.
--
-- Idempotent: every statement is safe to re-run.
--
-- ============================================================================
-- WHY
-- ============================================================================
--
-- The stated priorities are: buses run to time, buses arrive evenly spaced at
-- the stops where people wait, and passengers end up evenly distributed
-- across them. Before this migration the snapshot could report on none of the
-- three:
--
--   * PUNCTUALITY had no representation at all. Nothing in the system
--     compared a departure to a timetable.
--   * SPACING was reported from `headway_states`, which is a gap/speed model
--     sampled wherever the buses happened to be - not the departure-to-
--     departure headway at a stop that the priority is about. The existing
--     ewt_seconds/cv columns keep that meaning; the new *_at_stop columns
--     carry the measured one, and the two are deliberately side by side
--     rather than one overwriting the other. They answer different questions
--     and will disagree; that disagreement is diagnostic, not a bug.
--   * LOAD BALANCE had nothing, because nothing observes occupancy.
--
-- ============================================================================
-- EVERY COLUMN IS NULLABLE, AND NULL IS THE HONEST ANSWER TODAY
-- ============================================================================
--
--   on_time_rate, p90_lateness_seconds     need a timetable. `trips` and
--                                          `trip_stop_times` hold 0 rows.
--   *_at_stop                              need `stop_visits`, which begins
--                                          filling from the GPS feed as soon
--                                          as this deploys - so these are the
--                                          first to become real.
--   p90_load_fraction, load_spread_fraction, denied_boarding_count
--                                          need occupancy. Nothing writes
--                                          `vehicle_states.occupancy_count`.
--
-- A NULL here means "not measured", never "measured as zero". The distinction
-- is load-bearing on a dashboard: a zero on-time rate and an unmeasured one
-- look identical and mean opposite things. Consumers must render absence as
-- absence.

begin;

alter table daily_kpi_snapshots
  add column if not exists on_time_rate            numeric
    check (on_time_rate is null or (on_time_rate >= 0 and on_time_rate <= 1)),
  add column if not exists punctuality_sample_count integer not null default 0,
  add column if not exists p90_lateness_seconds    numeric,
  add column if not exists ewt_at_stop_seconds     numeric,
  add column if not exists cv_at_stop              numeric,
  add column if not exists stop_headway_sample_count integer not null default 0,
  add column if not exists p90_load_fraction       numeric,
  add column if not exists load_spread_fraction    numeric,
  add column if not exists denied_boarding_count   integer;

comment on column daily_kpi_snapshots.on_time_rate is
  'Share of observed departures inside the on-time window (default 60s early to 300s late), measured from stop_visits against trip_stop_times. NULL = no timetable loaded for this corridor, which is every corridor until one is supplied. Never defaults to 0: an unmeasured rate and a zero rate mean opposite things.';

comment on column daily_kpi_snapshots.p90_lateness_seconds is
  '90th-percentile schedule deviation, seconds, positive = late. Reported alongside the rate because a mean flattens away the tail that generates complaints.';

comment on column daily_kpi_snapshots.ewt_at_stop_seconds is
  'Excess wait time computed from MEASURED departure-to-departure headways at stops (stop_visits), as opposed to ewt_seconds which is computed from the gap/speed model in headway_states. The blueprint prefers this measurement at stops; both are kept because they answer different questions and their disagreement is diagnostic.';

comment on column daily_kpi_snapshots.p90_load_fraction is
  'Upper-tail onboard occupancy as a share of capacity. NULL until something populates vehicle_states.occupancy_count - nothing does today.';

comment on column daily_kpi_snapshots.load_spread_fraction is
  'Fullest bus minus emptiest bus, as a share of capacity. 0 = perfectly even loading. The operator priority "passengers evenly distributed", stated directly rather than inferred from headway regularity - even spacing only implies even loads when demand is uniform along the route, which it is not on a corridor with a dominant origin.';

comment on column daily_kpi_snapshots.denied_boarding_count is
  'Suspected left-behind-passenger events (src/headway/deniedBoarding.ts): at-capacity AND dwell far below the fitted model for the observed headway. An INFERENCE from occupancy and a dwell model, not a count of people - the column is nullable so it can stay absent rather than reporting 0 while occupancy is unavailable.';

commit;
