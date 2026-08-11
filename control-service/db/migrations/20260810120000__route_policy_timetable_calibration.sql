-- route_policies.calibration_source: admit a MEASURED target headway
-- ('timetable') and an ABSENT one ('none').
--
-- Extends control-service/db/migrations/20260809100000__route_policy_calibration.sql,
-- which is already applied and must not be edited. Idempotent: every statement
-- is safe to re-run.
--
-- Constraints changed: route_policies_calibration_source_check (widened),
-- route_policies_uncalibrated_sentinel_check (added).

begin;

-- ============================================================================
-- WHY THIS MIGRATION EXISTS
-- ============================================================================
--
-- The previous migration made a FABRICATED H* distinguishable from a derived
-- one. It could not make it RARE, because the seeder had nothing better to
-- derive from: getGpsLiveData says which buses are running now and
-- getScheduledBusInfo says what one bus does today, and headway is a property
-- of how often a route is SERVED, which neither of those can express. MEASURED
-- on this database before this change: 435 of 656 active policies carried
-- exactly 1,800s, and one route-direction sat at 26,130s against a real
-- published headway of 478s -- 55x too large, so hFwd/H* could never reach the
-- 0.5 warning ratio and that route could never be flagged.
--
-- getStaticData.php publishes the actual timetable: every journey calling at a
-- stop area in the next ~24 hours, with its line and its explicit direction.
-- The gap between successive departures of one line-direction at one stop is a
-- real, measured headway. That is where H* now comes from.
--
-- ============================================================================
-- 'timetable' -- a measurement
-- ============================================================================
--
-- The MEDIAN gap between successive published departures of this
-- line-direction, computed per stop area and then medianed across the stop
-- areas that observed it (src/seed/timetable.ts#deriveTimetableHeadway).
--
-- Median, not mean and not span/(n-1), because a published service day has a
-- long overnight break in it: the mean and the span estimator both absorb that
-- break into every headway they report, while the median treats it as the
-- single outlying gap it is.
--
-- Per stop area, never pooled across them, because two departures only mean
-- something relative to each other AT THE SAME POINT. Pooling mixes in each
-- journey's running time between stops and manufactures short fake gaps --
-- MEASURED over the full corpus, pooling moves the median derived headway from
-- 2,100s down to 1,409s. An H* biased LOW is the silent-false-negative failure
-- this whole line of work exists to remove, so the extra coverage pooling would
-- have bought was refused.
--
-- Departures within 120s of the one before them are collapsed first: the
-- corpus re-publishes a single working under two vehicle-journey ids offset by
-- a constant, and MEASURED across all 12,508 within-stop gaps that artefact is
-- a discrete spike of 514 gaps at EXACTLY 60s. Left in, it would set H* to 60
-- and make the route permanently undetectable.
--
-- Values outside [5 min, 4h] are REJECTED rather than clamped, and the
-- route-direction becomes 'none'. A clamped number looks like a measurement.
--
-- ============================================================================
-- 'none' -- the absence of a target, stated rather than filled in
-- ============================================================================
--
-- MEASURED: of the timetable's 1,186 line-directions, 585 are published with
-- one usable departure per stop area in the sampled window and 121 more derive
-- an implausible number. One departure has no gap, so there is no headway to
-- measure -- and the honest answer to "how often is this served?" is "this data
-- cannot say", not 1,800 seconds.
--
-- 'none' is that answer. It does NOT mean the route is broken; it means
-- detection is deliberately off for it, VISIBLY. The old failure mode was that
-- detection was off SILENTLY, on two thirds of the network, with a
-- plausible-looking number in the column and a CV and an EWT on a dashboard
-- computed against it.
--
-- HOW "NO TARGET" IS REPRESENTED, given target_headway_seconds is
-- `not null check (> 0)` and cannot hold NULL:
--
--   1. The column carries the sentinel 1, pinned by the CHECK added below so a
--      'none' row cannot drift into carrying a plausible-looking value.
--   2. src/headway/repository.ts#loadActiveRoutePolicy EXCLUDES 'none' rows, so
--      it returns null exactly as it does when no policy exists at all, and
--      src/headway/service.ts raises its pre-existing 404 `no_active_policy`.
--      The sentinel therefore never reaches src/headway/bunching.ts or
--      metrics.ts. This is fail-closed on the path that already existed for an
--      unpoliced route-direction, not a new one.
--   3. The row still EXISTS, which is the whole reason for writing it rather
--      than skipping the insert: `select calibration_source, count(*) from
--      route_policies where effective_to is null group by 1` is then a complete
--      census of the network's calibration state. A skipped row would be
--      indistinguishable from a route-direction the seeder never reached.
--
-- Consumers MUST treat 'none' exactly as they treat 'default': uncalibrated.
-- Neither may have a threshold, a CV or an EWT presented as a measurement.

-- The previous migration created this constraint inline via
-- `add column ... check (...)`, so Postgres named it
-- route_policies_calibration_source_check. Dropping by that name with
-- `if exists` keeps this re-runnable and fails loudly if a future migration
-- renames it rather than silently leaving two constraints behind.
alter table route_policies
  drop constraint if exists route_policies_calibration_source_check;

alter table route_policies
  add constraint route_policies_calibration_source_check
  check (calibration_source in ('timetable', 'journey_span', 'fleet_span', 'default', 'none'));

-- Pin the sentinel. Without this, 'none' and target_headway_seconds could drift
-- apart -- a 'none' row carrying 1,800 would be exactly the lie the label is
-- there to prevent, and nothing else in the schema would object.
alter table route_policies
  drop constraint if exists route_policies_uncalibrated_sentinel_check;

alter table route_policies
  add constraint route_policies_uncalibrated_sentinel_check
  check (calibration_source <> 'none' or target_headway_seconds = 1);

comment on column route_policies.calibration_source is
  'How target_headway_seconds (H*) was obtained, written by the network seeder. ''timetable'' = MEASURED: the median gap between successive published departures of this line-direction at one stop area, medianed across observing stop areas, from getStaticData.php (src/seed/timetable.ts). ''none'' = NO TARGET EXISTS: the timetable had no answer, target_headway_seconds carries the sentinel 1 (pinned by route_policies_uncalibrated_sentinel_check), loadActiveRoutePolicy refuses the row and the route-direction is observation-only -- detection is off VISIBLY. ''journey_span'' / ''fleet_span'' = the older vehicle-derived estimators, used only by a run with no timetable available; both infer a property of the SERVICE from a sample of VEHICLES and ''fleet_span'' in particular overestimates. ''default'' = NOT DERIVED, a configured fallback was written because the column is not-null. Consumers MUST treat ''none'' and ''default'' alike as uncalibrated and never present their thresholds, CV or EWT as measurements: a wrong H* disables detection without raising anything, because every threshold in src/headway/ is a ratio of it.';

commit;
