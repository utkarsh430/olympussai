-- stop_visits: an append-only record of a vehicle reaching and leaving a stop.
--
-- Idempotent: every statement is safe to re-run.
--
-- ============================================================================
-- WHY
-- ============================================================================
--
-- Even spacing matters AT THE STOP, which is where passengers wait and where
-- the operator's stated priority is defined. Nothing in this system has ever
-- recorded a bus reaching one.
--
-- `headway_states` measures a MODEL-BASED time headway: metres of gap divided
-- by a current speed, computed wherever the buses happen to be. The project's
-- own blueprint says otherwise - "At stops and control points, actual
-- departure-to-departure headway should be the preferred measurement. Between
-- stops, compute model-based time headway" - and only the second half was ever
-- built. The proxy is also weakest exactly where it matters most: a vehicle
-- stationary at a stop is floored to MIN_SPEED_KMPH and reports a headway of
-- hours.
--
-- `vehicle_states.stop_state` and `.stop_state_entered_at` already carry the
-- information, and throw it away: that is a current-state row, overwritten on
-- every fix. This table is where the transitions land instead.
--
-- ============================================================================
-- PRECISION, STATED HONESTLY
-- ============================================================================
--
-- Both timestamps are derived from a 30-second GPS poll, not from a door
-- sensor or an AVL stop event. `arrived_at` is the first fix observed inside
-- the stop geofence and `departed_at` is the first fix observed outside it, so
-- each is accurate to within one polling interval and the true instant lies
-- somewhat before the recorded one. `source` records that, so a later feed
-- that reports real stop events can be added alongside without the two being
-- silently averaged together.
--
-- The uncertainty is small relative to what this measures. At the median
-- planned headway on this network - 1,800 s - a +/- 30 s bracket on each
-- departure is under 2% of the quantity being computed. It would NOT be
-- acceptable for dwell-time modelling on short dwells, which is why
-- `dwell_seconds` is left to be derived by a caller that has decided the
-- precision is adequate for its purpose, rather than stored here as if it
-- were measured.

begin;

create table if not exists stop_visits (
  id                   uuid primary key default gen_random_uuid(),
  vehicle_id           text not null references vehicles (id) on delete cascade,
  route_direction_id   uuid not null references route_directions (id) on delete cascade,
  stop_id              text not null references stops (id) on delete cascade,
  trip_id              text references trips (id) on delete set null,
  arrived_at           timestamptz not null,
  departed_at          timestamptz not null,
  source               text not null default 'gps_geofence'
                       check (source in ('gps_geofence', 'avl_stop_event')),
  created_at           timestamptz not null default now(),
  check (departed_at >= arrived_at)
);

comment on table stop_visits is
  'Append-only record of one vehicle occupying one stop, derived from geofence entry/exit in the state estimator. The basis for departure-to-departure headway AT stops (blueprint 7.1 "at stops and control points, actual departure-to-departure headway should be the preferred measurement"), which headway_states approximates with a gap/speed model instead. Also the ground truth a dwell-time model and an on-time-performance metric would be fitted from.';

comment on column stop_visits.arrived_at is
  'First fix observed inside the stop geofence. Accurate to within one GPS polling interval (30 s by default); the true arrival is at or before this.';

comment on column stop_visits.departed_at is
  'First fix observed outside the stop geofence. Accurate to within one GPS polling interval; the true departure is at or before this. Consecutive vehicles differenced at the same stop give the departure-to-departure headway.';

comment on column stop_visits.source is
  'How the visit was observed. gps_geofence is inferred from position fixes; avl_stop_event would be a real stop event from the vehicle. Recorded so the two are never silently mixed, since their precision differs by an order of magnitude.';

-- The read this table exists for: consecutive departures at one stop, newest
-- first. Covers both the per-stop headway computation and a single vehicle's
-- recent history.
create index if not exists stop_visits_stop_departed_idx
  on stop_visits (stop_id, departed_at desc);
create index if not exists stop_visits_route_direction_departed_idx
  on stop_visits (route_direction_id, departed_at desc);
create index if not exists stop_visits_vehicle_departed_idx
  on stop_visits (vehicle_id, departed_at desc);

-- One row per vehicle per stop-arrival. The estimator writes a visit when it
-- sees the vehicle leave, and an out-of-order or replayed fix can present the
-- same departure twice; this makes the second one a no-op at the database
-- rather than a duplicate an averaging query would silently halve a headway
-- over.
create unique index if not exists stop_visits_unique_idx
  on stop_visits (vehicle_id, stop_id, arrived_at);

commit;
